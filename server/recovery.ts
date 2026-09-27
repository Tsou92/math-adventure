import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, withTransaction } from './db.js';
import {
  hashPassword,
  normalizeUsername,
  requireUser,
  validatePassword,
  verifyPassword,
} from './auth.js';
import { body, method, send } from './http.js';

export function createRecoveryCode() {
  return randomBytes(20)
    .toString('hex')
    .toUpperCase()
    .match(/.{1,8}/g)!
    .join('-');
}
export function recoveryHash(code: string) {
  return createHash('sha256')
    .update(code.replace(/[\s-]/g, '').toUpperCase())
    .digest('hex');
}

async function rateLimit(req: VercelRequest, scope: string) {
  const ip = String(
    req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown',
  )
    .split(',')[0]
    .trim();
  const bucket = createHash('sha256')
    .update(`recovery:${scope}:${ip}`)
    .digest('hex');
  const rows =
    await db()`INSERT INTO kousuan.login_attempts(bucket,attempt_count,window_started_at)
    VALUES(${bucket},1,now()) ON CONFLICT(bucket) DO UPDATE SET
    attempt_count=CASE WHEN kousuan.login_attempts.window_started_at<now()-interval '15 minutes' THEN 1 ELSE kousuan.login_attempts.attempt_count+1 END,
    window_started_at=CASE WHEN kousuan.login_attempts.window_started_at<now()-interval '15 minutes' THEN now() ELSE kousuan.login_attempts.window_started_at END
    RETURNING attempt_count`;
  if (Number(rows[0]?.attempt_count) > 6)
    throw Object.assign(new Error('尝试次数过多，请 15 分钟后重试'), {
      statusCode: 429,
    });
}

export async function issueRecovery(req: VercelRequest, res: VercelResponse) {
  method(req, 'POST');
  const user = await requireUser(req, ['parent', 'site_owner']);
  const parsed = z.object({ password: z.string().max(128) }).parse(body(req));
  await rateLimit(req, `issue:${user.id}`);
  const code = createRecoveryCode();
  await withTransaction(async (tx) => {
    // 锁住 user 行后再校验当前状态与密码：改密/重置会在同一行 FOR UPDATE 中提交，
    // 避免用旧密码通过校验后越过改密写入新恢复码。
    const { rows } = await tx.query<{
      password_hash: string;
      is_active: boolean;
    }>(
      'SELECT password_hash, is_active FROM kousuan.users WHERE id = $1 FOR UPDATE',
      [user.id],
    );
    const current = rows[0];
    if (!current || !current.is_active)
      throw Object.assign(new Error('登录状态已失效，请重新登录'), {
        statusCode: 401,
      });
    if (!(await verifyPassword(String(current.password_hash), parsed.password)))
      throw Object.assign(new Error('家长密码不正确'), { statusCode: 400 });
    await tx.query(
      `INSERT INTO kousuan.recovery_codes(user_id,code_hash) VALUES($1,$2)
        ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,created_at=now()`,
      [user.id, recoveryHash(code)],
    );
  });
  return send(res, 200, { recoveryCode: code });
}

export async function recoverPassword(req: VercelRequest, res: VercelResponse) {
  method(req, 'POST');
  const parsed = z
    .object({
      username: z.string().min(1).max(100),
      code: z.string().max(100),
      password: z.string().max(128),
    })
    .parse(body(req));
  await rateLimit(req, 'reset');
  validatePassword(parsed.password, 'parent');
  const username = normalizeUsername(parsed.username),
    passwordHash = await hashPassword(parsed.password),
    codeHash = recoveryHash(parsed.code);
  await withTransaction(async (tx) => {
    // 先锁住匹配的家长行：与 issueRecovery/changePassword 争用同一行，
    // 各步独立语句在同一事务内提交，避免快照过期导致刚插入的 session 未被撤销。
    const { rows: users } = await tx.query<{
      id: string;
      family_id: string | null;
    }>(
      `SELECT id, family_id FROM kousuan.users
        WHERE username = $1 AND is_active = true AND role IN ('parent', 'site_owner')
        FOR UPDATE`,
      [username],
    );
    const user = users[0];
    if (!user)
      throw Object.assign(new Error('用户名或恢复码不正确，或恢复码已使用'), {
        statusCode: 400,
      });
    const { rows: consumed } = await tx.query(
      `DELETE FROM kousuan.recovery_codes
        WHERE user_id = $1 AND code_hash = $2 RETURNING user_id`,
      [user.id, codeHash],
    );
    if (!consumed.length)
      throw Object.assign(new Error('用户名或恢复码不正确，或恢复码已使用'), {
        statusCode: 400,
      });
    await tx.query(
      `UPDATE kousuan.users SET password_hash = $2, must_change_password = false, updated_at = now()
        WHERE id = $1`,
      [user.id, passwordHash],
    );
    await tx.query('DELETE FROM kousuan.sessions WHERE user_id = $1', [
      user.id,
    ]);
    await tx.query(
      `INSERT INTO kousuan.audit_events(family_id,actor_user_id,target_user_id,action)
        VALUES($1,$2,$2,'parent.password_recovered')`,
      [user.family_id, user.id],
    );
  });
  return send(res, 200, { ok: true });
}

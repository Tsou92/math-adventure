import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './db.js';
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
  const rows =
    await db()`SELECT password_hash FROM kousuan.users WHERE id=${user.id}`;
  if (!(await verifyPassword(String(rows[0].password_hash), parsed.password)))
    throw Object.assign(new Error('家长密码不正确'), { statusCode: 400 });
  const code = createRecoveryCode();
  await db()`INSERT INTO kousuan.recovery_codes(user_id,code_hash) VALUES(${user.id},${recoveryHash(code)})
    ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,created_at=now()`;
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
    passwordHash = await hashPassword(parsed.password);
  const rows = await db()`WITH consumed AS (
    DELETE FROM kousuan.recovery_codes c USING kousuan.users u
    WHERE c.user_id=u.id AND u.username=${username} AND u.is_active=true AND u.role IN ('parent','site_owner') AND c.code_hash=${recoveryHash(parsed.code)} RETURNING c.user_id
  ), updated AS (
    UPDATE kousuan.users SET password_hash=${passwordHash},must_change_password=false,updated_at=now() WHERE id IN(SELECT user_id FROM consumed) RETURNING id,family_id
  ), revoked AS (
    DELETE FROM kousuan.sessions WHERE user_id IN(SELECT id FROM updated)
  ), logged AS (
    INSERT INTO kousuan.audit_events(family_id,actor_user_id,target_user_id,action) SELECT family_id,id,id,'parent.password_recovered' FROM updated
  ) SELECT id FROM updated`;
  if (!rows.length)
    throw Object.assign(new Error('用户名或恢复码不正确，或恢复码已使用'), {
      statusCode: 400,
    });
  return send(res, 200, { ok: true });
}

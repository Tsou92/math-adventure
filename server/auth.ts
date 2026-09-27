import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  db,
  withTransaction,
  type TransactionClient,
  type TransactionRunner,
} from './db.js';

export type AppUser = {
  id: string;
  family_id: string | null;
  username: string;
  display_name: string;
  role: 'site_owner' | 'parent' | 'child';
  is_active: boolean;
  must_change_password: boolean;
};

const COOKIE_NAME = 'kousuan_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;

export function normalizeUsername(input: string) {
  return input.normalize('NFKC').trim().toLowerCase();
}

export function validateUsername(input: string) {
  const username = normalizeUsername(input);
  if (!/^[a-z0-9_\u4e00-\u9fff]{3,24}$/u.test(username)) {
    throw Object.assign(
      new Error('用户名需为 3–24 位中文、字母、数字或下划线'),
      { statusCode: 400 },
    );
  }
  return username;
}

export function validatePassword(password: string, role: 'parent' | 'child') {
  const min = role === 'parent' ? 10 : 6;
  if (
    password.length < min ||
    password.length > 128 ||
    Buffer.byteLength(password, 'utf8') > 512
  ) {
    throw Object.assign(new Error(`密码需为 ${min}–128 个字符`), {
      statusCode: 400,
    });
  }
  return password;
}

export function hashPassword(password: string) {
  return hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function readCookie(req: VercelRequest) {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(value.join('='));
  }
  return null;
}

/**
 * 事务内生成并写入 session，cookie 只在 COMMIT 成功后由调用方设置，
 * 避免事务回滚后客户端持有一个并不存在的 session。
 */
export interface SessionMaterial {
  token: string;
  tokenHash: string;
  expiresAt: string;
  userAgent: string;
}

export function makeSessionMaterial(req: VercelRequest): SessionMaterial {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: tokenHash(token),
    expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(),
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 500),
  };
}

export async function insertSession(
  tx: TransactionClient,
  userId: string,
  material: SessionMaterial,
) {
  await tx.query(
    `INSERT INTO kousuan.sessions (user_id, token_hash, expires_at, user_agent)
      VALUES ($1, $2, $3, $4)`,
    [userId, material.tokenHash, material.expiresAt, material.userAgent],
  );
}

export async function deleteUserSessions(
  tx: TransactionClient,
  userId: string,
) {
  await tx.query('DELETE FROM kousuan.sessions WHERE user_id = $1', [userId]);
}

export function setSessionCookie(res: VercelResponse, token: string) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`,
  );
}

export function clearSessionCookie(res: VercelResponse) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
}

export async function createSession(
  userId: string,
  req: VercelRequest,
  res: VercelResponse,
  runner: TransactionRunner = withTransaction,
  expectedPasswordHash?: string,
) {
  const material = makeSessionMaterial(req);
  await runner(async (tx) => {
    // 锁住 user 行再读取当前状态：改密会在同一行 FOR UPDATE 中提交新哈希，
    // 因此这里读到的哈希要么是改密前的，要么是改密后已失效的，不会插入旧凭据会话。
    const { rows } = await tx.query<{
      id: string;
      password_hash: string;
      is_active: boolean;
    }>(
      'SELECT id, password_hash, is_active FROM kousuan.users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const user = rows[0];
    if (!user || !user.is_active)
      throw Object.assign(new Error('登录状态已失效，请重新登录'), {
        statusCode: 401,
      });
    if (
      expectedPasswordHash !== undefined &&
      String(user.password_hash) !== expectedPasswordHash
    )
      throw Object.assign(new Error('登录状态已失效，请重新登录'), {
        statusCode: 401,
      });
    await insertSession(tx, userId, material);
  });
  setSessionCookie(res, material.token);
}

export async function destroySession(
  req: VercelRequest,
  res: VercelResponse,
  runner: TransactionRunner = withTransaction,
) {
  const token = readCookie(req);
  if (token) {
    await runner(async (tx) => {
      await tx.query('DELETE FROM kousuan.sessions WHERE token_hash = $1', [
        tokenHash(token),
      ]);
    });
  }
  clearSessionCookie(res);
}

export async function currentUser(req: VercelRequest): Promise<AppUser | null> {
  const token = readCookie(req);
  if (!token) return null;
  const rows =
    (await db()`SELECT u.id, u.family_id, u.username, u.display_name, u.role,
      u.is_active, u.must_change_password
    FROM kousuan.sessions s JOIN kousuan.users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash(token)} AND s.expires_at > now() AND u.is_active = true
    LIMIT 1`) as AppUser[];
  return rows[0] ?? null;
}

export async function requireUser(
  req: VercelRequest,
  roles?: AppUser['role'][],
) {
  const user = await currentUser(req);
  if (!user) throw Object.assign(new Error('请先登录'), { statusCode: 401 });
  if (roles && !roles.includes(user.role))
    throw Object.assign(new Error('没有操作权限'), { statusCode: 403 });
  return user;
}

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

/**
 * 修改密码：同一事务内锁 user 行、校验旧密码、更新密码、
 * 撤销该用户全部旧 session 并插入新 token；cookie 在提交成功后才设置。
 */
export async function changePassword(
  input: ChangePasswordInput,
  req: VercelRequest,
  res: VercelResponse,
  runner: TransactionRunner = withTransaction,
) {
  const material = makeSessionMaterial(req);
  await runner(async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      role: 'site_owner' | 'parent' | 'child';
      password_hash: string;
    }>(
      'SELECT id, role, password_hash FROM kousuan.users WHERE id = $1 FOR UPDATE',
      [input.userId],
    );
    const user = rows[0];
    if (!user)
      throw Object.assign(new Error('账号不存在'), { statusCode: 404 });
    const valid = await verify(
      String(user.password_hash),
      input.currentPassword,
    ).catch(() => false);
    if (!valid)
      throw Object.assign(new Error('当前密码不正确'), { statusCode: 400 });
    validatePassword(
      input.newPassword,
      user.role === 'child' ? 'child' : 'parent',
    );
    const passwordHash = await hashPassword(input.newPassword);
    await tx.query(
      `UPDATE kousuan.users SET password_hash = $2, must_change_password = false, updated_at = now()
        WHERE id = $1`,
      [input.userId, passwordHash],
    );
    await deleteUserSessions(tx, input.userId);
    await insertSession(tx, input.userId, material);
  });
  setSessionCookie(res, material.token);
  return { token: material.token };
}

export { verify as verifyPassword };

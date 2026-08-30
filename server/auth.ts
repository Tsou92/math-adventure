import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './db.js';

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
    throw new Error('用户名需为 3–24 位中文、字母、数字或下划线');
  }
  return username;
}

export function validatePassword(password: string, role: 'parent' | 'child') {
  const min = role === 'parent' ? 10 : 6;
  if (password.length < min || password.length > 128 || Buffer.byteLength(password, 'utf8') > 512) {
    throw new Error(`密码需为 ${min}–128 个字符`);
  }
  return password;
}

export function hashPassword(password: string) {
  return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
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

export async function createSession(userId: string, req: VercelRequest, res: VercelResponse) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000);
  const sql = db();
  await sql`INSERT INTO kousuan.sessions (user_id, token_hash, expires_at, user_agent)
    VALUES (${userId}, ${tokenHash(token)}, ${expires.toISOString()}, ${String(req.headers['user-agent'] ?? '').slice(0, 500)})`;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`);
}

export async function destroySession(req: VercelRequest, res: VercelResponse) {
  const token = readCookie(req);
  if (token) await db()`DELETE FROM kousuan.sessions WHERE token_hash = ${tokenHash(token)}`;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

export async function currentUser(req: VercelRequest): Promise<AppUser | null> {
  const token = readCookie(req);
  if (!token) return null;
  const rows = await db()`SELECT u.id, u.family_id, u.username, u.display_name, u.role,
      u.is_active, u.must_change_password
    FROM kousuan.sessions s JOIN kousuan.users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash(token)} AND s.expires_at > now() AND u.is_active = true
    LIMIT 1` as AppUser[];
  return rows[0] ?? null;
}

export async function requireUser(req: VercelRequest, roles?: AppUser['role'][]) {
  const user = await currentUser(req);
  if (!user) throw Object.assign(new Error('请先登录'), { statusCode: 401 });
  if (roles && !roles.includes(user.role)) throw Object.assign(new Error('没有操作权限'), { statusCode: 403 });
  return user;
}

export { verify as verifyPassword };

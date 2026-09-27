import { describe, expect, it } from 'vitest';
import {
  changePassword,
  createSession,
  hashPassword,
  normalizeUsername,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './auth';
import type { TransactionRunner } from './db';

describe('account security helpers', () => {
  it('统一全角和拉丁用户名', () => {
    expect(normalizeUsername(' Ｔｅｓｔ_01 ')).toBe('test_01');
    expect(validateUsername('小宇_01')).toBe('小宇_01');
    expect(() => validateUsername('a!')).toThrow();
  });

  it('家长密码要求高于孩子密码', () => {
    expect(validatePassword('123456', 'child')).toBe('123456');
    expect(() => validatePassword('123456', 'parent')).toThrow();
  });

  it('使用 Argon2id 哈希验证密码', async () => {
    const encoded = await hashPassword('safe-password-123');
    expect(encoded).toContain('$argon2id$');
    expect(await verifyPassword(encoded, 'safe-password-123')).toBe(true);
    expect(await verifyPassword(encoded, 'wrong-password')).toBe(false);
  });
});

function fakeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  };
}

describe('changePassword 与 session cookie', () => {
  it('事务提交成功后才设置会话 cookie', async () => {
    const oldHash = await hashPassword('old-password-123');
    const res = fakeRes();
    let cookieBeforeCommit: string | undefined;
    const runner: TransactionRunner = async (fn) => {
      const result = await fn({
        async query<R = Record<string, unknown>>(text: string) {
          if (text.includes('SELECT id, role, password_hash')) {
            return {
              rows: [
                { id: 'u1', role: 'parent', password_hash: oldHash },
              ] as R[],
            };
          }
          return { rows: [] as R[] };
        },
      });
      // 模拟 COMMIT 已完成，此时调用方尚未设置 cookie。
      cookieBeforeCommit = res.headers['Set-Cookie'];
      return result;
    };

    const outcome = await changePassword(
      {
        userId: 'u1',
        currentPassword: 'old-password-123',
        newPassword: 'new-password-456',
      },
      { headers: { 'user-agent': 'vitest' } } as never,
      res as never,
      runner,
    );

    expect(cookieBeforeCommit).toBeUndefined();
    expect(res.headers['Set-Cookie']).toContain('kousuan_session=');
    expect(outcome.token).toBeTruthy();
  });

  it('事务回滚时不设置会话 cookie', async () => {
    const oldHash = await hashPassword('old-password-123');
    const res = fakeRes();
    const runner: TransactionRunner = async (fn) => {
      await fn({
        async query<R = Record<string, unknown>>(text: string) {
          if (text.includes('SELECT id, role, password_hash')) {
            return {
              rows: [
                { id: 'u1', role: 'parent', password_hash: oldHash },
              ] as R[],
            };
          }
          return { rows: [] as R[] };
        },
      });
      throw new Error('模拟提交失败');
    };

    await expect(
      changePassword(
        {
          userId: 'u1',
          currentPassword: 'old-password-123',
          newPassword: 'new-password-456',
        },
        { headers: { 'user-agent': 'vitest' } } as never,
        res as never,
        runner,
      ),
    ).rejects.toThrow('模拟提交失败');
    expect(res.headers['Set-Cookie']).toBeUndefined();
  });
});

describe('createSession 并发改密防护', () => {
  function sessionRunner(
    row: { id: string; password_hash: string; is_active: boolean } | null,
  ) {
    const state = { inserted: false };
    const runner: TransactionRunner = async (fn) =>
      fn({
        async query<R = Record<string, unknown>>(text: string) {
          if (text.includes('SELECT id, password_hash, is_active')) {
            return { rows: (row ? [row] : []) as R[] };
          }
          if (text.includes('INSERT INTO kousuan.sessions'))
            state.inserted = true;
          return { rows: [] as R[] };
        },
      });
    return { runner, state };
  }

  const req = { headers: { 'user-agent': 'vitest' } } as never;

  it('校验的旧 hash 与锁后新 hash 不一致时拒绝且不插 session、不设 cookie', async () => {
    const res = fakeRes();
    const { runner, state } = sessionRunner({
      id: 'u1',
      password_hash: 'new-hash',
      is_active: true,
    });

    await expect(
      createSession('u1', req, res as never, runner, 'old-hash'),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(state.inserted).toBe(false);
    expect(res.headers['Set-Cookie']).toBeUndefined();
  });

  it('hash 未变时正常创建 session 并设置 cookie', async () => {
    const res = fakeRes();
    const { runner, state } = sessionRunner({
      id: 'u1',
      password_hash: 'same-hash',
      is_active: true,
    });

    await createSession('u1', req, res as never, runner, 'same-hash');
    expect(state.inserted).toBe(true);
    expect(res.headers['Set-Cookie']).toContain('kousuan_session=');
  });

  it('账号 inactive 时拒绝且不设 cookie', async () => {
    const res = fakeRes();
    const { runner, state } = sessionRunner({
      id: 'u1',
      password_hash: 'same-hash',
      is_active: false,
    });

    await expect(
      createSession('u1', req, res as never, runner, 'same-hash'),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(state.inserted).toBe(false);
    expect(res.headers['Set-Cookie']).toBeUndefined();
  });
});

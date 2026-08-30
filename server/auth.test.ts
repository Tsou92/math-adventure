import { describe, expect, it } from 'vitest';
import { hashPassword, normalizeUsername, validatePassword, validateUsername, verifyPassword } from './auth';

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


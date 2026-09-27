import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpState = vi.hoisted(() => ({ path: 'records', send: vi.fn() }));
const authState = vi.hoisted(() => ({
  requireUser: vi.fn(),
  currentUser: vi.fn(),
}));

vi.mock('./http.js', () => ({
  routePath: () => httpState.path,
  send: httpState.send,
  body: (value: unknown) => value,
  method: () => {},
}));

vi.mock('./auth.js', () => ({
  requireUser: authState.requireUser,
  currentUser: authState.currentUser,
  createSession: vi.fn(),
  deleteUserSessions: vi.fn(),
  destroySession: vi.fn(),
  hashPassword: vi.fn(),
  normalizeUsername: (value: string) => value,
  validatePassword: (value: string) => value,
  validateUsername: (value: string) => value,
  verifyPassword: vi.fn(),
  changePassword: vi.fn(),
}));

import { handleApi } from './router.js';

describe('handleApi 统一错误处理', () => {
  beforeEach(() => {
    httpState.path = 'records';
    httpState.send.mockReset();
    authState.requireUser.mockReset();
  });

  it('未预期异常统一返回 500 且不泄露内部信息', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    authState.requireUser.mockRejectedValue(
      new Error('connect ECONNREFUSED postgres://secret'),
    );

    const res = {};
    await handleApi({ method: 'GET', headers: {} } as never, res as never);

    expect(httpState.send).toHaveBeenCalledWith(res, 500, {
      error: '服务暂时不可用',
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('业务异常保留状态码与文案', async () => {
    authState.requireUser.mockRejectedValue(
      Object.assign(new Error('请先登录'), { statusCode: 401 }),
    );

    const res = {};
    await handleApi({ method: 'GET', headers: {} } as never, res as never);

    expect(httpState.send).toHaveBeenCalledWith(res, 401, {
      error: '请先登录',
    });
  });
});

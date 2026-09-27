import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, apiVoid } from './api-client';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('超过超时时间会抛出 API_TIMEOUT 并清理计时器', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);

    const promise = api('rounds/active');
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'API_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('调用方 AbortSignal 取消时以 AbortError 拒绝', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const promise = api('rounds/active', { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('HTTP 失败时保留原始 status 与 data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: '用户名已存在' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    const error = await api('auth/register', { method: 'POST' }).catch(
      (issue: unknown) => issue,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: '用户名已存在',
      status: 400,
      data: { error: '用户名已存在' },
    });
  });

  it('成功但响应体为空时给出清晰错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 })),
    );
    await expect(api('auth/logout', { method: 'POST' })).rejects.toMatchObject({
      code: 'EMPTY_RESPONSE',
    });
  });

  it('成功但响应体不是 JSON 时给出清晰错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('ok', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
    );
    await expect(api('health')).rejects.toMatchObject({
      code: 'INVALID_CONTENT_TYPE',
    });
  });

  it('apiVoid 允许没有任何响应体的成功响应', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(
      apiVoid('auth/logout', { method: 'POST' }),
    ).resolves.toBeUndefined();
  });

  it('响应头已返回但响应体读取挂起时同样在 15 秒超时', async () => {
    vi.useFakeTimers();
    const hanging = {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: () => new Promise<string>(() => undefined),
    } as unknown as Response;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => hanging),
    );

    const promise = api('rounds/active');
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'API_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('读取响应体期间调用方取消时以 AbortError 拒绝', async () => {
    const hanging = {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: () => new Promise<string>(() => undefined),
    } as unknown as Response;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => hanging),
    );
    const controller = new AbortController();

    const promise = api('rounds/active', { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

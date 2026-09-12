export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  let response: Response | undefined;
  const safeToRetry = !options?.method || options.method === 'GET';
  for (let attempt = 0; attempt < (safeToRetry ? 2 : 1); attempt++) {
    try {
      response = await fetch(`/api/${path}`, {
        ...options,
        headers,
        signal: options?.signal ?? AbortSignal.timeout(20_000),
      });
      if (response.status < 500 || !safeToRetry || attempt > 0) break;
    } catch {
      if (!safeToRetry || attempt > 0)
        throw new ApiError('连接暂时中断，请检查网络后重试。', 0, {});
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!response) throw new ApiError('连接暂时中断，请检查网络后重试。', 0, {});
  const data = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok)
    throw new ApiError(
      typeof data?.error === 'string'
        ? data.error
        : '服务暂时不可用，请稍后重试。',
      response.status,
      data ?? {},
    );
  if (data === null)
    throw new ApiError('服务器返回异常，请刷新重试。', response.status, {});
  return data as T;
}

export const jsonBody = (value: unknown) => JSON.stringify(value);

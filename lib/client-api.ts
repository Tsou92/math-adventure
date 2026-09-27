import { api as request, ApiError, apiVoid } from './api-client';

// live 界面沿用的导出契约保持不变，具体可靠性（超时、取消、空响应区分、
// 退出登录允许空 body）全部复用 main/lib/api-client.ts，避免重写。
export { ApiError, apiVoid };

/** 判断一次失败是否值得对幂等请求（GET）重试。 */
function retryable(error: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return false;
  if (error instanceof Error && error.name === 'AbortError') return false;
  if (error instanceof ApiError) return (error.status ?? 0) >= 500;
  // 网络层异常（main 客户端未包装成 ApiError 的连接失败）允许重试一次。
  return true;
}

/**
 * live 端请求入口：保留「GET 失败重试一次」的既有行为，其余直接委托
 * main 的客户端，因此请求超时/取消/清理与 main 保持一致。
 */
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const safeToRetry = !options.method || options.method === 'GET';
  try {
    return await request<T>(path, options);
  } catch (error) {
    if (!safeToRetry || !retryable(error, options.signal)) throw error;
    return request<T>(path, options);
  }
}

export const jsonBody = (value: unknown) => JSON.stringify(value);

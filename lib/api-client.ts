export const API_TIMEOUT_MS = 15_000;

export type ApiErrorInit = {
  status?: number;
  data?: unknown;
  code?: string;
};

export class ApiError extends Error {
  status?: number;
  data?: unknown;
  code?: string;

  constructor(message: string, init: ApiErrorInit = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = init.status;
    this.data = init.data;
    this.code = init.code;
  }
}

export type ApiRequestOptions = RequestInit & {
  timeoutMs?: number;
  baseUrl?: string;
  /** 允许成功响应没有响应体（例如 204 的退出登录）。 */
  allowEmptyBody?: boolean;
};

function toAbortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error('请求已取消');
  error.name = 'AbortError';
  return error;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const message = (data as { error?: unknown }).error;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

/**
 * 统一封装 fetch：15 秒超时覆盖整个 fetch + 读取响应体 + 解析过程，
 * 透传调用方 AbortSignal，并在结束（含超时/取消/异常）时清理计时器与监听器。
 * 成功但为空/非 JSON 的响应会抛出带 code 的清晰错误，HTTP 错误保留
 * 原始 status 与 data 供调用方判断（例如答案版本冲突）。
 */
export async function api<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    timeoutMs = API_TIMEOUT_MS,
    baseUrl = '/api',
    allowEmptyBody = false,
    ...init
  } = options;
  const callerSignal = init.signal ?? null;
  if (callerSignal?.aborted) throw toAbortError(callerSignal.reason);

  const controller = new AbortController();
  const cleanup: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const timeoutError = new ApiError('请求超时，请检查网络后重试', {
    code: 'API_TIMEOUT',
  });

  const abortPromise = new Promise<never>((_resolve, reject) => {
    if (!callerSignal) return;
    const onAbort = () => {
      controller.abort(callerSignal.reason);
      reject(toAbortError(callerSignal.reason));
    };
    callerSignal.addEventListener('abort', onAbort, { once: true });
    cleanup.push(() => callerSignal.removeEventListener('abort', onAbort));
  });

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    if (timeoutMs <= 0) return;
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');

  const operation = (async (): Promise<T> => {
    const response = await fetch(`${baseUrl}/${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });

    const text = await response.text();
    let data: unknown;
    if (text.length > 0) {
      const contentType = response.headers.get('content-type') ?? '';
      const looksJson = contentType.includes('json') || /^\s*[[{]/.test(text);
      if (looksJson) {
        data = parseJson(text);
        if (data === undefined) {
          if (!response.ok)
            throw new ApiError(`请求失败（${response.status}）`, {
              status: response.status,
              data: text,
            });
          throw new ApiError('服务器返回了无法解析的数据，请稍后重试', {
            status: response.status,
            code: 'INVALID_JSON',
            data: text,
          });
        }
      } else if (!response.ok) {
        data = text;
      } else {
        throw new ApiError('服务器返回了非 JSON 内容，请稍后重试', {
          status: response.status,
          code: 'INVALID_CONTENT_TYPE',
          data: text,
        });
      }
    } else if (!response.ok) {
      data = undefined;
    } else if (!allowEmptyBody) {
      throw new ApiError('服务器返回了空响应，请稍后重试', {
        status: response.status,
        code: 'EMPTY_RESPONSE',
      });
    }

    if (!response.ok) {
      throw new ApiError(
        readErrorMessage(data, `请求失败（${response.status}）`),
        { status: response.status, data },
      );
    }
    return data as T;
  })();

  try {
    // 超时/取消必须覆盖整个 fetch + 读体 + 解析，而不仅是拿到响应头。
    return await Promise.race([operation, timeoutPromise, abortPromise]);
  } catch (issue) {
    if (issue instanceof ApiError) throw issue;
    if (callerSignal?.aborted) throw toAbortError(callerSignal.reason);
    if (timedOut || controller.signal.aborted) throw timeoutError;
    throw issue instanceof Error
      ? issue
      : new ApiError('网络开小差了，请再试一次');
  } finally {
    if (timer !== null) clearTimeout(timer);
    for (const remove of cleanup) remove();
  }
}

/** 成功时不需要响应体的请求（例如退出登录、修改密码）。 */
export function apiVoid(
  path: string,
  options: ApiRequestOptions = {},
): Promise<void> {
  return api<void>(path, { ...options, allowEmptyBody: true });
}

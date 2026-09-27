import {
  Client,
  neon,
  neonConfig,
  type NeonQueryFunction,
} from '@neondatabase/serverless';

let client: NeonQueryFunction<false, false> | undefined;

/**
 * 原有 Neon HTTP 查询入口，读查询与旧脚本继续使用，不参与事务。
 */
export function db() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not configured');
  client ??= neon(databaseUrl);
  return client;
}

const CONNECTION_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 15_000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 15_000;

export interface TransactionQueryResult<R = Record<string, unknown>> {
  rows: R[];
}

/**
 * 事务内可用的最小结构接口。
 * 生产实现是 @neondatabase/serverless 的 Client（WebSocket 会话），
 * 单元测试可注入结构相同的假实现来验证 SQL 顺序与回滚。
 */
export interface TransactionClient {
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<TransactionQueryResult<R>>;
}

export interface TransactionSession extends TransactionClient {
  end(): Promise<void>;
}

export type TransactionRunner = <T>(
  fn: (tx: TransactionClient) => Promise<T>,
) => Promise<T>;

export interface TransactionOptions {
  createSession?: () => Promise<TransactionSession>;
}

export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === '23505') return true;
  return /23505|duplicate key value violates unique constraint/i.test(
    String((error as { message?: unknown } | null)?.message ?? error),
  );
}

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  return url;
}

function ensureWebSocket() {
  // Node >= 22.13 自带全局 WebSocket；仅在未配置时兜底设置。
  const ctor = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (
    ctor &&
    !(neonConfig as { webSocketConstructor?: unknown }).webSocketConstructor
  ) {
    (neonConfig as { webSocketConstructor?: unknown }).webSocketConstructor =
      ctor;
  }
}

async function openTransactionSession(): Promise<TransactionSession> {
  ensureWebSocket();
  const neonClient = new Client({
    connectionString: databaseUrl(),
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });
  try {
    await neonClient.connect();
  } catch (error) {
    // connect 失败时连接可能已半开，必须 end 关闭后再抛出，避免泄漏 WebSocket 会话。
    try {
      await neonClient.end();
    } catch {
      // 关闭失败不覆盖原始连接错误。
    }
    throw error;
  }
  return {
    async query<T = Record<string, unknown>>(
      text: string,
      params?: readonly unknown[],
    ): Promise<TransactionQueryResult<T>> {
      const result = await neonClient.query(text, params as unknown[]);
      return { rows: result.rows as T[] };
    },
    async end() {
      await neonClient.end();
    },
  };
}

/**
 * 每个调用创建并连接一个独立的 Client，在同一会话内 BEGIN / COMMIT / ROLLBACK，
 * finally 关闭连接；任何异常都保证回滚后再抛出。
 */
export async function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const open = options.createSession ?? openTransactionSession;
  const session = await open();
  let inTransaction = false;
  try {
    await session.query('BEGIN');
    inTransaction = true;
    const result = await fn(session);
    await session.query('COMMIT');
    inTransaction = false;
    return result;
  } catch (error) {
    if (inTransaction) {
      try {
        await session.query('ROLLBACK');
      } catch {
        // 连接已断开时忽略回滚失败，保留原始异常。
      }
      inTransaction = false;
    }
    throw error;
  } finally {
    try {
      await session.end();
    } catch {
      // 关闭失败不覆盖业务结果。
    }
  }
}

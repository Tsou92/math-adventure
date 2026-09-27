import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  connectError: null as Error | null,
  connectCalls: 0,
  endCalls: 0,
}));

vi.mock('@neondatabase/serverless', () => {
  class Client {
    constructor(_config: unknown) {}
    async connect() {
      state.connectCalls += 1;
      if (state.connectError) throw state.connectError;
    }
    async query() {
      return { rows: [] };
    }
    async end() {
      state.endCalls += 1;
    }
  }
  return { Client, neon: () => ({}), neonConfig: {} };
});

import { withTransaction, type TransactionSession } from './db';

function fakeSession(overrides: {
  query: (text: string) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
}): TransactionSession {
  return overrides as unknown as TransactionSession;
}

describe('withTransaction', () => {
  beforeEach(() => {
    state.connectError = null;
    state.connectCalls = 0;
    state.endCalls = 0;
    process.env.DATABASE_URL = 'postgres://user:pass@example/db';
  });

  it('按 BEGIN → 业务 → COMMIT → end 顺序执行并提交', async () => {
    const calls: string[] = [];
    const session = fakeSession({
      async query(text) {
        calls.push(text);
        return { rows: [] };
      },
      async end() {
        calls.push('end');
      },
    });

    const result = await withTransaction(
      async (tx) => {
        await tx.query('SELECT 1');
        return 42;
      },
      { createSession: async () => session },
    );

    expect(result).toBe(42);
    expect(calls).toEqual(['BEGIN', 'SELECT 1', 'COMMIT', 'end']);
  });

  it('业务抛错时回滚并原样抛出同一个错误', async () => {
    const calls: string[] = [];
    const boom = new Error('boom');
    const session = fakeSession({
      async query(text) {
        calls.push(text);
        return { rows: [] };
      },
      async end() {
        calls.push('end');
      },
    });

    await expect(
      withTransaction(
        async (tx) => {
          await tx.query('SELECT 1');
          throw boom;
        },
        { createSession: async () => session },
      ),
    ).rejects.toBe(boom);

    expect(calls).toEqual(['BEGIN', 'SELECT 1', 'ROLLBACK', 'end']);
  });

  it('COMMIT 失败时回滚并保留原始错误', async () => {
    const calls: string[] = [];
    const commitError = new Error('commit failed');
    const session = fakeSession({
      async query(text) {
        calls.push(text);
        if (text === 'COMMIT') throw commitError;
        return { rows: [] };
      },
      async end() {
        calls.push('end');
      },
    });

    await expect(
      withTransaction(async () => 'value', {
        createSession: async () => session,
      }),
    ).rejects.toBe(commitError);

    expect(calls).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK', 'end']);
  });

  it('end 关闭失败不覆盖业务结果', async () => {
    const session = fakeSession({
      async query() {
        return { rows: [] };
      },
      async end() {
        throw new Error('end failed');
      },
    });

    await expect(
      withTransaction(async () => 'ok', { createSession: async () => session }),
    ).resolves.toBe('ok');
  });

  it('ROLLBACK 失败时仍原样抛出业务错误', async () => {
    const calls: string[] = [];
    const boom = new Error('business failed');
    const session = fakeSession({
      async query(text) {
        calls.push(text);
        if (text === 'ROLLBACK') throw new Error('rollback failed');
        return { rows: [] };
      },
      async end() {
        calls.push('end');
      },
    });

    await expect(
      withTransaction(
        async () => {
          throw boom;
        },
        { createSession: async () => session },
      ),
    ).rejects.toBe(boom);
    expect(calls).toEqual(['BEGIN', 'ROLLBACK', 'end']);
  });

  it('openTransactionSession 连接失败时 end 关闭连接并原样抛出错误', async () => {
    const connectError = new Error('connect failed');
    state.connectError = connectError;

    await expect(withTransaction(async () => 'never')).rejects.toBe(
      connectError,
    );

    expect(state.connectCalls).toBe(1);
    expect(state.endCalls).toBe(1);
  });
});

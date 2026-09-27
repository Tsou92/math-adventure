import { Pool, type PoolClient } from 'pg';

export function testDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value)
    throw new Error(
      '集成测试需要显式设置 TEST_DATABASE_URL，不会读取 .env.local',
    );
  const database = new URL(value).pathname.slice(1);
  if (!database.endsWith('_test'))
    throw new Error('测试数据库名必须以 _test 结尾，禁止使用业务数据库');
  return value;
}

export const pool = new Pool({ connectionString: testDatabaseUrl(), max: 8 });

type Query = PromiseLike<Record<string, unknown>[]> & {
  text: string;
  values: unknown[];
};
function query(text: string, values: unknown[] = []): Query {
  return {
    text,
    values,
    // oxlint-disable-next-line unicorn/no-thenable -- Neon queries are lazy thenables; transaction() must not execute them before BEGIN.
    then(onfulfilled, onrejected) {
      return pool
        .query(text, values)
        .then((result) => result.rows as Record<string, unknown>[])
        .then(onfulfilled, onrejected);
    },
  };
}
const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) =>
    query(
      strings.reduce(
        (text, piece, index) => text + (index ? `$${index}` : '') + piece,
        '',
      ),
      values,
    ),
  {
    query,
    async transaction(queries: Query[]) {
      return withTransaction(async (client) => {
        const results = [];
        for (const item of queries)
          results.push((await client.query(item.text, item.values)).rows);
        return results;
      });
    },
  },
);

/** Keep production SQL intact, replacing only Neon's network transport with local PostgreSQL. */
export function db() {
  return sql;
}
export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

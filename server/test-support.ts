import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, pool, withTransaction } from './testing/postgres';
import type { TransactionRunner } from './db';

type Sql = ReturnType<typeof db>;
export type TestActor = {
  id: string;
  familyId: string;
  username: string;
  cookie: string;
};

/** Every application query is redirected to a freshly created, private test schema. */
export async function createIsolatedDatabase() {
  const client = db();
  const schema = `audit_test_${randomBytes(10).toString('hex')}`;
  if (!/^audit_test_[a-f0-9]{20}$/.test(schema))
    throw new Error('Invalid test schema');

  const sql = Object.assign(
    (parts: TemplateStringsArray, ...parameters: unknown[]) => {
      const scoped = parts.map((part) =>
        part.replaceAll('kousuan.', `${schema}.`),
      );
      if (scoped.some((part) => /\bkousuan\b/.test(part)))
        throw new Error('Unscoped application query refused');
      const template = Object.assign(scoped, {
        raw: [...scoped],
      }) as unknown as TemplateStringsArray;
      return client(template, ...parameters);
    },
    {
      transaction: client.transaction.bind(client),
      query: (text: string, values?: unknown[]) =>
        client.query(text.replaceAll('kousuan.', `${schema}.`), values),
    },
  ) as Sql;

  let created = false;
  const cleanup = async () => {
    if (created) {
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
      created = false;
    }
  };
  try {
    // CREATE without IF NOT EXISTS prevents claiming or cleaning another run's schema.
    await client.query(`CREATE SCHEMA ${schema}`);
    created = true;
    const migrations = [
      '001_initial.sql',
      '002_multiplication_questions.sql',
      '003_abacus_questions.sql',
      '004_learning_experience.sql',
      '005_multiply_mixed.sql',
    ];
    const statements = [];
    for (const migration of migrations) {
      const original = await readFile(
        new URL(`../db/migrations/${migration}`, import.meta.url),
        'utf8',
      );
      const scoped = original
        // Extensions are shared: tests neither create nor remove them.
        .replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/g, '')
        .replace(/CREATE SCHEMA IF NOT EXISTS kousuan;/g, '')
        .replaceAll('kousuan.', `${schema}.`);
      if (/\bkousuan\b/.test(scoped))
        throw new Error('Unscoped migration refused');
      for (const statement of scoped
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)) {
        statements.push(client.query(statement));
      }
    }
    await client.transaction(statements);
    const transaction: TransactionRunner = (work) =>
      withTransaction((tx) =>
        work({
          async query<R = Record<string, unknown>>(
            text: string,
            params?: readonly unknown[],
          ) {
            const result = await tx.query(
              text.replaceAll('kousuan.', `${schema}.`),
              params ? [...params] : undefined,
            );
            return { rows: result.rows as R[] };
          },
        }),
      );
    return {
      sql,
      cleanup: async () => {
        await cleanup();
        await pool.end();
      },
      transaction,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function seedTestFamily(sql: Sql, passwordHash: string) {
  await sql`TRUNCATE kousuan.families, kousuan.login_attempts CASCADE`;
  const firstFamily = randomUUID(),
    secondFamily = randomUUID();
  const entries = [
    ['parent', firstFamily],
    ['parent', secondFamily],
    ['child', firstFamily],
    ['child', firstFamily],
    ['child', secondFamily],
  ] as const;
  const statements = [
    sql`INSERT INTO kousuan.families(id,name) VALUES(${firstFamily},'集成测试家庭甲'),(${secondFamily},'集成测试家庭乙')`,
  ];
  const actors = entries.map(([role, familyId]) => {
    const id = randomUUID(),
      username = `test_${randomBytes(6).toString('hex')}`;
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    statements.push(
      sql`INSERT INTO kousuan.users(id,family_id,username,display_name,password_hash,role) VALUES(${id},${familyId},${username},'测试账号',${passwordHash},${role})`,
      sql`INSERT INTO kousuan.sessions(user_id,token_hash,expires_at) VALUES(${id},${tokenHash},now()+interval '1 day')`,
    );
    return { id, familyId, username, cookie: `kousuan_session=${token}` };
  });
  await sql.transaction(statements);
  const [parent, otherParent, child, sibling, otherChild] = actors;
  return { parent, otherParent, child, sibling, otherChild };
}

export function apiRequest(
  path: string,
  method: string,
  actor?: TestActor,
  body?: unknown,
  ip = '192.0.2.1',
) {
  return {
    method,
    body,
    url: `/api/${path}`,
    query: { path },
    headers: {
      host: 'test.invalid',
      origin: 'https://test.invalid',
      'x-forwarded-for': ip,
      ...(actor ? { cookie: actor.cookie } : {}),
    },
  } as unknown as VercelRequest;
}

export function apiResponse() {
  const result: {
    status: number;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  } = { status: 0, body: {}, headers: {} };
  const response = {
    status(status: number) {
      result.status = status;
      return response;
    },
    setHeader(name: string, value: string) {
      result.headers[name] = value;
      return response;
    },
    json(body: Record<string, unknown>) {
      result.body = body;
      return response;
    },
  } as unknown as VercelResponse;
  return { response, result };
}

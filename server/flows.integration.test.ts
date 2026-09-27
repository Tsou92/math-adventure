import { createHash, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool, withTransaction } from './testing/postgres';

vi.mock('./db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db')>()),
  ...(await import('./testing/postgres')),
}));
import { handleApi } from './router';
import { createSession, hashPassword } from './auth';

const families: string[] = [];
let userId: string;
let familyId: string;
let token: string;
let roundId: string;
let questionId: string;

async function request(
  path: string,
  body?: unknown,
  method = 'POST',
  session = token,
) {
  let status = 200;
  let data: Record<string, unknown> = {};
  const headers = new Map<string, string>();
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    setHeader(key: string, value: string) {
      headers.set(key.toLowerCase(), value);
      return this;
    },
    json(value: Record<string, unknown>) {
      data = value;
      return this;
    },
  } as unknown as VercelResponse;
  await handleApi(
    {
      method,
      query: { path },
      body,
      headers: { cookie: `kousuan_session=${session}` },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as VercelRequest,
    response,
  );
  return { status, data, headers };
}

beforeEach(async () => {
  familyId = randomUUID();
  userId = randomUUID();
  token = randomUUID();
  roundId = randomUUID();
  questionId = randomUUID();
  families.push(familyId);
  await pool.query('INSERT INTO kousuan.families(id,name) VALUES($1,$2)', [
    familyId,
    'integration-test',
  ]);
  await pool.query(
    "INSERT INTO kousuan.users(id,family_id,username,display_name,password_hash,role) VALUES($1,$2,$3,'测试孩子',$4,'child')",
    [userId, familyId, userId, await hashPassword('before-password')],
  );
  await pool.query(
    "INSERT INTO kousuan.sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [userId, createHash('sha256').update(token).digest('hex')],
  );
  await pool.query(
    "INSERT INTO kousuan.practice_rounds(id,user_id,family_id,idempotency_key,source,package_name,starter_count,explorer_count,challenger_count,total_count,seed,status,started_at) VALUES($1,$2,$3,$4,'custom','测试',1,0,0,1,1,'started',now())",
    [roundId, userId, familyId, randomUUID()],
  );
  await pool.query(
    "INSERT INTO kousuan.round_questions(id,round_id,position,level,expression,correct_answer) VALUES($1,$2,1,'starter','1 + 1',2)",
    [questionId, roundId],
  );
  await pool.query(
    'INSERT INTO kousuan.practice_answers(question_id,round_id,answer_text,client_version) VALUES($1,$2,$3,1)',
    [questionId, roundId, '3'],
  );
});

afterAll(async () => {
  for (const id of families)
    await pool.query('DELETE FROM kousuan.families WHERE id=$1', [id]);
  await pool.end();
});

describe('real PostgreSQL API flows', () => {
  it('concurrent and repeated submissions count each wrong answer once', async () => {
    const gate = await pool.connect();
    await gate.query('BEGIN');
    await gate.query(
      'SELECT id FROM kousuan.practice_rounds WHERE id=$1 FOR UPDATE',
      [roundId],
    );
    const submissions = Promise.all(
      Array.from({ length: 5 }, () => request(`rounds/${roundId}/submit`)),
    );
    let waiting = 0;
    try {
      // Hold the round until every request reaches a lock, forcing an actual overlap.
      for (let attempt = 0; attempt < 80; attempt++) {
        waiting = Number(
          (
            await pool.query(
              "SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
            )
          ).rows[0].n,
        );
        if (waiting >= 5) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      await gate.query('ROLLBACK');
      gate.release();
    }
    const results = await submissions;
    expect(waiting).toBeGreaterThanOrEqual(5);
    expect(
      (
        await pool.query(
          'SELECT mistake_count FROM kousuan.wrong_question_stats WHERE user_id=$1',
          [userId],
        )
      ).rows,
    ).toEqual([{ mistake_count: 1 }]);
    expect(results.map((result) => result.status)).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(
      (
        await pool.query(
          'SELECT mistake_count FROM kousuan.wrong_question_stats WHERE user_id=$1',
          [userId],
        )
      ).rows,
    ).toEqual([{ mistake_count: 1 }]);
    expect((await request(`rounds/${roundId}/submit`)).status).toBe(200);
    expect(
      (
        await pool.query(
          'SELECT mistake_count FROM kousuan.wrong_question_stats WHERE user_id=$1',
          [userId],
        )
      ).rows[0].mistake_count,
    ).toBe(1);
  });

  it('a stale answer makes the entire batch fail without a partial write', async () => {
    const secondId = randomUUID();
    await pool.query(
      'UPDATE kousuan.practice_rounds SET starter_count=2,total_count=2 WHERE id=$1',
      [roundId],
    );
    await pool.query(
      "INSERT INTO kousuan.round_questions(id,round_id,position,level,expression,correct_answer) VALUES($1,$2,2,'starter','2 + 2',4)",
      [secondId, roundId],
    );
    await pool.query(
      "INSERT INTO kousuan.practice_answers(question_id,round_id,answer_text,client_version) VALUES($1,$2,'4',2)",
      [secondId, roundId],
    );
    const result = await request(
      `rounds/${roundId}/answers`,
      {
        answers: [
          { questionId, answer: '2', clientVersion: 2 },
          { questionId: secondId, answer: '9', clientVersion: 1 },
        ],
      },
      'PATCH',
    );
    expect(result.status).toBe(409);
    expect(result.data.code).toBe('ANSWER_VERSION_STALE');
    expect(
      (
        await pool.query(
          'SELECT answer_text,client_version FROM kousuan.practice_answers WHERE question_id=$1',
          [questionId],
        )
      ).rows[0],
    ).toEqual({ answer_text: '3', client_version: 1 });
  });

  it('aggregates repeated wrong questions within one round without a bulk upsert failure', async () => {
    const secondId = randomUUID();
    await pool.query(
      'UPDATE kousuan.practice_rounds SET starter_count=2,total_count=2 WHERE id=$1',
      [roundId],
    );
    await pool.query(
      "INSERT INTO kousuan.round_questions(id,round_id,position,level,expression,correct_answer) VALUES($1,$2,2,'starter','1 + 1',2)",
      [secondId, roundId],
    );
    await pool.query(
      "INSERT INTO kousuan.practice_answers(question_id,round_id,answer_text,client_version) VALUES($1,$2,'8',1)",
      [secondId, roundId],
    );
    expect((await request(`rounds/${roundId}/submit`)).status).toBe(200);
    expect(
      (
        await pool.query(
          'SELECT mistake_count,last_answer FROM kousuan.wrong_question_stats WHERE user_id=$1',
          [userId],
        )
      ).rows,
    ).toEqual([{ mistake_count: 2, last_answer: '8' }]);
  });

  it('concurrent create requests recover one round and reject a competing intent with 409', async () => {
    await request(`rounds/${roundId}/abandon`);
    const input = {
      source: 'custom',
      challengerChain: false,
      idempotencyKey: randomUUID(),
      counts: {
        starter: 2,
        explorer: 0,
        challenger: 0,
        multiplyMeaning: 0,
        multiplyFacts: 0,
        abacusMove: 0,
        abacusMatch: 0,
        abacusCalculation: 0,
      },
    };
    const results = await Promise.all([
      request('rounds', input),
      request('rounds', input),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 201,
    ]);
    expect((results[0].data.round as { id: string }).id).toBe(
      (results[1].data.round as { id: string }).id,
    );
    expect(
      (await request('rounds', { ...input, idempotencyKey: randomUUID() }))
        .status,
    ).toBe(409);
  });

  it('submission and save cannot leave grading inconsistent with the stored answer', async () => {
    const results = await Promise.all([
      request(`rounds/${roundId}/submit`),
      request(
        `rounds/${roundId}/answers`,
        { answers: [{ questionId, answer: '2', clientVersion: 2 }] },
        'PATCH',
      ),
    ]);
    expect(results[0].status).toBe(200);
    expect([200, 409]).toContain(results[1].status);
    const row = (
      await pool.query(
        'SELECT r.score,a.answer_text,a.is_correct FROM kousuan.practice_rounds r JOIN kousuan.practice_answers a ON a.round_id=r.id WHERE r.id=$1',
        [roundId],
      )
    ).rows[0];
    expect(row.score).toBe(row.answer_text === '2' ? 100 : 0);
    expect(row.is_correct).toBe(row.answer_text === '2');
    expect(
      (
        await request(
          `rounds/${roundId}/answers`,
          { answers: [{ questionId, answer: '9', clientVersion: 3 }] },
          'PATCH',
        )
      ).status,
    ).toBe(409);
  });

  it('repeat recovers the same round for retrying the same idempotency key', async () => {
    await request(`rounds/${roundId}/submit`);
    const idempotencyKey = randomUUID();
    const results = await Promise.all([
      request(`rounds/${roundId}/repeat`, { idempotencyKey }),
      request(`rounds/${roundId}/repeat`, { idempotencyKey }),
    ]);
    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
    const rounds = await pool.query(
      'SELECT id FROM kousuan.practice_rounds WHERE user_id=$1 AND idempotency_key=$2',
      [userId, idempotencyKey],
    );
    expect(rounds.rows).toHaveLength(1);
    const retry = await request(`rounds/${roundId}/repeat`, { idempotencyKey });
    expect(retry.status).toBe(200);
    expect((retry.data.round as { id: string }).id).toBe(rounds.rows[0].id);
  });

  it('a login verified before password rotation cannot create a session afterwards', async () => {
    const verifiedHash = String(
      (
        await pool.query(
          'SELECT password_hash FROM kousuan.users WHERE id=$1',
          [userId],
        )
      ).rows[0].password_hash,
    );
    expect(
      (
        await request('auth/change-password', {
          currentPassword: 'before-password',
          newPassword: 'after-password',
        })
      ).status,
    ).toBe(200);
    const setHeader = vi.fn();
    await expect(
      createSession(
        userId,
        { headers: {} } as VercelRequest,
        { setHeader } as unknown as VercelResponse,
        withTransaction,
        verifiedHash,
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(setHeader).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM kousuan.sessions WHERE user_id=$1',
          [userId],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it('changing password revokes old sessions and returns a working replacement cookie', async () => {
    const old = token;
    const result = await request('auth/change-password', {
      currentPassword: 'before-password',
      newPassword: 'after-password',
    });
    expect(result.status).toBe(200);
    expect(result.headers.get('set-cookie')).toContain('kousuan_session=');
    expect(
      (await request('auth/me', undefined, 'GET', old)).data.user,
    ).toBeNull();
    const replacement = result.headers
      .get('set-cookie')!
      .split(';')[0]
      .split('=')[1];
    expect(
      (await request('auth/me', undefined, 'GET', replacement)).data.user,
    ).toMatchObject({ id: userId });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM kousuan.sessions WHERE user_id=$1',
          [userId],
        )
      ).rows[0].count,
    ).toBe(1);
  });
});

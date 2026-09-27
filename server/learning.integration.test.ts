import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { pool } from './testing/postgres';
import type { TransactionRunner } from './db';
import {
  createIsolatedDatabase,
  seedTestFamily,
  apiRequest,
  apiResponse,
  type TestActor,
} from './test-support';
import { hashPassword } from './auth';
import { handleApi } from './router';
import { defaultPreferences, emptyCounts } from '../lib/learning';
import type {
  LearningPreferences,
  LearningProgress,
  Round,
  RecordItem,
  WrongItem,
} from '../lib/types';
const state = vi.hoisted(() => ({
  sql: undefined as
    | Awaited<ReturnType<typeof createIsolatedDatabase>>['sql']
    | undefined,
  transaction: undefined as TransactionRunner | undefined,
}));
vi.mock('./db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db')>()),
  db: () => {
    if (!state.sql) throw new Error('Test database is not ready');
    return state.sql;
  },
  withTransaction: ((work) => {
    if (!state.transaction) throw new Error('Test transaction is not ready');
    return state.transaction(work);
  }) as TransactionRunner,
}));
let isolated: Awaited<ReturnType<typeof createIsolatedDatabase>>;
let family: Awaited<ReturnType<typeof seedTestFamily>>;
const password = 'Test-only-password-2026!';
async function request<T = Record<string, unknown>>(
  path: string,
  method: string,
  actor?: TestActor,
  body?: unknown,
) {
  const r = apiResponse();
  await handleApi(apiRequest(path, method, actor, body), r.response);
  return { status: r.result.status, body: r.result.body as T };
}
async function seedWrong(actor = family.child) {
  const id = randomUUID();
  await state.sql!`INSERT INTO kousuan.wrong_question_stats(id,user_id,expression,correct_answer,level,last_answer,question_key) VALUES(${id},${actor.id},'8 + 7',15,'explorer','14',${id})`;
  return id;
}
async function round(mode: 'practice' | 'challenge' = 'practice') {
  const created = await request<{ round: Round }>(
    'rounds',
    'POST',
    family.child,
    {
      source: 'custom',
      ...defaultPreferences,
      counts: { ...defaultPreferences.counts, starter: 2 },
      mode,
      idempotencyKey: randomUUID(),
    },
  );
  expect(created.status).toBe(201);
  const started = await request<{ round: Round }>(
    `rounds/${created.body.round.id}/start`,
    'POST',
    family.child,
  );
  expect(started.status).toBe(200);
  return started.body.round;
}
describe('learning API with isolated PostgreSQL schema', () => {
  beforeAll(async () => {
    isolated = await createIsolatedDatabase();
    state.sql = isolated.sql;
    state.transaction = isolated.transaction;
  }, 30_000);
  beforeEach(async () => {
    family = await seedTestFamily(state.sql!, await hashPassword(password));
  }, 20_000);
  afterAll(async () => {
    await isolated?.cleanup();
  }, 20_000);
  it('recovery revokes a session committed while it waits for the user lock', async () => {
    const issued = await request<{ recoveryCode: string }>(
      'auth/recovery-code',
      'POST',
      family.parent,
      { password },
    );
    expect(issued.status).toBe(200);
    const token = randomUUID();
    let acquired!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const login = state.transaction!(async (tx) => {
      await tx.query('SELECT id FROM kousuan.users WHERE id=$1 FOR UPDATE', [
        family.parent.id,
      ]);
      acquired();
      await held;
      await tx.query(
        "INSERT INTO kousuan.sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",
        [family.parent.id, createHash('sha256').update(token).digest('hex')],
      );
    });
    await ready;
    const recovery = request('auth/recover', 'POST', undefined, {
      username: family.parent.username,
      code: issued.body.recoveryCode,
      password: 'New-test-password-2026!',
    });
    let waiting = 0;
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        waiting = Number(
          (
            await pool.query(
              "SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%audit_test_%'",
            )
          ).rows[0].n,
        );
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      release();
    }
    await login;
    expect((await recovery).status).toBe(200);
    expect(waiting).toBeGreaterThan(0);
    const me = await request<{ user: unknown }>('auth/me', 'GET', {
      ...family.parent,
      cookie: `kousuan_session=${token}`,
    });
    expect(me.body.user).toBeNull();
  });

  it('fills the new count for saved legacy preferences and rejects invalid new counts', async () => {
    const { multiplyMixed: _unused, ...legacyCounts } =
      defaultPreferences.counts;
    const legacy = { ...defaultPreferences, counts: legacyCounts };
    await state.sql!`INSERT INTO kousuan.learning_preferences(user_id,settings) VALUES(${family.child.id},${JSON.stringify(legacy)}::jsonb)`;
    const saved = await request<{ preferences: LearningPreferences }>(
      'learning/preferences',
      'GET',
      family.child,
    );
    expect(saved.status).toBe(200);
    expect(saved.body.preferences.counts).toEqual(defaultPreferences.counts);
    const created = await request<{ round: Round }>(
      'rounds',
      'POST',
      family.child,
      {
        ...legacy,
        source: 'custom',
        idempotencyKey: randomUUID(),
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.round.counts.multiplyMixed).toBe(0);
    for (const count of [-1, 51, 1.5]) {
      const input = {
        ...defaultPreferences,
        counts: { ...emptyCounts, multiplyMixed: count },
      };
      expect(
        (await request('learning/preferences', 'PUT', family.child, input))
          .status,
      ).toBe(400);
      expect(
        (
          await request('rounds', 'POST', family.child, {
            ...input,
            source: 'custom',
            idempotencyKey: randomUUID(),
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await request('rounds', 'POST', family.child, {
          ...defaultPreferences,
          counts: {
            ...emptyCounts,
            starter: 50,
            explorer: 1,
            multiplyMixed: 50,
          },
          source: 'custom',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(400);
  }, 30_000);

  it('persists, grades, reviews and repeats multiplication mixed rounds with a stable completion time', async () => {
    const settings = {
      ...defaultPreferences,
      counts: { ...emptyCounts, multiplyMixed: 4 },
    };
    expect(
      (await request('learning/preferences', 'PUT', family.child, settings))
        .status,
    ).toBe(200);
    const preferences = await request<{ preferences: LearningPreferences }>(
      `parent/children/${family.child.id}/preferences`,
      'GET',
      family.parent,
    );
    expect(preferences.body.preferences.counts.multiplyMixed).toBe(4);
    const created = await request<{ round: Round }>(
      'rounds',
      'POST',
      family.child,
      {
        ...settings,
        source: 'custom',
        idempotencyKey: randomUUID(),
      },
    );
    expect(created.status).toBe(201);
    const r = created.body.round;
    expect(r.counts).toEqual(settings.counts);
    expect(r.questions).toHaveLength(4);
    expect(
      r.questions.every(
        (q) => q.level === 'multiplyMixed' && q.correctAnswer === undefined,
      ),
    ).toBe(true);
    expect(
      (await request(`rounds/${r.id}/start`, 'POST', family.child)).status,
    ).toBe(200);
    const questions =
      await state.sql!`SELECT id,correct_answer FROM kousuan.round_questions WHERE round_id=${r.id} ORDER BY position`;
    const answers = questions.map((q, i) => ({
      questionId: q.id,
      answer: i === 0 ? '9999' : String(q.correct_answer),
      clientVersion: 1,
    }));
    expect(
      (
        await request(`rounds/${r.id}/answers`, 'PATCH', family.child, {
          answers,
        })
      ).status,
    ).toBe(200);
    const submitted = await request<{ result: RecordItem; round: Round }>(
      `rounds/${r.id}/submit`,
      'POST',
      family.child,
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.result.correct_count).toBe(3);
    expect(submitted.body.result.score).toBe(75);
    expect(submitted.body.result.multiply_mixed_count).toBe(4);
    const completedAt = submitted.body.result.completed_at;
    expect(Number.isFinite(Date.parse(completedAt))).toBe(true);
    expect(submitted.body.round.completedAt).toEqual(completedAt);
    const again = await request<{ result: RecordItem }>(
      `rounds/${r.id}/submit`,
      'POST',
      family.child,
    );
    expect(again.body.result.completed_at).toEqual(completedAt);
    const history = await request<{ records: RecordItem[] }>(
      'records',
      'GET',
      family.child,
    );
    expect(history.status).toBe(200);
    expect(history.body.records[0].multiply_mixed_count).toBe(4);
    expect(history.body.records[0].completed_at).toEqual(completedAt);
    const wrong = await request<{ wrongQuestions: WrongItem[] }>(
      'wrong-book',
      'GET',
      family.child,
    );
    expect(wrong.body.wrongQuestions).toHaveLength(1);
    const item = wrong.body.wrongQuestions[0];
    expect(item.level).toBe('multiplyMixed');
    const reviewed = await request(
      `wrong-book/${item.id}/review`,
      'POST',
      family.child,
      {
        answer: String(item.correct_answer),
        attemptId: randomUUID(),
      },
    );
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.correct).toBe(true);
    const stats = await request<LearningProgress>(
      'learning/progress',
      'GET',
      family.child,
    );
    expect(stats.body.topics).toContainEqual(
      expect.objectContaining({
        level: 'multiplyMixed',
        attempted: 4,
        correct: 3,
      }),
    );
    const repeat = await request<{ round: Round }>(
      `rounds/${r.id}/repeat`,
      'POST',
      family.child,
      { idempotencyKey: randomUUID() },
    );
    expect(repeat.status).toBe(201);
    expect(repeat.body.round.counts).toEqual(settings.counts);
    expect(repeat.body.round.questions).toHaveLength(4);
    expect(repeat.body.round.completedAt).toBeNull();
  }, 30_000);
  it('persists preferences and enforces ownership and counts', async () => {
    const settings = { ...defaultPreferences, mode: 'challenge' as const };
    expect(
      (
        await request(
          `parent/children/${family.child.id}/preferences`,
          'PUT',
          family.parent,
          settings,
        )
      ).status,
    ).toBe(200);
    const data = await request<{ preferences: LearningPreferences }>(
      'learning/preferences',
      'GET',
      family.child,
    );
    expect(data.body.preferences.mode).toBe('challenge');
    expect(
      (
        await request(
          `parent/children/${family.child.id}/preferences`,
          'GET',
          family.otherParent,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request('learning/preferences', 'PUT', family.child, {
          ...settings,
          counts: { ...settings.counts, abacusMatch: 1 },
        })
      ).status,
    ).toBe(400);
    expect((await request('learning/preferences', 'GET')).status).toBe(401);
  }, 20_000);
  it('saves reviews once, preserves state and prevents immediate mastery farming', async () => {
    const id = await seedWrong();
    const input = { answer: '15', attemptId: randomUUID() };
    const first = await request<{ item: WrongItem; correct: boolean }>(
      `wrong-book/${id}/review`,
      'POST',
      family.child,
      input,
    );
    expect(first.status).toBe(200);
    expect(first.body.correct).toBe(true);
    expect(first.body.item.correct_streak).toBe(1);
    const duplicate = await request<{ item: WrongItem }>(
      `wrong-book/${id}/review`,
      'POST',
      family.child,
      input,
    );
    expect(duplicate.body.item.review_count).toBe(1);
    const again = await request<{ item: WrongItem }>(
      `wrong-book/${id}/review`,
      'POST',
      family.child,
      { answer: '15', attemptId: randomUUID() },
    );
    expect(again.body.item.correct_streak).toBe(1);
    expect(again.body.item.mastered_at).toBeNull();
    const reloaded = await request<{ wrongQuestions: WrongItem[] }>(
      'wrong-book',
      'GET',
      family.child,
    );
    expect(reloaded.body.wrongQuestions[0].review_count).toBe(2);
    expect(
      (
        await request(`wrong-book/${id}/review`, 'POST', family.sibling, {
          answer: '15',
          attemptId: randomUUID(),
        })
      ).status,
    ).toBe(409);
  }, 20_000);
  it('advances spaced reviews, marks mastery, and resets after a wrong answer', async () => {
    const id = await seedWrong();
    for (let i = 1; i <= 3; i++) {
      await state.sql!`UPDATE kousuan.wrong_question_stats SET next_review_at=now()-interval '1 minute' WHERE id=${id}`;
      const review = await request<{ item: WrongItem }>(
        `wrong-book/${id}/review`,
        'POST',
        family.child,
        { answer: '15', attemptId: randomUUID() },
      );
      expect(review.body.item.correct_streak).toBe(i);
      if (i === 3) expect(review.body.item.mastered_at).not.toBeNull();
    }
    const failed = await request<{ item: WrongItem; correct: boolean }>(
      `wrong-book/${id}/review`,
      'POST',
      family.child,
      { answer: '14', attemptId: randomUUID() },
    );
    expect(failed.body.correct).toBe(false);
    expect(failed.body.item.correct_streak).toBe(0);
    expect(failed.body.item.mastered_at).toBeNull();
  }, 20_000);
  it('serializes concurrent duplicate attempts', async () => {
    const id = await seedWrong();
    const body = { answer: '15', attemptId: randomUUID() };
    const results = await Promise.all([
      request(`wrong-book/${id}/review`, 'POST', family.child, body),
      request(`wrong-book/${id}/review`, 'POST', family.child, body),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const rows =
      await state.sql!`SELECT review_count,correct_streak FROM kousuan.wrong_question_stats WHERE id=${id}`;
    expect(rows[0].review_count).toBe(1);
    expect(rows[0].correct_streak).toBe(1);
  }, 20_000);
  it('only practice mode can check before submitting and never exposes answers', async () => {
    const r = await round('challenge');
    const q = r.questions[0];
    expect(q.correctAnswer).toBeUndefined();
    expect(
      (
        await request(`rounds/${r.id}/check`, 'POST', family.child, {
          questionId: q.id,
          answer: '5',
        })
      ).status,
    ).toBe(403);
    await request(`rounds/${r.id}/abandon`, 'POST', family.child);
    const p = await round('practice');
    const check = await request(`rounds/${p.id}/check`, 'POST', family.child, {
      questionId: p.questions[0].id,
      answer: '5',
    });
    expect(check.status).toBe(200);
    expect(typeof check.body.correct).toBe('boolean');
    expect(check.body.correctAnswer).toBeUndefined();
    expect(
      (
        await request(`rounds/${p.id}/check`, 'POST', family.otherChild, {
          questionId: p.questions[0].id,
          answer: '5',
        })
      ).status,
    ).toBe(403);
  }, 20_000);
  it('round answers survive reload and completed rounds feed parent statistics', async () => {
    const r = await round();
    const dbQuestions =
      await state.sql!`SELECT id,correct_answer FROM kousuan.round_questions WHERE round_id=${r.id}`;
    const answers = dbQuestions.map((q) => ({
      questionId: q.id,
      answer: String(q.correct_answer),
      clientVersion: 1,
    }));
    expect(
      (
        await request(`rounds/${r.id}/answers`, 'PATCH', family.child, {
          answers,
        })
      ).status,
    ).toBe(200);
    const active = await request<{ round: Round }>(
      'rounds/active',
      'GET',
      family.child,
    );
    expect(active.body.round.questions.every((q) => q.answer !== '')).toBe(
      true,
    );
    expect(
      (await request(`rounds/${r.id}/submit`, 'POST', family.child)).status,
    ).toBe(200);
    const stats = await request<LearningProgress>(
      `parent/children/${family.child.id}/progress`,
      'GET',
      family.parent,
    );
    expect(stats.status).toBe(200);
    expect(stats.body.summary.questions).toBe(2);
    expect(stats.body.topics[0].correct).toBe(2);
    expect(
      (
        await request(
          `parent/children/${family.child.id}/progress`,
          'GET',
          family.otherParent,
        )
      ).status,
    ).toBe(404);
  }, 20_000);
  it('batch saving rejects stale versions and duplicate question IDs', async () => {
    const r = await round();
    const answers = r.questions.map((q) => ({
      questionId: q.id,
      answer: '5',
      clientVersion: 2,
    }));
    expect(
      (
        await request(`rounds/${r.id}/answers`, 'PATCH', family.child, {
          answers,
        })
      ).status,
    ).toBe(200);
    const conflict = await request(
      `rounds/${r.id}/answers`,
      'PATCH',
      family.child,
      {
        answers: answers.map((a) => ({
          ...a,
          answer: '4',
          clientVersion: 1,
        })),
      },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('ANSWER_VERSION_STALE');
    expect(conflict.body.answerText).toBe('5');
    expect(
      (
        await request(`rounds/${r.id}/answers`, 'PATCH', family.child, {
          answers: [answers[0], answers[0]],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`rounds/${r.id}/answers`, 'PATCH', family.child, {
          answers: answers.map((a) => ({
            ...a,
            answer: '4',
            clientVersion: 3,
          })),
        })
      ).status,
    ).toBe(200);
  }, 20_000);
  it('grades concurrent submissions once and refuses post-submission answer changes', async () => {
    const r = await round();
    const answers = r.questions.map((q) => ({
      questionId: q.id,
      answer: '9999',
      clientVersion: 1,
    }));
    expect(
      (await request(`rounds/${r.id}/submit`, 'POST', family.child)).status,
    ).toBe(400);
    expect(
      (
        await request(`rounds/${r.id}/answers`, 'PATCH', family.child, {
          answers,
        })
      ).status,
    ).toBe(200);
    const submitted = await Promise.all([
      request(`rounds/${r.id}/submit`, 'POST', family.child),
      request(`rounds/${r.id}/submit`, 'POST', family.child),
    ]);
    expect(submitted.map((r) => r.status)).toEqual([200, 200]);
    const wrong =
      await state.sql!`SELECT sum(mistake_count)::int AS count FROM kousuan.wrong_question_stats WHERE user_id=${family.child.id}`;
    expect(wrong[0].count).toBe(2);
    expect(
      (
        await request(`rounds/${r.id}/answers`, 'PATCH', family.child, {
          answers: answers.map((a) => ({
            ...a,
            answer: '1',
            clientVersion: 2,
          })),
        })
      ).status,
    ).toBe(409);
    const stored =
      await state.sql!`SELECT answer_text,is_correct FROM kousuan.practice_answers WHERE round_id=${r.id}`;
    expect(
      stored.every((a) => a.answer_text === '9999' && a.is_correct === false),
    ).toBe(true);
  }, 20_000);
  it('recovery codes are single use and revoke existing sessions', async () => {
    const issued = await request<{ recoveryCode: string }>(
      'auth/recovery-code',
      'POST',
      family.parent,
      { password },
    );
    expect(issued.status).toBe(200);
    expect(typeof issued.body.recoveryCode).toBe('string');
    const input = {
      username: family.parent.username,
      code: issued.body.recoveryCode,
      password: 'Changed-test-password-2026!',
    };
    expect(
      (await request('auth/recover', 'POST', undefined, input)).status,
    ).toBe(200);
    expect(
      (
        await request('auth/recovery-code', 'POST', family.parent, {
          password,
        })
      ).status,
    ).toBe(401);
    expect(
      (await request('auth/recover', 'POST', undefined, input)).status,
    ).toBe(400);
    expect(
      (
        await request('auth/login', 'POST', undefined, {
          username: family.parent.username,
          password: input.password,
        })
      ).status,
    ).toBe(200);
  }, 20_000);
  it('requires the parent password to rotate a code and refuses child issuance', async () => {
    expect(
      (
        await request('auth/recovery-code', 'POST', family.parent, {
          password: 'incorrect',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request('auth/recovery-code', 'POST', family.child, {
          password,
        })
      ).status,
    ).toBe(403);
  }, 20_000);
  it('switches into only an active child in the same family', async () => {
    expect(
      (
        await request(
          `parent/children/${family.otherChild.id}/enter`,
          'POST',
          family.parent,
        )
      ).status,
    ).toBe(404);
    const data = await request<{ user: { id: string; role: string } }>(
      `parent/children/${family.child.id}/enter`,
      'POST',
      family.parent,
    );
    expect(data.status).toBe(200);
    expect(data.body.user.id).toBe(family.child.id);
    expect(data.body.user.role).toBe('child');
    expect(
      (await request('parent/children', 'GET', family.parent)).status,
    ).toBe(401);
  }, 20_000);
});

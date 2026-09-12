import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import {
  createIsolatedDatabase,
  seedTestFamily,
  apiRequest,
  apiResponse,
  type TestActor,
} from './test-support';
import { hashPassword } from './auth';
import { handleApi } from './router';
import { defaultPreferences } from '../lib/learning';
import type {
  LearningPreferences,
  LearningProgress,
  Round,
  WrongItem,
} from '../lib/types';
const state = vi.hoisted(() => ({
  sql: undefined as NeonQueryFunction<false, false> | undefined,
}));
vi.mock('./db.js', () => ({
  db: () => {
    if (!state.sql) throw new Error('Test database is not ready');
    return state.sql;
  },
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
describe.skipIf(!process.env.DATABASE_URL)(
  'learning API with isolated PostgreSQL schema',
  () => {
    beforeAll(async () => {
      isolated = await createIsolatedDatabase();
      state.sql = isolated.sql;
    }, 30_000);
    beforeEach(async () => {
      family = await seedTestFamily(state.sql!, await hashPassword(password));
    }, 20_000);
    afterAll(async () => {
      await isolated?.cleanup();
    }, 20_000);
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
      const check = await request(
        `rounds/${p.id}/check`,
        'POST',
        family.child,
        { questionId: p.questions[0].id, answer: '5' },
      );
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
  },
);

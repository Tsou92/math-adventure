import { describe, expect, it } from 'vitest';
import type { TransactionClient, TransactionRunner } from './db';
import {
  createRound,
  repeatRound,
  saveAnswers,
  submitRound,
} from './round-service';
import type { QuestionCounts } from '../lib/questions.js';

type QueryCall = { text: string; params: readonly unknown[] };

function fakeTransaction(
  handler: (text: string, params: readonly unknown[]) => unknown[],
) {
  const calls: QueryCall[] = [];
  const tx = {
    async query(text: string, params: readonly unknown[] = []) {
      calls.push({ text, params });
      return { rows: handler(text, params) };
    },
  };
  const runner: TransactionRunner = (fn) =>
    fn(tx as unknown as TransactionClient);
  return { calls, runner };
}

function retryingRunner(inner: TransactionRunner) {
  let attempts = 0;
  const runner: TransactionRunner = async (fn) => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(
        new Error('duplicate key value violates unique constraint'),
        {
          code: '23505',
        },
      );
    }
    return inner(fn);
  };
  return { runner, attempts: () => attempts };
}

const counts: QuestionCounts = {
  starter: 1,
  explorer: 0,
  challenger: 0,
  multiplyMeaning: 0,
  multiplyFacts: 0,
  abacusMove: 0,
  abacusMatch: 0,
  abacusCalculation: 0,
};

describe('saveAnswers 事务内顺序与冲突', () => {
  it('先锁定轮次再读取现有答案，最后才写入', async () => {
    const { calls, runner } = fakeTransaction((text) => {
      if (text.includes('practice_rounds') && text.includes('FOR UPDATE')) {
        return [{ id: 'round-1', user_id: 'u1', status: 'started' }];
      }
      if (text.includes('LEFT JOIN kousuan.practice_answers')) {
        return [{ question_id: 'q1', answer_text: null, client_version: 0 }];
      }
      return [];
    });

    const { saved } = await saveAnswers(
      'u1',
      'round-1',
      [{ questionId: 'q1', answer: '7', clientVersion: 1 }],
      runner,
    );

    expect(saved).toEqual([
      { questionId: 'q1', answerText: '7', clientVersion: 1 },
    ]);
    expect(calls[0].text).toContain('FOR UPDATE');
    expect(calls[1].text).toContain('LEFT JOIN kousuan.practice_answers');
    expect(
      calls.some((call) =>
        call.text.includes('INSERT INTO kousuan.practice_answers'),
      ),
    ).toBe(true);
  });

  it('批次内出现过期版本时整批不写', async () => {
    const { calls, runner } = fakeTransaction((text) => {
      if (text.includes('practice_rounds') && text.includes('FOR UPDATE')) {
        return [{ id: 'round-1', user_id: 'u1', status: 'started' }];
      }
      if (text.includes('LEFT JOIN kousuan.practice_answers')) {
        return [
          { question_id: 'q1', answer_text: '5', client_version: 2 },
          { question_id: 'q2', answer_text: '4', client_version: 1 },
        ];
      }
      return [];
    });

    await expect(
      saveAnswers(
        'u1',
        'round-1',
        [
          { questionId: 'q1', answer: '6', clientVersion: 1 },
          { questionId: 'q2', answer: '4', clientVersion: 2 },
        ],
        runner,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'ANSWER_VERSION_STALE' },
    });

    expect(calls[1].text).toContain('LEFT JOIN kousuan.practice_answers');
    expect(
      calls.some((call) =>
        call.text.includes('INSERT INTO kousuan.practice_answers'),
      ),
    ).toBe(false);
  });
});

describe('submitRound 幂等与错题聚合', () => {
  it('已交卷轮次重复 submit 只返回既有成绩且不写库', async () => {
    const completed = {
      id: 'round-1',
      user_id: 'u1',
      status: 'completed',
      score: 80,
      correct_count: 4,
      total_count: 5,
      duration_seconds: 30,
      completed_at: '2026-01-01T00:00:00.000Z',
    };
    const { calls, runner } = fakeTransaction(() => [completed]);

    const outcome = await submitRound('u1', 'round-1', runner);

    expect(outcome).toMatchObject({
      roundId: 'round-1',
      alreadyCompleted: true,
    });
    expect(outcome.result).toMatchObject({ score: 80, correct_count: 4 });
    expect(calls).toHaveLength(1);
    expect(
      calls.some((call) => call.text.includes('wrong_question_stats')),
    ).toBe(false);
  });

  it('同一轮重复 question_key 的错题先聚合再写，最后一条答案与 promptData 生效', async () => {
    const questionRows = [
      {
        id: 'rq1',
        expression: '1 + 2',
        correct_answer: 3,
        level: 'starter',
        prompt_data: { version: 1 },
        answer_text: '3',
      },
      {
        id: 'rq2',
        expression: '1 + 2',
        correct_answer: 3,
        level: 'abacusMatch',
        prompt_data: {
          version: 1,
          groupId: 'abacus-match-1',
          optionValues: [3, 5],
        },
        answer_text: '9',
      },
      {
        id: 'rq3',
        expression: '1 + 2',
        correct_answer: 3,
        level: 'abacusMatch',
        prompt_data: {
          version: 1,
          groupId: 'abacus-match-2',
          optionValues: [3, 7],
        },
        answer_text: '8',
      },
      {
        id: 'rq4',
        expression: '4 + 5',
        correct_answer: 9,
        level: 'abacusMatch',
        prompt_data: {
          version: 1,
          groupId: 'abacus-match-3',
          optionValues: [9, 11],
        },
        answer_text: '10',
      },
    ];
    const resultRow = {
      score: 25,
      correct_count: 1,
      total_count: 4,
      duration_seconds: 12,
      completed_at: '2026-01-01T00:00:00.000Z',
    };
    const { calls, runner } = fakeTransaction((text) => {
      if (text.includes('practice_rounds') && text.includes('FOR UPDATE')) {
        return [{ id: 'round-1', user_id: 'u1', status: 'started' }];
      }
      if (text.includes('SELECT q.id, q.expression')) return questionRows;
      if (text.includes('UPDATE kousuan.practice_answers')) return [];
      if (text.includes('INSERT INTO kousuan.wrong_question_stats')) return [];
      if (text.includes('RETURNING score')) return [resultRow];
      return [];
    });

    const outcome = await submitRound('u1', 'round-1', runner);

    expect(outcome.alreadyCompleted).toBe(false);
    expect(outcome.result).toMatchObject({ score: 25, correct_count: 1 });

    const wrongCall = calls.find((call) =>
      call.text.includes('INSERT INTO kousuan.wrong_question_stats'),
    );
    expect(wrongCall).toBeDefined();
    expect(wrongCall?.text).toContain('excluded.mistake_count');

    const payload = JSON.parse(String(wrongCall?.params[1])) as Array<
      Record<string, unknown>
    >;
    expect(payload).toHaveLength(2);
    const merged = payload.find((row) => row.mistake_count === 2);
    expect(merged).toMatchObject({
      expression: '1 + 2',
      correct_answer: 3,
      level: 'abacusMatch',
      last_answer: '8',
      mistake_count: 2,
    });
    expect(merged?.prompt_data).toMatchObject({ groupId: 'abacus-match-2' });
    expect(payload.find((row) => row.mistake_count === 1)).toMatchObject({
      expression: '4 + 5',
      last_answer: '10',
    });
  });
});

describe('createRound / repeatRound 重试幂等', () => {
  it('createRound 命中 idempotency_key 时返回已有轮次且不插入', async () => {
    const { calls, runner } = fakeTransaction((text) => {
      if (text.includes('SELECT id, family_id FROM kousuan.users')) {
        return [{ id: 'u1', family_id: 'f1' }];
      }
      if (text.includes('idempotency_key = $2'))
        return [{ id: 'round-existing' }];
      return [];
    });

    const outcome = await createRound(
      'u1',
      { counts, challengerChain: false, idempotencyKey: 'key-1' },
      runner,
    );

    expect(outcome).toEqual({ roundId: 'round-existing', existing: true });
    expect(
      calls.some((call) =>
        call.text.includes('INSERT INTO kousuan.practice_rounds'),
      ),
    ).toBe(false);
  });

  it('createRound 唯一约束冲突后重查命中已有轮次', async () => {
    const { runner: inner } = fakeTransaction((text) => {
      if (text.includes('idempotency_key = $2'))
        return [{ id: 'round-recovered' }];
      return [];
    });
    const { runner, attempts } = retryingRunner(inner);

    const outcome = await createRound(
      'u1',
      { counts, challengerChain: false, idempotencyKey: 'key-2' },
      runner,
    );

    expect(outcome).toEqual({ roundId: 'round-recovered', existing: true });
    expect(attempts()).toBe(2);
  });

  it('repeatRound 命中 idempotency_key 时返回已有轮次且不插入', async () => {
    const { calls, runner } = fakeTransaction((text) => {
      if (text.includes('SELECT id, family_id FROM kousuan.users')) {
        return [{ id: 'u1', family_id: 'f1' }];
      }
      if (text.includes('idempotency_key = $2'))
        return [{ id: 'round-existing' }];
      return [];
    });

    const outcome = await repeatRound('u1', 'source-round', 'key-3', runner);

    expect(outcome).toEqual({ roundId: 'round-existing', existing: true });
    expect(
      calls.some((call) =>
        call.text.includes('INSERT INTO kousuan.practice_rounds'),
      ),
    ).toBe(false);
  });

  it('repeatRound 唯一约束冲突后重查命中已有轮次', async () => {
    const { runner: inner } = fakeTransaction((text) => {
      if (text.includes('idempotency_key = $2'))
        return [{ id: 'round-recovered' }];
      return [];
    });
    const { runner, attempts } = retryingRunner(inner);

    const outcome = await repeatRound('u1', 'source-round', 'key-4', runner);

    expect(outcome).toEqual({ roundId: 'round-recovered', existing: true });
    expect(attempts()).toBe(2);
  });
});

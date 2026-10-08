import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  makeQuestionsForCounts,
  type Question,
  type QuestionCounts,
} from '../lib/questions.js';
import {
  isUniqueViolation,
  withTransaction,
  type TransactionClient,
  type TransactionRunner,
} from './db.js';
import { promptData } from './utils.js';

type Row = Record<string, unknown>;

export interface RoundRow extends Row {
  id: string;
  user_id: string;
  family_id: string;
  status: 'generated' | 'started' | 'completed' | 'abandoned';
  score?: number | null;
  correct_count?: number | null;
  total_count?: number;
  duration_seconds?: number | null;
  completed_at?: string | null;
  package_name?: string;
  mode?: 'practice' | 'challenge';
  multiply_mixed_count?: number;
}

export interface AnswerInput {
  questionId: string;
  answer: string;
  clientVersion: number;
}

export interface SavedAnswer {
  questionId: string;
  answerText: string;
  clientVersion: number;
}

export interface CreateRoundInput {
  counts: QuestionCounts;
  challengerChain: boolean;
  idempotencyKey: string;
  mode?: 'practice' | 'challenge';
}

export interface RoundMutationOutcome {
  roundId: string;
  existing: boolean;
}

export interface SubmitOutcome {
  roundId: string;
  alreadyCompleted: boolean;
  result: Row;
}

const MAX_ANSWERS = 100;

const LOCK_ROUND_SQL =
  'SELECT * FROM kousuan.practice_rounds WHERE id = $1 AND user_id = $2 FOR UPDATE';
const LOCK_USER_SQL =
  'SELECT id, family_id FROM kousuan.users WHERE id = $1 FOR UPDATE';
const FIND_IDEMPOTENT_SQL =
  'SELECT id FROM kousuan.practice_rounds WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1';
const FIND_ACTIVE_SQL =
  "SELECT id FROM kousuan.practice_rounds WHERE user_id = $1 AND status IN ('generated', 'started') LIMIT 1";

function httpError(
  statusCode: number,
  message: string,
  details?: Record<string, unknown>,
) {
  return Object.assign(new Error(message), {
    statusCode,
    ...(details ? { details } : {}),
  });
}

export function questionKey(level: string, expression: string, answer: number) {
  const normalized = expression
    .normalize('NFKC')
    .replaceAll('-', '−')
    .replace(/\s/g, '');
  return createHash('sha256')
    .update(['2', level, normalized, String(answer)].join('\u001f'))
    .digest('hex');
}

async function lockRound(
  tx: TransactionClient,
  roundId: string,
  userId: string,
) {
  const { rows } = await tx.query<RoundRow>(LOCK_ROUND_SQL, [roundId, userId]);
  return rows[0];
}

async function lockUser(tx: TransactionClient, userId: string) {
  const { rows } = await tx.query<{ id: string; family_id: string | null }>(
    LOCK_USER_SQL,
    [userId],
  );
  return rows[0];
}

async function findByIdempotency(
  tx: TransactionClient,
  userId: string,
  key: string,
) {
  const { rows } = await tx.query<{ id: string }>(FIND_IDEMPOTENT_SQL, [
    userId,
    key,
  ]);
  return rows[0] ? String(rows[0].id) : null;
}

async function findActiveRound(tx: TransactionClient, userId: string) {
  const { rows } = await tx.query<{ id: string }>(FIND_ACTIVE_SQL, [userId]);
  return rows[0] ? String(rows[0].id) : null;
}

/**
 * 合并查询：锁定用户 + 检查幂等性 + 检查进行中的回合
 * 将三次数据库往返减少到一次，显著降低网络延迟
 */
async function lockUserAndCheckRound(
  tx: TransactionClient,
  userId: string,
  idempotencyKey: string,
) {
  const { rows } = await tx.query<{
    user_id: string | null;
    family_id: string | null;
    existing_round_id: string | null;
    active_round_id: string | null;
  }>(
    `WITH user_lock AS (
      SELECT id, family_id FROM kousuan.users WHERE id = $1 FOR UPDATE
    ),
    existing AS (
      SELECT id FROM kousuan.practice_rounds
      WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1
    ),
    active AS (
      SELECT id FROM kousuan.practice_rounds
      WHERE user_id = $1 AND status IN ('generated', 'started') LIMIT 1
    )
    SELECT
      user_lock.id as user_id,
      user_lock.family_id,
      existing.id as existing_round_id,
      active.id as active_round_id
    FROM user_lock
    LEFT JOIN existing ON true
    LEFT JOIN active ON true`,
    [userId, idempotencyKey],
  );

  return rows[0] || null;
}

function countsFromRound(source: RoundRow): QuestionCounts {
  return {
    starter: Number(source.starter_count),
    explorer: Number(source.explorer_count),
    challenger: Number(source.challenger_count),
    multiplyMeaning: Number(source.multiply_meaning_count),
    multiplyFacts: Number(source.multiply_facts_count),
    multiplyMixed: Number(source.multiply_mixed_count),
    divisionMeaning: Number(source.division_meaning_count),
    divisionFacts: Number(source.division_facts_count),
    mixedWordProblem: Number(source.mixed_word_problem_count),
    abacusMove: Number(source.abacus_move_count),
    abacusMatch: Number(source.abacus_match_count),
    abacusCalculation: Number(source.abacus_calculation_count),
  };
}

async function insertRoundWithQuestions(
  tx: TransactionClient,
  input: {
    roundId: string;
    userId: string;
    familyId: string | null;
    idempotencyKey: string;
    source: 'custom' | 'repeat';
    packageName: string;
    mode: 'practice' | 'challenge';
    counts: QuestionCounts;
    generated: Question[];
    seed: number;
  },
) {
  await tx.query(
    `INSERT INTO kousuan.practice_rounds (id, user_id, family_id, idempotency_key, source, package_name, mode,
      starter_count, explorer_count, challenger_count, multiply_meaning_count, multiply_facts_count, multiply_mixed_count,
      division_meaning_count, division_facts_count, mixed_word_problem_count,
      abacus_move_count, abacus_match_count, abacus_calculation_count, total_count, seed)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
    [
      input.roundId,
      input.userId,
      input.familyId,
      input.idempotencyKey,
      input.source,
      input.packageName,
      input.mode,
      input.counts.starter,
      input.counts.explorer,
      input.counts.challenger,
      input.counts.multiplyMeaning,
      input.counts.multiplyFacts,
      input.counts.multiplyMixed,
      input.counts.divisionMeaning,
      input.counts.divisionFacts,
      input.counts.mixedWordProblem,
      input.counts.abacusMove,
      input.counts.abacusMatch,
      input.counts.abacusCalculation,
      input.generated.length,
      input.seed,
    ],
  );
  const questions = input.generated.map((question, index) => ({
    position: index + 1,
    level: question.level,
    expression: question.expression,
    correct_answer: question.answer,
    prompt_data: question.promptData ?? {},
  }));
  await tx.query(
    `INSERT INTO kousuan.round_questions (round_id, position, level, expression, correct_answer, prompt_data)
      SELECT $1, q.position, q.level, q.expression, q.correct_answer, q.prompt_data
      FROM jsonb_to_recordset($2::jsonb)
        AS q(position integer, level text, expression text, correct_answer integer, prompt_data jsonb)`,
    [input.roundId, JSON.stringify(questions)],
  );
}

/**
 * 唯一约束兜底：回滚后用新事务重新按 idempotency_key 查找，
 * 若确实已存在则返回既有轮次；若命中“每用户仅一轮进行中”的唯一索引则给出明确 409。
 */
async function recoverCreatedRound(
  userId: string,
  idempotencyKey: string,
  activeMessage: string,
  runner: TransactionRunner,
) {
  return runner(async (tx) => {
    const existing = await findByIdempotency(tx, userId, idempotencyKey);
    if (existing) return existing;
    const active = await findActiveRound(tx, userId);
    if (active)
      throw httpError(409, activeMessage, {
        activeRoundId: active,
      });
    return null;
  });
}

export async function startRound(
  userId: string,
  roundId: string,
  runner: TransactionRunner = withTransaction,
) {
  return runner(async (tx) => {
    const round = await lockRound(tx, roundId, userId);
    if (!round || (round.status !== 'generated' && round.status !== 'started'))
      throw httpError(409, '这轮练习无法开始');
    if (round.status === 'generated') {
      await tx.query(
        `UPDATE kousuan.practice_rounds
          SET status = 'started', started_at = coalesce(started_at, now())
          WHERE id = $1 AND user_id = $2 AND status = 'generated'`,
        [roundId, userId],
      );
    }
    return { roundId };
  });
}

export async function saveAnswers(
  userId: string,
  roundId: string,
  answers: AnswerInput[],
  runner: TransactionRunner = withTransaction,
): Promise<{ saved: SavedAnswer[] }> {
  if (answers.length > MAX_ANSWERS)
    throw httpError(400, `一次最多保存 ${MAX_ANSWERS} 条答案`);
  const questionIds = answers.map((answer) => answer.questionId);
  if (new Set(questionIds).size !== questionIds.length)
    throw httpError(400, '答案中包含重复题目');

  return runner(async (tx) => {
    // 先在同一事务内锁定轮次，锁取得后再校验状态、读取现有答案。
    const round = await lockRound(tx, roundId, userId);
    if (!round || round.status !== 'started')
      throw httpError(409, '这轮练习不在答题中');
    if (!answers.length) return { saved: [] };

    const current = await tx.query<{
      question_id: string;
      answer_text: string | null;
      client_version: number | null;
    }>(
      `SELECT q.id AS question_id, a.answer_text, a.client_version
        FROM kousuan.round_questions q
        LEFT JOIN kousuan.practice_answers a ON a.question_id = q.id
        WHERE q.round_id = $1 AND q.id = ANY($2::uuid[])`,
      [roundId, questionIds],
    );
    const byId = new Map(
      current.rows.map((row) => [String(row.question_id), row]),
    );

    const toWrite: AnswerInput[] = [];
    for (const answer of answers) {
      const existing = byId.get(answer.questionId);
      if (!existing) throw httpError(400, '答案中包含无效题目');
      const existingVersion = Number(existing.client_version ?? 0);
      const existingText =
        existing.answer_text === null || existing.answer_text === undefined
          ? null
          : String(existing.answer_text);
      if (existingText === null || existingVersion < answer.clientVersion) {
        toWrite.push(answer);
        continue;
      }
      if (
        existingVersion === answer.clientVersion &&
        existingText === answer.answer
      ) {
        // 同版本同答案：幂等，直接接受，不写库。
        continue;
      }
      // 任何版本冲突都在整批写入前抛出，事务回滚，保证整批不写。
      throw httpError(409, '答案已在另一页面或设备更新，请确认后再试', {
        code: 'ANSWER_VERSION_STALE',
        questionId: answer.questionId,
        answerText: existingText,
        clientVersion: existingVersion,
      });
    }

    if (toWrite.length) {
      await tx.query(
        `INSERT INTO kousuan.practice_answers (question_id, round_id, answer_text, client_version, updated_at)
          SELECT u.question_id, $1, u.answer_text, u.client_version, now()
          FROM unnest($2::uuid[], $3::text[], $4::int[])
            AS u(question_id, answer_text, client_version)
          ON CONFLICT (question_id) DO UPDATE SET
            answer_text = excluded.answer_text,
            client_version = excluded.client_version,
            updated_at = now()
          WHERE kousuan.practice_answers.client_version < excluded.client_version
            OR (kousuan.practice_answers.client_version = excluded.client_version
              AND kousuan.practice_answers.answer_text = excluded.answer_text)`,
        [
          roundId,
          toWrite.map((answer) => answer.questionId),
          toWrite.map((answer) => answer.answer),
          toWrite.map((answer) => answer.clientVersion),
        ],
      );
    }

    return {
      saved: answers.map((answer) => ({
        questionId: answer.questionId,
        answerText: answer.answer,
        clientVersion: answer.clientVersion,
      })),
    };
  });
}

interface AggregatedWrongStat {
  expression: string;
  correct_answer: number;
  level: string;
  last_answer: string;
  prompt_data: Record<string, unknown>;
  question_key: string;
  mistake_count: number;
}

/**
 * 同一轮内不同 groupId 的空拨连线题可能生成完全相同的 expression + answer，
 * 从而得到相同 question_key。Postgres 的 ON CONFLICT 不允许同一条 INSERT 两次
 * 命中同一行，因此先按 question_key 预聚合：mistake_count 累加，
 * 其余展示字段保留最后一次出现的答案与 promptData（不改变题目生成规则）。
 */
export function aggregateWrongStats(
  rows: Array<{
    expression: unknown;
    correct_answer: unknown;
    level: unknown;
    answer_text: unknown;
    prompt_data: unknown;
  }>,
): AggregatedWrongStat[] {
  const byKey = new Map<string, AggregatedWrongStat>();
  for (const row of rows) {
    const level = String(row.level);
    const expression = String(row.expression);
    const correctAnswer = Number(row.correct_answer);
    const key = questionKey(level, expression, correctAnswer);
    const existing = byKey.get(key);
    // set 会保留 key 首次插入的位置；重复 key 覆盖字段，最后一条生效。
    byKey.set(key, {
      expression,
      correct_answer: correctAnswer,
      level,
      last_answer: String(row.answer_text),
      prompt_data: promptData(row.prompt_data),
      question_key: key,
      mistake_count: (existing?.mistake_count ?? 0) + 1,
    });
  }
  return [...byKey.values()];
}

function roundResult(round: RoundRow): Row {
  return {
    score: round.score,
    correct_count: round.correct_count,
    total_count: round.total_count,
    duration_seconds: round.duration_seconds,
    completed_at: round.completed_at,
    mode: round.mode,
    multiply_mixed_count: round.multiply_mixed_count,
  };
}

export async function submitRound(
  userId: string,
  roundId: string,
  runner: TransactionRunner = withTransaction,
): Promise<SubmitOutcome> {
  return runner(async (tx) => {
    const round = await lockRound(tx, roundId, userId);
    if (!round) throw httpError(409, '这轮练习不在答题中');
    if (round.status === 'completed') {
      // 同轮重复交卷：直接返回既有成绩，不再重复累加错题统计。
      return { roundId, alreadyCompleted: true, result: roundResult(round) };
    }
    if (round.status !== 'started') throw httpError(409, '这轮练习不在答题中');

    const { rows } = await tx.query<{
      id: string;
      expression: string;
      correct_answer: number;
      level: string;
      prompt_data: unknown;
      answer_text: string | null;
    }>(
      `SELECT q.id, q.expression, q.correct_answer, q.level, q.prompt_data, a.answer_text
        FROM kousuan.round_questions q
        LEFT JOIN kousuan.practice_answers a ON a.question_id = q.id
        WHERE q.round_id = $1
        ORDER BY q.position`,
      [roundId],
    );
    if (!rows.length) throw httpError(409, '这轮练习不在答题中');
    if (
      rows.some(
        (row) =>
          row.answer_text === null || String(row.answer_text).trim() === '',
      )
    )
      throw httpError(400, '请答完所有题目再交卷');

    const correct = rows.filter(
      (row) => Number(row.answer_text) === Number(row.correct_answer),
    );
    const score = Math.round((correct.length / rows.length) * 100);

    await tx.query(
      `UPDATE kousuan.practice_answers a
        SET is_correct = u.is_correct, updated_at = now()
        FROM jsonb_to_recordset($2::jsonb) AS u(question_id uuid, is_correct boolean)
        WHERE a.question_id = u.question_id AND a.round_id = $1`,
      [
        roundId,
        JSON.stringify(
          rows.map((row) => ({
            question_id: String(row.id),
            is_correct: Number(row.answer_text) === Number(row.correct_answer),
          })),
        ),
      ],
    );

    const wrong = rows.filter(
      (row) => Number(row.answer_text) !== Number(row.correct_answer),
    );
    if (wrong.length) {
      await tx.query(
        `INSERT INTO kousuan.wrong_question_stats (user_id, expression, correct_answer, level, last_answer, prompt_data, question_key, mistake_count)
          SELECT $1, w.expression, w.correct_answer, w.level, w.last_answer, w.prompt_data, w.question_key, w.mistake_count
          FROM jsonb_to_recordset($2::jsonb)
            AS w(expression text, correct_answer integer, level text, last_answer text, prompt_data jsonb, question_key text, mistake_count integer)
          ON CONFLICT (user_id, question_key) DO UPDATE SET
            mistake_count = kousuan.wrong_question_stats.mistake_count + excluded.mistake_count,
            last_answer = excluded.last_answer,
            level = excluded.level,
            prompt_data = excluded.prompt_data,
            correct_streak = 0,
            mastered_at = NULL,
            next_review_at = now(),
            last_seen_at = now()`,
        [userId, JSON.stringify(aggregateWrongStats(wrong))],
      );
    }

    const updated = await tx.query<Row>(
      `UPDATE kousuan.practice_rounds
        SET status = 'completed', score = $3, correct_count = $4, completed_at = now(),
          duration_seconds = greatest(0, extract(epoch from (now() - started_at))::int)
        WHERE id = $1 AND user_id = $2 AND status = 'started'
        RETURNING score, correct_count, total_count, duration_seconds, completed_at, mode, multiply_mixed_count`,
      [roundId, userId, score, correct.length],
    );
    if (!updated.rows[0]) throw httpError(409, '这轮练习不在答题中');
    return { roundId, alreadyCompleted: false, result: updated.rows[0] };
  });
}

export async function abandonRound(
  userId: string,
  roundId: string,
  runner: TransactionRunner = withTransaction,
) {
  return runner(async (tx) => {
    const round = await lockRound(tx, roundId, userId);
    if (!round || (round.status !== 'generated' && round.status !== 'started'))
      throw httpError(409, '这轮练习已经结束');
    await tx.query(
      `UPDATE kousuan.practice_rounds SET status = 'abandoned', abandoned_at = now()
        WHERE id = $1 AND user_id = $2 AND status IN ('generated', 'started')`,
      [roundId, userId],
    );
    return { roundId };
  });
}

export async function createRound(
  userId: string,
  input: CreateRoundInput,
  runner: TransactionRunner = withTransaction,
): Promise<RoundMutationOutcome> {
  try {
    return await runner(async (tx) => {
      // 合并查询：锁定 user + 检查幂等性 + 检查进行中的回合（从 3 次往返减少到 1 次）
      const result = await lockUserAndCheckRound(tx, userId, input.idempotencyKey);

      if (!result?.user_id) throw httpError(404, '账号不存在');

      // 如果已存在相同 idempotency key 的回合，直接返回
      if (result.existing_round_id) {
        return { roundId: result.existing_round_id, existing: true };
      }

      // 如果有进行中的回合，返回错误
      if (result.active_round_id) {
        throw httpError(409, '你还有一轮练习没有完成', {
          activeRoundId: result.active_round_id,
        });
      }

      const roundId = randomUUID();
      const seed = randomInt(1, 2_000_000_000);
      const generated = makeQuestionsForCounts(seed, input.counts, {
        challengerChain: input.challengerChain,
      });
      await insertRoundWithQuestions(tx, {
        roundId,
        userId,
        familyId: result.family_id,
        idempotencyKey: input.idempotencyKey,
        source: 'custom',
        packageName: '自选知识点练习',
        mode: input.mode === 'practice' ? 'practice' : 'challenge',
        counts: input.counts,
        generated,
        seed,
      });
      return { roundId, existing: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const recovered = await recoverCreatedRound(
        userId,
        input.idempotencyKey,
        '你还有一轮练习没有完成',
        runner,
      );
      if (recovered) return { roundId: recovered, existing: true };
    }
    throw error;
  }
}

export async function repeatRound(
  userId: string,
  sourceRoundId: string,
  idempotencyKey: string,
  runner: TransactionRunner = withTransaction,
): Promise<RoundMutationOutcome> {
  try {
    return await runner(async (tx) => {
      const user = await lockUser(tx, userId);
      if (!user) throw httpError(404, '账号不存在');
      // 重练同样先按 user + idempotency_key 返回已有轮次。
      const existing = await findByIdempotency(tx, userId, idempotencyKey);
      if (existing) return { roundId: existing, existing: true };

      const { rows } = await tx.query<RoundRow>(
        `SELECT * FROM kousuan.practice_rounds
          WHERE id = $1 AND user_id = $2 AND status = 'completed'`,
        [sourceRoundId, userId],
      );
      const source = rows[0];
      if (!source) throw httpError(409, '只能重练已完成的练习');

      const active = await findActiveRound(tx, userId);
      if (active) throw httpError(409, '请先完成当前练习');

      const { rows: sourceQuestions } = await tx.query<{ expression: string }>(
        `SELECT expression FROM kousuan.round_questions WHERE round_id = $1 AND level = 'challenger'`,
        [sourceRoundId],
      );
      const challengerChain = sourceQuestions.some(
        (question) =>
          (String(question.expression).match(/[+−]/g) ?? []).length > 1,
      );
      const counts = countsFromRound(source);
      const newId = randomUUID();
      const seed = randomInt(1, 2_000_000_000);
      const generated = makeQuestionsForCounts(seed, counts, {
        challengerChain,
      });
      await insertRoundWithQuestions(tx, {
        roundId: newId,
        userId,
        familyId: user.family_id,
        idempotencyKey,
        source: 'repeat',
        packageName: `${String(source.package_name)}·再练一次`,
        mode: source.mode === 'practice' ? 'practice' : 'challenge',
        counts,
        generated,
        seed,
      });
      return { roundId: newId, existing: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const recovered = await recoverCreatedRound(
        userId,
        idempotencyKey,
        '请先完成当前练习',
        runner,
      );
      if (recovered) return { roundId: recovered, existing: true };
    }
    throw error;
  }
}

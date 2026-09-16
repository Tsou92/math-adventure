import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import {
  makeQuestionsForCounts,
  totalQuestions,
  type QuestionCounts,
} from '../lib/questions.js';
import {
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  normalizeUsername,
  requireUser,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './auth.js';
import { db } from './db.js';
import { preferences, progress, reviewWrong } from './learning.js';
import {
  createRecoveryCode,
  recoveryHash,
  issueRecovery,
  recoverPassword,
} from './recovery.js';
import { getQuestionHints } from '../lib/learning.js';
import type { Level } from '../lib/questions.js';
import { body, method, routePath, send } from './http.js';

type Row = Record<string, unknown>;
type LoginAttemptRow = {
  attempt_count: number;
  window_started_at?: string;
  blocked_until: string | null;
};
type LoginUserRow = Row & {
  id: string;
  password_hash: string;
  is_active: boolean;
};

function promptData(value: unknown) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value as Record<string, unknown>;
}

function questionKey(level: string, expression: string, answer: number) {
  const normalized = expression
    .normalize('NFKC')
    .replaceAll('-', '−')
    .replace(/\s/g, '');
  return createHash('sha256')
    .update(['2', level, normalized, String(answer)].join('\u001f'))
    .digest('hex');
}

export async function fetchChildrenSummary(familyId: string) {
  return db()`SELECT u.id, u.username, u.display_name, u.is_active, u.must_change_password, u.created_at,
      count(r.id) FILTER (WHERE r.status = 'completed')::int AS round_count,
      coalesce(round(avg(r.score) FILTER (WHERE r.status = 'completed')), 0)::int AS average_score,
      max(r.completed_at) AS last_practiced_at
    FROM kousuan.users u LEFT JOIN kousuan.practice_rounds r ON r.user_id = u.id
    WHERE u.family_id = ${familyId} AND u.role = 'child'
    GROUP BY u.id ORDER BY u.created_at`;
}

const countSchema = z
  .object({
    starter: z.number().int().min(0).max(50),
    explorer: z.number().int().min(0).max(50),
    challenger: z.number().int().min(0).max(50),
    multiplyMeaning: z.number().int().min(0).max(50),
    multiplyFacts: z.number().int().min(0).max(50),
    multiplyMixed: z.number().int().min(0).max(50).default(0),
    abacusMove: z.number().int().min(0).max(50),
    abacusMatch: z.number().int().min(0).max(50),
    abacusCalculation: z.number().int().min(0).max(50),
  })
  .refine((counts) => counts.abacusMatch !== 1, '空拨连线至少选择 2 道')
  .refine(
    (counts) => totalQuestions(counts) >= 1 && totalQuestions(counts) <= 100,
    '总题数需为 1–100 道',
  );

function publicUser(user: Awaited<ReturnType<typeof currentUser>>) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    mustChangePassword: user.must_change_password,
  };
}

function clientIp(req: VercelRequest) {
  return String(
    req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown',
  )
    .split(',')[0]
    .trim();
}

async function login(req: VercelRequest, res: VercelResponse) {
  method(req, 'POST');
  const parsed = z
    .object({
      username: z.string().min(1),
      password: z.string().min(1).max(128),
    })
    .parse(body(req));
  const username = normalizeUsername(parsed.username);
  const bucket = createHash('sha256')
    .update(`${clientIp(req)}:${username}`)
    .digest('hex');
  const sql = db();
  const attempts =
    (await sql`SELECT attempt_count, blocked_until FROM kousuan.login_attempts WHERE bucket = ${bucket}`) as LoginAttemptRow[];
  const blockedUntil = attempts[0]?.blocked_until
    ? new Date(attempts[0].blocked_until)
    : null;
  if (blockedUntil && blockedUntil > new Date())
    throw Object.assign(new Error('尝试次数过多，请稍后再试'), {
      statusCode: 429,
    });

  const users =
    (await sql`SELECT id, family_id, username, display_name, role, is_active,
      must_change_password, password_hash FROM kousuan.users WHERE username = ${username} LIMIT 1`) as LoginUserRow[];
  const user = users[0];
  const valid =
    Boolean(user?.is_active) &&
    (await verifyPassword(
      user?.password_hash ??
        '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      parsed.password,
    ).catch(() => false));
  if (!valid) {
    await sql`INSERT INTO kousuan.login_attempts (bucket, attempt_count, window_started_at, blocked_until)
      VALUES (${bucket}, 1, now(), NULL)
      ON CONFLICT (bucket) DO UPDATE SET
        attempt_count = CASE WHEN kousuan.login_attempts.window_started_at < now() - interval '15 minutes' THEN 1 ELSE kousuan.login_attempts.attempt_count + 1 END,
        window_started_at = CASE WHEN kousuan.login_attempts.window_started_at < now() - interval '15 minutes' THEN now() ELSE kousuan.login_attempts.window_started_at END,
        blocked_until = CASE WHEN kousuan.login_attempts.attempt_count + 1 >= 6 THEN now() + interval '10 minutes' ELSE NULL END`;
    throw Object.assign(new Error('用户名或密码不正确'), { statusCode: 401 });
  }
  await sql`DELETE FROM kousuan.login_attempts WHERE bucket = ${bucket}`;
  await createSession(String(user.id), req, res);
  return send(res, 200, { user: publicUser(user as never) });
}

async function register(req: VercelRequest, res: VercelResponse) {
  method(req, 'POST');
  const parsed = z
    .object({
      familyName: z
        .string()
        .trim()
        .max(30, '家庭名称最多 30 个字')
        .default('我的家庭'),
      displayName: z
        .string()
        .trim()
        .max(20, '家长称呼最多 20 个字')
        .default('家长'),
      username: z.string().min(1, '请输入用户名'),
      password: z.string().min(1, '请输入密码'),
    })
    .parse(body(req));
  const username = validateUsername(parsed.username);
  validatePassword(parsed.password, 'parent');

  const sql = db();
  const bucket = createHash('sha256')
    .update(`register:${clientIp(req)}`)
    .digest('hex');
  const attempts =
    (await sql`SELECT attempt_count, window_started_at, blocked_until
    FROM kousuan.login_attempts WHERE bucket = ${bucket}`) as LoginAttemptRow[];
  const attempt = attempts[0];
  const now = new Date();
  const blockedUntil = attempt?.blocked_until
    ? new Date(attempt.blocked_until)
    : null;
  const windowStartedAt = attempt?.window_started_at
    ? new Date(attempt.window_started_at)
    : null;
  const currentWindow = Boolean(
    windowStartedAt &&
    windowStartedAt.getTime() > now.getTime() - 60 * 60 * 1000,
  );
  if (
    (blockedUntil && blockedUntil > now) ||
    (currentWindow && Number(attempt?.attempt_count ?? 0) >= 5)
  ) {
    throw Object.assign(new Error('注册次数过多，请一小时后再试'), {
      statusCode: 429,
    });
  }

  const passwordHash = await hashPassword(parsed.password);
  await sql`INSERT INTO kousuan.login_attempts (bucket, attempt_count, window_started_at, blocked_until)
    VALUES (${bucket}, 1, now(), NULL)
    ON CONFLICT (bucket) DO UPDATE SET
      attempt_count = CASE WHEN kousuan.login_attempts.window_started_at < now() - interval '1 hour' THEN 1 ELSE kousuan.login_attempts.attempt_count + 1 END,
      window_started_at = CASE WHEN kousuan.login_attempts.window_started_at < now() - interval '1 hour' THEN now() ELSE kousuan.login_attempts.window_started_at END,
      blocked_until = CASE
        WHEN kousuan.login_attempts.window_started_at < now() - interval '1 hour' THEN NULL
        WHEN kousuan.login_attempts.attempt_count + 1 >= 5 THEN now() + interval '1 hour'
        ELSE kousuan.login_attempts.blocked_until
      END`;

  const recoveryCode = createRecoveryCode();
  const familyId = randomUUID();
  const userId = randomUUID();
  try {
    await sql.transaction([
      sql`INSERT INTO kousuan.families (id, name) VALUES (${familyId}, ${parsed.familyName})`,
      sql`INSERT INTO kousuan.users (id, family_id, username, display_name, password_hash, role)
        VALUES (${userId}, ${familyId}, ${username}, ${parsed.displayName}, ${passwordHash}, 'parent')`,
      sql`INSERT INTO kousuan.audit_events (family_id, actor_user_id, action, target_user_id)
        VALUES (${familyId}, ${userId}, 'family.registered', ${userId})`,
      sql`INSERT INTO kousuan.recovery_codes(user_id,code_hash) VALUES(${userId},${recoveryHash(recoveryCode)})`,
    ]);
  } catch (error) {
    if (String(error).includes('users_username_key')) {
      throw Object.assign(new Error('这个用户名已被使用'), { statusCode: 409 });
    }
    throw error;
  }

  await createSession(userId, req, res);
  return send(res, 201, {
    recoveryCode,
    user: {
      id: userId,
      username,
      displayName: parsed.displayName,
      role: 'parent',
      mustChangePassword: false,
    },
  });
}

async function changePassword(req: VercelRequest, res: VercelResponse) {
  method(req, 'POST');
  const user = await requireUser(req);
  const parsed = z
    .object({ currentPassword: z.string(), newPassword: z.string() })
    .parse(body(req));
  const rows =
    (await db()`SELECT password_hash FROM kousuan.users WHERE id = ${user.id}`) as Row[];
  if (
    !(await verifyPassword(
      String(rows[0]?.password_hash),
      parsed.currentPassword,
    ))
  ) {
    throw Object.assign(new Error('当前密码不正确'), { statusCode: 400 });
  }
  validatePassword(
    parsed.newPassword,
    user.role === 'child' ? 'child' : 'parent',
  );
  const passwordHash = await hashPassword(parsed.newPassword);
  await db()`UPDATE kousuan.users SET password_hash = ${passwordHash}, must_change_password = false, updated_at = now() WHERE id = ${user.id}`;
  return send(res, 200, { ok: true });
}

async function children(req: VercelRequest, res: VercelResponse) {
  const parent = await requireUser(req, ['parent', 'site_owner']);
  if (!parent.family_id)
    throw Object.assign(new Error('家庭信息不存在'), { statusCode: 400 });
  const sql = db();
  if (req.method === 'GET') {
    const rows = await fetchChildrenSummary(parent.family_id);
    return send(res, 200, { children: rows });
  }
  method(req, 'POST');
  const parsed = z
    .object({
      username: z.string(),
      displayName: z.string().trim().min(1).max(20),
      password: z.string(),
    })
    .parse(body(req));
  const username = validateUsername(parsed.username);
  validatePassword(parsed.password, 'child');
  const passwordHash = await hashPassword(parsed.password);
  try {
    const rows =
      (await sql`INSERT INTO kousuan.users (family_id, username, display_name, password_hash, role)
      VALUES (${parent.family_id}, ${username}, ${parsed.displayName}, ${passwordHash}, 'child')
      RETURNING id, username, display_name, is_active, must_change_password, created_at`) as Row[];
    await sql`INSERT INTO kousuan.audit_events (family_id, actor_user_id, action, target_user_id)
      VALUES (${parent.family_id}, ${parent.id}, 'child.created', ${rows[0].id})`;
    return send(res, 201, { child: rows[0] });
  } catch (error) {
    if (String(error).includes('users_username_key'))
      throw Object.assign(new Error('这个用户名已被使用'), { statusCode: 409 });
    throw error;
  }
}

async function childAction(
  req: VercelRequest,
  res: VercelResponse,
  childId: string,
  action: string,
) {
  method(req, 'POST');
  const parent = await requireUser(req, ['parent', 'site_owner']);
  const sql = db();
  const childRows =
    (await sql`SELECT id, family_id, username, display_name, role, is_active, must_change_password FROM kousuan.users WHERE id = ${childId} AND family_id = ${parent.family_id} AND role = 'child'`) as Row[];
  if (!childRows[0])
    throw Object.assign(new Error('孩子账号不存在'), { statusCode: 404 });
  if (action === 'enter') {
    if (!childRows[0].is_active)
      throw Object.assign(new Error('请先启用孩子账号'), { statusCode: 403 });
    await sql`INSERT INTO kousuan.audit_events(family_id,actor_user_id,target_user_id,action) VALUES(${parent.family_id},${parent.id},${childId},'parent.entered_child')`;
    await destroySession(req, res);
    await createSession(childId, req, res);
    return send(res, 200, { user: publicUser(childRows[0] as never) });
  }
  if (action === 'reset-password') {
    const parsed = z.object({ password: z.string() }).parse(body(req));
    validatePassword(parsed.password, 'child');
    const passwordHash = await hashPassword(parsed.password);
    await sql.transaction([
      sql`UPDATE kousuan.users SET password_hash = ${passwordHash}, must_change_password = true, updated_at = now() WHERE id = ${childId}`,
      sql`DELETE FROM kousuan.sessions WHERE user_id = ${childId}`,
      sql`INSERT INTO kousuan.audit_events (family_id, actor_user_id, action, target_user_id) VALUES (${parent.family_id}, ${parent.id}, 'child.password_reset', ${childId})`,
    ]);
    return send(res, 200, { ok: true });
  }
  const parsed = z.object({ isActive: z.boolean() }).parse(body(req));
  await sql.transaction([
    sql`UPDATE kousuan.users SET is_active = ${parsed.isActive}, updated_at = now() WHERE id = ${childId}`,
    ...(parsed.isActive
      ? []
      : [sql`DELETE FROM kousuan.sessions WHERE user_id = ${childId}`]),
    sql`INSERT INTO kousuan.audit_events (family_id, actor_user_id, action, target_user_id, metadata) VALUES (${parent.family_id}, ${parent.id}, 'child.status_changed', ${childId}, ${JSON.stringify({ isActive: parsed.isActive })}::jsonb)`,
  ]);
  return send(res, 200, { ok: true });
}

function serializeRound(round: Row, questions: Row[]) {
  const challengerChain = questions.some(
    (question) =>
      question.level === 'challenger' &&
      (String(question.expression).match(/[+−]/g) ?? []).length > 1,
  );
  return {
    id: round.id,
    status: round.status,
    mode: round.mode ?? 'challenge',
    source: round.source,
    packageName: round.package_name,
    counts: {
      starter: round.starter_count,
      explorer: round.explorer_count,
      challenger: round.challenger_count,
      multiplyMeaning: round.multiply_meaning_count,
      multiplyFacts: round.multiply_facts_count,
      multiplyMixed: round.multiply_mixed_count ?? 0,
      abacusMove: round.abacus_move_count,
      abacusMatch: round.abacus_match_count,
      abacusCalculation: round.abacus_calculation_count,
    },
    totalCount: round.total_count,
    startedAt: round.started_at,
    completedAt: round.completed_at,
    challengerChain,
    questions: questions.map((question) => ({
      id: question.id,
      position: question.position,
      level: question.level,
      expression: question.expression,
      answer: question.answer_text ?? '',
      clientVersion: Number(question.client_version ?? 0),
      promptData: promptData(question.prompt_data),
      isCorrect: question.is_correct,
      correctAnswer:
        round.status === 'completed' ? question.correct_answer : undefined,
    })),
  };
}

async function fetchRound(userId: string, roundId: string) {
  const sql = db();
  const rounds =
    (await sql`SELECT * FROM kousuan.practice_rounds WHERE id = ${roundId} AND user_id = ${userId} LIMIT 1`) as Row[];
  if (!rounds[0])
    throw Object.assign(new Error('练习不存在'), { statusCode: 404 });
  const questions =
    (await sql`SELECT q.id, q.position, q.level, q.expression, q.correct_answer, q.prompt_data,
      a.answer_text, a.is_correct, a.client_version FROM kousuan.round_questions q
      LEFT JOIN kousuan.practice_answers a ON a.question_id = q.id
      WHERE q.round_id = ${roundId} ORDER BY q.position`) as Row[];
  return serializeRound(rounds[0], questions);
}

async function createRound(req: VercelRequest, res: VercelResponse) {
  method(req, 'POST');
  const user = await requireUser(req, ['child']);
  const input = z
    .object({
      source: z.literal('custom'),
      counts: countSchema,
      challengerChain: z.boolean().default(false),
      mode: z.enum(['practice', 'challenge']).default('challenge'),
      idempotencyKey: z.uuid(),
    })
    .parse(body(req));
  const sql = db();
  const duplicate =
    (await sql`SELECT id FROM kousuan.practice_rounds WHERE user_id = ${user.id} AND idempotency_key = ${input.idempotencyKey}`) as Row[];
  if (duplicate[0])
    return send(res, 200, {
      round: await fetchRound(user.id, String(duplicate[0].id)),
    });
  const active =
    (await sql`SELECT id FROM kousuan.practice_rounds WHERE user_id = ${user.id} AND status IN ('generated', 'started') LIMIT 1`) as Row[];
  if (active[0])
    throw Object.assign(new Error('你还有一轮练习没有完成'), {
      statusCode: 409,
      activeRoundId: active[0].id,
    });

  const counts: QuestionCounts = input.counts;
  const packageName = '自选知识点练习';
  const challengerChain = input.challengerChain;
  const roundId = randomUUID();
  const seed = randomInt(1, 2_000_000_000);
  const generated = makeQuestionsForCounts(seed, counts, { challengerChain });
  const statements = [
    sql`INSERT INTO kousuan.practice_rounds (id, user_id, family_id, idempotency_key, source, package_name, starter_count, explorer_count, challenger_count, multiply_meaning_count, multiply_facts_count, multiply_mixed_count, abacus_move_count, abacus_match_count, abacus_calculation_count, total_count, seed, mode)
      VALUES (${roundId}, ${user.id}, ${user.family_id}, ${input.idempotencyKey}, ${input.source}, ${packageName}, ${counts.starter}, ${counts.explorer}, ${counts.challenger}, ${counts.multiplyMeaning}, ${counts.multiplyFacts}, ${counts.multiplyMixed}, ${counts.abacusMove}, ${counts.abacusMatch}, ${counts.abacusCalculation}, ${generated.length}, ${seed}, ${input.mode})`,
    ...generated.map(
      (
        question,
        index,
      ) => sql`INSERT INTO kousuan.round_questions (round_id, position, level, expression, correct_answer, prompt_data)
      VALUES (${roundId}, ${index + 1}, ${question.level}, ${question.expression}, ${question.answer}, ${JSON.stringify(question.promptData ?? {})}::jsonb)`,
    ),
  ];
  await sql.transaction(statements);
  return send(res, 201, { round: await fetchRound(user.id, roundId) });
}

async function activeRound(req: VercelRequest, res: VercelResponse) {
  method(req, 'GET');
  const user = await requireUser(req, ['child']);
  const rows =
    (await db()`SELECT id FROM kousuan.practice_rounds WHERE user_id = ${user.id} AND status IN ('generated', 'started') ORDER BY created_at DESC LIMIT 1`) as Row[];
  return send(res, 200, {
    round: rows[0] ? await fetchRound(user.id, String(rows[0].id)) : null,
  });
}

async function roundAction(
  req: VercelRequest,
  res: VercelResponse,
  roundId: string,
  action: string,
) {
  const user = await requireUser(req, ['child']);
  const sql = db();
  if (action === 'start') {
    method(req, 'POST');
    const rows =
      (await sql`UPDATE kousuan.practice_rounds SET status = 'started', started_at = coalesce(started_at, now())
      WHERE id = ${roundId} AND user_id = ${user.id} AND status IN ('generated', 'started') RETURNING id`) as Row[];
    if (!rows[0])
      throw Object.assign(new Error('这轮练习无法开始'), { statusCode: 409 });
    return send(res, 200, { round: await fetchRound(user.id, roundId) });
  }
  if (action === 'check') {
    method(req, 'POST');
    const parsed = z
      .object({ questionId: z.uuid(), answer: z.string().regex(/^-?\d{1,4}$/) })
      .parse(body(req));
    const rows =
      await sql`SELECT q.expression, q.level, q.correct_answer FROM kousuan.round_questions q
      JOIN kousuan.practice_rounds r ON r.id=q.round_id WHERE q.id=${parsed.questionId} AND r.id=${roundId}
      AND r.user_id=${user.id} AND r.status='started' AND r.mode='practice'`;
    if (!rows[0])
      throw Object.assign(new Error('只有练习模式可以逐题检查'), {
        statusCode: 403,
      });
    return send(res, 200, {
      correct: Number(rows[0].correct_answer) === Number(parsed.answer),
      hints: getQuestionHints({
        expression: String(rows[0].expression),
        level: rows[0].level as Level,
      }),
    });
  }
  if (action === 'answers') {
    method(req, 'PATCH');
    const parsed = z
      .object({
        answers: z
          .array(
            z.object({
              questionId: z.uuid(),
              answer: z.string().regex(/^-?\d{0,4}$/),
              clientVersion: z.number().int().min(1),
            }),
          )
          .max(100),
      })
      .parse(body(req));
    const roundRows =
      (await sql`SELECT id FROM kousuan.practice_rounds WHERE id = ${roundId} AND user_id = ${user.id} AND status = 'started'`) as Row[];
    if (!roundRows[0])
      throw Object.assign(new Error('这轮练习不在答题中'), { statusCode: 409 });
    const allowed =
      (await sql`SELECT id FROM kousuan.round_questions WHERE round_id = ${roundId}`) as Row[];
    const allowedIds = new Set(allowed.map((row) => String(row.id)));
    if (parsed.answers.some((answer) => !allowedIds.has(answer.questionId)))
      throw Object.assign(new Error('答案中包含无效题目'), { statusCode: 400 });
    if (
      new Set(parsed.answers.map((a) => a.questionId)).size !==
      parsed.answers.length
    )
      throw Object.assign(new Error('同一道题不能重复提交'), {
        statusCode: 400,
      });
    const payload = JSON.stringify(
      parsed.answers.map((a) => ({
        question_id: a.questionId,
        answer_text: a.answer,
        client_version: a.clientVersion,
      })),
    );
    const [, rows] = await sql.transaction([
      sql`SELECT id FROM kousuan.practice_rounds WHERE id=${roundId} AND user_id=${user.id} FOR UPDATE`,
      sql`INSERT INTO kousuan.practice_answers(question_id,round_id,answer_text,client_version,updated_at)
        SELECT input.question_id,r.id,input.answer_text,input.client_version,now()
        FROM jsonb_to_recordset(${payload}::jsonb) AS input(question_id uuid,answer_text text,client_version int)
        CROSS JOIN kousuan.practice_rounds r WHERE r.id=${roundId} AND r.user_id=${user.id} AND r.status='started'
        ON CONFLICT(question_id) DO UPDATE SET answer_text=excluded.answer_text,client_version=excluded.client_version,updated_at=now()
        WHERE kousuan.practice_answers.client_version < excluded.client_version
          OR (kousuan.practice_answers.client_version=excluded.client_version AND kousuan.practice_answers.answer_text=excluded.answer_text)
        RETURNING question_id,answer_text,client_version`,
    ]);
    const saved = rows.map((row) => ({
      questionId: String(row.question_id),
      answerText: String(row.answer_text),
      clientVersion: Number(row.client_version),
    }));
    if (saved.length !== parsed.answers.length) {
      const active =
        await sql`SELECT id FROM kousuan.practice_rounds WHERE id=${roundId} AND user_id=${user.id} AND status='started'`;
      if (!active[0])
        throw Object.assign(new Error('这轮练习已经结束'), { statusCode: 409 });
      const savedIds = new Set(saved.map((a) => a.questionId));
      const stale = parsed.answers.find((a) => !savedIds.has(a.questionId))!;
      const current =
        await sql`SELECT answer_text,client_version FROM kousuan.practice_answers WHERE question_id=${stale.questionId}`;
      throw Object.assign(
        new Error('答案已在另一页面或设备更新，请确认后再试'),
        {
          statusCode: 409,
          details: {
            code: 'ANSWER_VERSION_STALE',
            questionId: stale.questionId,
            answerText: String(current[0]?.answer_text ?? ''),
            clientVersion: Number(current[0]?.client_version ?? 0),
          },
        },
      );
    }
    return send(res, 200, { ok: true, saved });
  }
  if (action === 'submit') {
    method(req, 'POST');
    const metadata =
      await sql`SELECT q.id,q.level,q.expression,q.correct_answer FROM kousuan.round_questions q
      JOIN kousuan.practice_rounds r ON r.id=q.round_id WHERE r.id=${roundId} AND r.user_id=${user.id}`;
    const keys = Object.fromEntries(
      metadata.map((q) => [
        String(q.id),
        questionKey(
          String(q.level),
          String(q.expression),
          Number(q.correct_answer),
        ),
      ]),
    );
    // Saving and submitting share the round lock. The next transaction statement gets a fresh
    // snapshot after the lock, grades the saved answers, and applies statistics only once.
    await sql.transaction([
      sql`SELECT id FROM kousuan.practice_rounds WHERE id=${roundId} AND user_id=${user.id} FOR UPDATE`,
      sql`WITH eligible AS MATERIALIZED (
        SELECT r.id FROM kousuan.practice_rounds r WHERE r.id=${roundId} AND r.user_id=${user.id} AND r.status='started'
        AND NOT EXISTS (SELECT 1 FROM kousuan.round_questions q LEFT JOIN kousuan.practice_answers a ON a.question_id=q.id
          WHERE q.round_id=r.id AND (a.answer_text IS NULL OR a.answer_text !~ '^-?[0-9]{1,4}$'))
      ), graded AS (
        UPDATE kousuan.practice_answers a SET is_correct=CASE WHEN a.answer_text ~ '^-?[0-9]{1,4}$' THEN a.answer_text::int=q.correct_answer ELSE false END
        FROM kousuan.round_questions q,eligible e WHERE a.question_id=q.id AND q.round_id=e.id RETURNING a.*
      ), mistakes AS (
        INSERT INTO kousuan.wrong_question_stats(user_id,expression,correct_answer,level,last_answer,prompt_data,question_key,mistake_count)
        SELECT ${user.id},max(q.expression),max(q.correct_answer),max(q.level),
          (array_agg(g.answer_text ORDER BY q.position DESC))[1],
          (jsonb_agg(q.prompt_data ORDER BY q.position DESC))->0,k.value,count(*)::int
        FROM graded g JOIN kousuan.round_questions q ON q.id=g.question_id
        JOIN jsonb_each_text(${JSON.stringify(keys)}::jsonb) k ON k.key=q.id::text WHERE NOT g.is_correct GROUP BY k.value
        ON CONFLICT(user_id,question_key) DO UPDATE SET mistake_count=kousuan.wrong_question_stats.mistake_count+excluded.mistake_count,
          last_answer=excluded.last_answer,level=excluded.level,prompt_data=excluded.prompt_data,last_seen_at=now(),correct_streak=0,mastered_at=NULL,next_review_at=now()
      ) UPDATE kousuan.practice_rounds r SET status='completed',
          correct_count=(SELECT count(*)::int FROM graded WHERE is_correct),
          score=(SELECT round(100.0*count(*) FILTER(WHERE is_correct)/nullif(count(*),0))::int FROM graded),
          completed_at=now(),duration_seconds=greatest(0,extract(epoch from(now()-r.started_at))::int)
        FROM eligible e WHERE r.id=e.id RETURNING r.id`,
    ]);
    const result =
      await sql`SELECT * FROM kousuan.practice_rounds WHERE id=${roundId} AND user_id=${user.id}`;
    if (result[0]?.status !== 'completed')
      throw Object.assign(
        new Error(
          result[0]?.status === 'started'
            ? '请答完所有题目再交卷'
            : '这轮练习不在答题中',
        ),
        { statusCode: result[0]?.status === 'started' ? 400 : 409 },
      );
    return send(res, 200, {
      result: result[0],
      round: await fetchRound(user.id, roundId),
    });
  }
  if (action === 'abandon') {
    method(req, 'POST');
    const rows =
      (await sql`UPDATE kousuan.practice_rounds SET status = 'abandoned', abandoned_at = now()
      WHERE id = ${roundId} AND user_id = ${user.id} AND status IN ('generated', 'started') RETURNING id`) as Row[];
    if (!rows[0])
      throw Object.assign(new Error('这轮练习已经结束'), { statusCode: 409 });
    return send(res, 200, { ok: true });
  }
  if (action === 'repeat') {
    method(req, 'POST');
    const parsed = z.object({ idempotencyKey: z.uuid() }).parse(body(req));
    const source =
      (await sql`SELECT * FROM kousuan.practice_rounds WHERE id = ${roundId} AND user_id = ${user.id} AND status = 'completed'`) as Row[];
    if (!source[0])
      throw Object.assign(new Error('只能重练已完成的练习'), {
        statusCode: 409,
      });
    const active =
      (await sql`SELECT id FROM kousuan.practice_rounds WHERE user_id = ${user.id} AND status IN ('generated', 'started') LIMIT 1`) as Row[];
    if (active[0])
      throw Object.assign(new Error('请先完成当前练习'), { statusCode: 409 });
    const counts: QuestionCounts = {
      starter: Number(source[0].starter_count),
      explorer: Number(source[0].explorer_count),
      challenger: Number(source[0].challenger_count),
      multiplyMeaning: Number(source[0].multiply_meaning_count),
      multiplyFacts: Number(source[0].multiply_facts_count),
      multiplyMixed: Number(source[0].multiply_mixed_count ?? 0),
      abacusMove: Number(source[0].abacus_move_count),
      abacusMatch: Number(source[0].abacus_match_count),
      abacusCalculation: Number(source[0].abacus_calculation_count),
    };
    const sourceQuestions =
      (await sql`SELECT expression FROM kousuan.round_questions WHERE round_id = ${roundId} AND level = 'challenger'`) as Row[];
    const challengerChain = sourceQuestions.some(
      (question) =>
        (String(question.expression).match(/[+−]/g) ?? []).length > 1,
    );
    const newId = randomUUID();
    const seed = randomInt(1, 2_000_000_000);
    const generated = makeQuestionsForCounts(seed, counts, { challengerChain });
    await sql.transaction([
      sql`INSERT INTO kousuan.practice_rounds (id, user_id, family_id, idempotency_key, source, package_name, starter_count, explorer_count, challenger_count, multiply_meaning_count, multiply_facts_count, multiply_mixed_count, abacus_move_count, abacus_match_count, abacus_calculation_count, total_count, seed, mode)
        VALUES (${newId}, ${user.id}, ${user.family_id}, ${parsed.idempotencyKey}, 'repeat', ${`${String(source[0].package_name)}·再练一次`}, ${counts.starter}, ${counts.explorer}, ${counts.challenger}, ${counts.multiplyMeaning}, ${counts.multiplyFacts}, ${counts.multiplyMixed}, ${counts.abacusMove}, ${counts.abacusMatch}, ${counts.abacusCalculation}, ${generated.length}, ${seed}, ${source[0].mode})`,
      ...generated.map(
        (question, index) =>
          sql`INSERT INTO kousuan.round_questions (round_id, position, level, expression, correct_answer, prompt_data) VALUES (${newId}, ${index + 1}, ${question.level}, ${question.expression}, ${question.answer}, ${JSON.stringify(question.promptData ?? {})}::jsonb)`,
      ),
    ]);
    return send(res, 201, { round: await fetchRound(user.id, newId) });
  }
  throw Object.assign(new Error('接口不存在'), { statusCode: 404 });
}

async function records(req: VercelRequest, res: VercelResponse) {
  method(req, 'GET');
  const user = await requireUser(req, ['child']);
  const rows = await db()`WITH recent AS (
      SELECT id, package_name, starter_count, explorer_count, challenger_count,
        multiply_meaning_count, multiply_facts_count, multiply_mixed_count, abacus_move_count,
        abacus_match_count, abacus_calculation_count, total_count,
        score, correct_count, duration_seconds, started_at, completed_at, mode
      FROM kousuan.practice_rounds
      WHERE user_id = ${user.id} AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 5
    )
    SELECT recent.*,
      coalesce(json_agg(json_build_object(
        'id', q.id,
        'position', q.position,
        'level', q.level,
        'expression', q.expression,
        'promptData', q.prompt_data,
        'answer', a.answer_text,
        'clientVersion', a.client_version,
        'isCorrect', a.is_correct,
        'correctAnswer', q.correct_answer
      ) ORDER BY q.position) FILTER (WHERE q.id IS NOT NULL), '[]'::json) AS questions
    FROM recent
    LEFT JOIN kousuan.round_questions q ON q.round_id = recent.id
    LEFT JOIN kousuan.practice_answers a ON a.question_id = q.id
    GROUP BY recent.id, recent.package_name, recent.starter_count, recent.explorer_count,
      recent.challenger_count, recent.multiply_meaning_count, recent.multiply_facts_count, recent.multiply_mixed_count,
      recent.abacus_move_count, recent.abacus_match_count, recent.abacus_calculation_count,
      recent.total_count, recent.score, recent.correct_count,
      recent.duration_seconds, recent.started_at, recent.completed_at, recent.mode
    ORDER BY recent.completed_at DESC`;
  return send(res, 200, { records: rows });
}

async function wrongBook(req: VercelRequest, res: VercelResponse) {
  method(req, 'GET');
  const user = await requireUser(req, ['child']);
  const rows =
    await db()`SELECT id, expression, correct_answer, level, mistake_count, last_answer, last_seen_at, prompt_data, review_count, correct_streak, last_reviewed_at, next_review_at, mastered_at
    FROM kousuan.wrong_question_stats WHERE user_id = ${user.id} ORDER BY mastered_at NULLS FIRST, next_review_at ASC NULLS FIRST, last_seen_at DESC LIMIT 200`;
  return send(res, 200, { wrongQuestions: rows });
}

export async function handleApi(req: VercelRequest, res: VercelResponse) {
  try {
    const path = routePath(req);
    if (req.method !== 'GET' && req.headers.origin) {
      const origin = new URL(String(req.headers.origin));
      if (origin.host !== req.headers.host)
        throw Object.assign(new Error('请求来源不正确'), { statusCode: 403 });
    }
    if (path === 'auth/recovery-code') return await issueRecovery(req, res);
    if (path === 'auth/recover') return await recoverPassword(req, res);
    if (path === 'learning/preferences') return await preferences(req, res);
    if (path === 'learning/progress') return await progress(req, res);
    const learningMatch = path.match(
      /^parent\/children\/([0-9a-f-]+)\/(preferences|progress)$/,
    );
    if (learningMatch)
      return learningMatch[2] === 'preferences'
        ? await preferences(req, res, learningMatch[1])
        : await progress(req, res, learningMatch[1]);
    const reviewMatch = path.match(/^wrong-book\/([0-9a-f-]+)\/review$/);
    if (reviewMatch) return await reviewWrong(req, res, reviewMatch[1]);
    if (path === 'auth/register') return await register(req, res);
    if (path === 'auth/login') return await login(req, res);
    if (path === 'auth/logout') {
      method(req, 'POST');
      await destroySession(req, res);
      return send(res, 200, { ok: true });
    }
    if (path === 'auth/me') {
      method(req, 'GET');
      return send(res, 200, { user: publicUser(await currentUser(req)) });
    }
    if (path === 'auth/change-password') return await changePassword(req, res);
    if (path === 'parent/profile') {
      method(req, 'PUT');
      const parent = await requireUser(req, ['parent', 'site_owner']);
      const input = z
        .object({
          displayName: z.string().trim().min(1).max(20),
          familyName: z.string().trim().max(30).optional(),
        })
        .parse(body(req));
      await db().transaction([
        db()`UPDATE kousuan.users SET display_name=${input.displayName},updated_at=now() WHERE id=${parent.id}`,
        ...(input.familyName
          ? [
              db()`UPDATE kousuan.families SET name=${input.familyName} WHERE id=${parent.family_id}`,
            ]
          : []),
      ]);
      return send(res, 200, {
        user: publicUser({ ...parent, display_name: input.displayName }),
      });
    }
    if (path === 'parent/children') return await children(req, res);
    const childMatch = path.match(
      /^parent\/children\/([0-9a-f-]+)\/(reset-password|status|enter)$/,
    );
    if (childMatch)
      return await childAction(req, res, childMatch[1], childMatch[2]);
    if (path === 'rounds') return await createRound(req, res);
    if (path === 'rounds/active') return await activeRound(req, res);
    const roundMatch = path.match(
      /^rounds\/([0-9a-f-]+)\/(start|answers|submit|repeat|abandon|check)$/,
    );
    if (roundMatch)
      return await roundAction(req, res, roundMatch[1], roundMatch[2]);
    if (path === 'records') return await records(req, res);
    if (path === 'wrong-book') return await wrongBook(req, res);
    return send(res, 404, { error: '接口不存在' });
  } catch (error) {
    const issue =
      error instanceof z.ZodError
        ? error.issues[0]?.message
        : error instanceof Error
          ? error.message
          : '服务暂时不可用';
    const status =
      error instanceof z.ZodError
        ? 400
        : Number((error as { statusCode?: number })?.statusCode ?? 500);
    if (status >= 500) console.error(error);
    return send(res, status, {
      error: status >= 500 ? '服务暂时不可用，请稍后重试' : issue,
      ...(((error as { details?: Record<string, unknown> })?.details ??
        {}) as Record<string, unknown>),
    });
  }
}

import { createHash, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { totalQuestions } from '../lib/questions.js';
import {
  changePassword as changePasswordWithSession,
  createSession,
  currentUser,
  deleteUserSessions,
  destroySession,
  hashPassword,
  normalizeUsername,
  requireUser,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './auth.js';
import { db, withTransaction } from './db.js';
import { body, method, routePath, send } from './http.js';
import {
  abandonRound,
  createRound as createRoundService,
  repeatRound,
  saveAnswers,
  startRound,
  submitRound,
} from './round-service.js';

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
        blocked_until = CASE
          WHEN kousuan.login_attempts.window_started_at < now() - interval '15 minutes' THEN NULL
          WHEN kousuan.login_attempts.attempt_count + 1 >= 6 THEN now() + interval '10 minutes'
          ELSE NULL
        END`;
    throw Object.assign(new Error('用户名或密码不正确'), { statusCode: 401 });
  }
  await sql`DELETE FROM kousuan.login_attempts WHERE bucket = ${bucket}`;
  await createSession(
    String(user.id),
    req,
    res,
    withTransaction,
    String(user.password_hash),
  );
  return send(res, 200, { user: publicUser(user as never) });
}

async function register(req: VercelRequest, res: VercelResponse) {
  method(req, 'POST');
  const parsed = z
    .object({
      familyName: z
        .string()
        .trim()
        .min(1, '请输入家庭名称')
        .max(30, '家庭名称最多 30 个字'),
      displayName: z
        .string()
        .trim()
        .min(1, '请输入家长称呼')
        .max(20, '家长称呼最多 20 个字'),
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

  const familyId = randomUUID();
  const userId = randomUUID();
  try {
    await sql.transaction([
      sql`INSERT INTO kousuan.families (id, name) VALUES (${familyId}, ${parsed.familyName})`,
      sql`INSERT INTO kousuan.users (id, family_id, username, display_name, password_hash, role)
        VALUES (${userId}, ${familyId}, ${username}, ${parsed.displayName}, ${passwordHash}, 'parent')`,
      sql`INSERT INTO kousuan.audit_events (family_id, actor_user_id, action, target_user_id)
        VALUES (${familyId}, ${userId}, 'family.registered', ${userId})`,
    ]);
  } catch (error) {
    if (String(error).includes('users_username_key')) {
      throw Object.assign(new Error('这个用户名已被使用'), { statusCode: 409 });
    }
    throw error;
  }

  await createSession(userId, req, res);
  return send(res, 201, {
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
  await changePasswordWithSession(
    {
      userId: user.id,
      currentPassword: parsed.currentPassword,
      newPassword: parsed.newPassword,
    },
    req,
    res,
  );
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
    (await sql`SELECT id FROM kousuan.users WHERE id = ${childId} AND family_id = ${parent.family_id} AND role = 'child'`) as Row[];
  if (!childRows[0])
    throw Object.assign(new Error('孩子账号不存在'), { statusCode: 404 });
  if (action === 'reset-password') {
    const parsed = z.object({ password: z.string() }).parse(body(req));
    validatePassword(parsed.password, 'child');
    const passwordHash = await hashPassword(parsed.password);
    await withTransaction(async (tx) => {
      const locked = await tx.query<{ id: string }>(
        'SELECT id FROM kousuan.users WHERE id = $1 AND family_id = $2 AND role = $3 FOR UPDATE',
        [childId, parent.family_id, 'child'],
      );
      if (!locked.rows[0])
        throw Object.assign(new Error('孩子账号不存在'), { statusCode: 404 });
      await tx.query(
        `UPDATE kousuan.users SET password_hash = $2, must_change_password = true, updated_at = now()
          WHERE id = $1`,
        [childId, passwordHash],
      );
      await deleteUserSessions(tx, childId);
      await tx.query(
        `INSERT INTO kousuan.audit_events (family_id, actor_user_id, action, target_user_id)
          VALUES ($1, $2, 'child.password_reset', $3)`,
        [parent.family_id, parent.id, childId],
      );
    });
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
    source: round.source,
    packageName: round.package_name,
    counts: {
      starter: round.starter_count,
      explorer: round.explorer_count,
      challenger: round.challenger_count,
      multiplyMeaning: round.multiply_meaning_count,
      multiplyFacts: round.multiply_facts_count,
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
      idempotencyKey: z.uuid(),
    })
    .parse(body(req));
  const outcome = await createRoundService(user.id, {
    counts: input.counts,
    challengerChain: input.challengerChain,
    idempotencyKey: input.idempotencyKey,
  });
  return send(res, outcome.existing ? 200 : 201, {
    round: await fetchRound(user.id, outcome.roundId),
  });
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
  if (action === 'start') {
    method(req, 'POST');
    await startRound(user.id, roundId);
    return send(res, 200, { round: await fetchRound(user.id, roundId) });
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
    const { saved } = await saveAnswers(user.id, roundId, parsed.answers);
    return send(res, 200, { ok: true, saved });
  }
  if (action === 'submit') {
    method(req, 'POST');
    const outcome = await submitRound(user.id, roundId);
    return send(res, 200, {
      result: outcome.result,
      round: await fetchRound(user.id, roundId),
    });
  }
  if (action === 'abandon') {
    method(req, 'POST');
    await abandonRound(user.id, roundId);
    return send(res, 200, { ok: true });
  }
  if (action === 'repeat') {
    method(req, 'POST');
    const parsed = z.object({ idempotencyKey: z.uuid() }).parse(body(req));
    const outcome = await repeatRound(user.id, roundId, parsed.idempotencyKey);
    return send(res, outcome.existing ? 200 : 201, {
      round: await fetchRound(user.id, outcome.roundId),
    });
  }
  throw Object.assign(new Error('接口不存在'), { statusCode: 404 });
}

async function records(req: VercelRequest, res: VercelResponse) {
  method(req, 'GET');
  const user = await requireUser(req, ['child']);
  const rows = await db()`WITH recent AS (
      SELECT id, package_name, starter_count, explorer_count, challenger_count,
        multiply_meaning_count, multiply_facts_count, abacus_move_count,
        abacus_match_count, abacus_calculation_count, total_count,
        score, correct_count, duration_seconds, started_at, completed_at
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
      recent.challenger_count, recent.multiply_meaning_count, recent.multiply_facts_count,
      recent.abacus_move_count, recent.abacus_match_count, recent.abacus_calculation_count,
      recent.total_count, recent.score, recent.correct_count,
      recent.duration_seconds, recent.started_at, recent.completed_at
    ORDER BY recent.completed_at DESC`;
  return send(res, 200, { records: rows });
}

async function wrongBook(req: VercelRequest, res: VercelResponse) {
  method(req, 'GET');
  const user = await requireUser(req, ['child']);
  const rows =
    await db()`SELECT id, expression, correct_answer, level, mistake_count, last_answer, last_seen_at, prompt_data
    FROM kousuan.wrong_question_stats WHERE user_id = ${user.id} ORDER BY last_seen_at DESC LIMIT 200`;
  return send(res, 200, { wrongQuestions: rows });
}

export async function handleApi(req: VercelRequest, res: VercelResponse) {
  try {
    const path = routePath(req);
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
    if (path === 'parent/children') return await children(req, res);
    const childMatch = path.match(
      /^parent\/children\/([0-9a-f-]+)\/(reset-password|status)$/,
    );
    if (childMatch)
      return await childAction(req, res, childMatch[1], childMatch[2]);
    if (path === 'rounds') return await createRound(req, res);
    if (path === 'rounds/active') return await activeRound(req, res);
    const roundMatch = path.match(
      /^rounds\/([0-9a-f-]+)\/(start|answers|submit|repeat|abandon)$/,
    );
    if (roundMatch)
      return await roundAction(req, res, roundMatch[1], roundMatch[2]);
    if (path === 'records') return await records(req, res);
    if (path === 'wrong-book') return await wrongBook(req, res);
    return send(res, 404, { error: '接口不存在' });
  } catch (error) {
    const status =
      error instanceof z.ZodError
        ? 400
        : Number((error as { statusCode?: number })?.statusCode ?? 500);
    if (status >= 500) {
      // 记录服务端错误；对外只返回统一文案，不泄露数据库或内部细节。
      console.error('[api] 服务端错误', error);
      return send(res, 500, { error: '服务暂时不可用' });
    }
    const issue =
      error instanceof z.ZodError
        ? error.issues[0]?.message
        : error instanceof Error
          ? error.message
          : '服务暂时不可用';
    return send(res, status, {
      error: issue,
      ...(((error as { details?: Record<string, unknown> })?.details ??
        {}) as Record<string, unknown>),
    });
  }
}

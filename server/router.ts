import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { PRESETS, getPreset, totalQuestions, type QuestionCounts } from '../lib/presets.js';
import { makeQuestionsForCounts } from '../lib/questions.js';
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
import { body, method, routePath, send } from './http.js';

type Row = Record<string, unknown>;
type LoginAttemptRow = { attempt_count: number; window_started_at?: string; blocked_until: string | null };
type LoginUserRow = Row & { id: string; password_hash: string; is_active: boolean };
type AnswerRow = Row & { id: string; expression: string; correct_answer: number; level: string; answer_text: string | null };

export async function fetchChildrenSummary(familyId: string) {
  return db()`SELECT u.id, u.username, u.display_name, u.is_active, u.must_change_password, u.created_at,
      count(r.id) FILTER (WHERE r.status = 'completed')::int AS round_count,
      coalesce(round(avg(r.score) FILTER (WHERE r.status = 'completed')), 0)::int AS average_score,
      max(r.completed_at) AS last_practiced_at
    FROM kousuan.users u LEFT JOIN kousuan.practice_rounds r ON r.user_id = u.id
    WHERE u.family_id = ${familyId} AND u.role = 'child'
    GROUP BY u.id ORDER BY u.created_at`;
}

const countSchema = z.object({
  starter: z.number().int().min(0).max(50),
  explorer: z.number().int().min(0).max(50),
  challenger: z.number().int().min(0).max(50),
}).refine((counts) => totalQuestions(counts) >= 1 && totalQuestions(counts) <= 100, '总题数需为 1–100 道');

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
  return String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim();
}

async function login(req: VercelRequest, res: VercelResponse) {
  method(req, 'POST');
  const parsed = z.object({ username: z.string().min(1), password: z.string().min(1).max(128) }).parse(body(req));
  const username = normalizeUsername(parsed.username);
  const bucket = createHash('sha256').update(`${clientIp(req)}:${username}`).digest('hex');
  const sql = db();
  const attempts = await sql`SELECT attempt_count, blocked_until FROM kousuan.login_attempts WHERE bucket = ${bucket}` as LoginAttemptRow[];
  const blockedUntil = attempts[0]?.blocked_until ? new Date(attempts[0].blocked_until) : null;
  if (blockedUntil && blockedUntil > new Date()) throw Object.assign(new Error('尝试次数过多，请稍后再试'), { statusCode: 429 });

  const users = await sql`SELECT id, family_id, username, display_name, role, is_active,
      must_change_password, password_hash FROM kousuan.users WHERE username = ${username} LIMIT 1` as LoginUserRow[];
  const user = users[0];
  const valid = Boolean(user?.is_active) && await verifyPassword(user?.password_hash ?? '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', parsed.password).catch(() => false);
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
  const parsed = z.object({
    familyName: z.string().trim().min(1, '请输入家庭名称').max(30, '家庭名称最多 30 个字'),
    displayName: z.string().trim().min(1, '请输入家长称呼').max(20, '家长称呼最多 20 个字'),
    username: z.string().min(1, '请输入用户名'),
    password: z.string().min(1, '请输入密码'),
  }).parse(body(req));
  const username = validateUsername(parsed.username);
  validatePassword(parsed.password, 'parent');

  const sql = db();
  const bucket = createHash('sha256').update(`register:${clientIp(req)}`).digest('hex');
  const attempts = await sql`SELECT attempt_count, window_started_at, blocked_until
    FROM kousuan.login_attempts WHERE bucket = ${bucket}` as LoginAttemptRow[];
  const attempt = attempts[0];
  const now = new Date();
  const blockedUntil = attempt?.blocked_until ? new Date(attempt.blocked_until) : null;
  const windowStartedAt = attempt?.window_started_at ? new Date(attempt.window_started_at) : null;
  const currentWindow = Boolean(windowStartedAt && windowStartedAt.getTime() > now.getTime() - 60 * 60 * 1000);
  if ((blockedUntil && blockedUntil > now) || (currentWindow && Number(attempt?.attempt_count ?? 0) >= 5)) {
    throw Object.assign(new Error('注册次数过多，请一小时后再试'), { statusCode: 429 });
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
    user: { id: userId, username, displayName: parsed.displayName, role: 'parent', mustChangePassword: false },
  });
}

async function changePassword(req: VercelRequest, res: VercelResponse) {
  method(req, 'POST');
  const user = await requireUser(req);
  const parsed = z.object({ currentPassword: z.string(), newPassword: z.string() }).parse(body(req));
  const rows = await db()`SELECT password_hash FROM kousuan.users WHERE id = ${user.id}` as Row[];
  if (!await verifyPassword(String(rows[0]?.password_hash), parsed.currentPassword)) {
    throw Object.assign(new Error('当前密码不正确'), { statusCode: 400 });
  }
  validatePassword(parsed.newPassword, user.role === 'child' ? 'child' : 'parent');
  const passwordHash = await hashPassword(parsed.newPassword);
  await db()`UPDATE kousuan.users SET password_hash = ${passwordHash}, must_change_password = false, updated_at = now() WHERE id = ${user.id}`;
  return send(res, 200, { ok: true });
}

async function children(req: VercelRequest, res: VercelResponse) {
  const parent = await requireUser(req, ['parent', 'site_owner']);
  if (!parent.family_id) throw Object.assign(new Error('家庭信息不存在'), { statusCode: 400 });
  const sql = db();
  if (req.method === 'GET') {
    const rows = await fetchChildrenSummary(parent.family_id);
    return send(res, 200, { children: rows });
  }
  method(req, 'POST');
  const parsed = z.object({ username: z.string(), displayName: z.string().trim().min(1).max(20), password: z.string() }).parse(body(req));
  const username = validateUsername(parsed.username);
  validatePassword(parsed.password, 'child');
  const passwordHash = await hashPassword(parsed.password);
  try {
    const rows = await sql`INSERT INTO kousuan.users (family_id, username, display_name, password_hash, role)
      VALUES (${parent.family_id}, ${username}, ${parsed.displayName}, ${passwordHash}, 'child')
      RETURNING id, username, display_name, is_active, must_change_password, created_at` as Row[];
    await sql`INSERT INTO kousuan.audit_events (family_id, actor_user_id, action, target_user_id)
      VALUES (${parent.family_id}, ${parent.id}, 'child.created', ${rows[0].id})`;
    return send(res, 201, { child: rows[0] });
  } catch (error) {
    if (String(error).includes('users_username_key')) throw Object.assign(new Error('这个用户名已被使用'), { statusCode: 409 });
    throw error;
  }
}

async function childAction(req: VercelRequest, res: VercelResponse, childId: string, action: string) {
  method(req, 'POST');
  const parent = await requireUser(req, ['parent', 'site_owner']);
  const sql = db();
  const childRows = await sql`SELECT id FROM kousuan.users WHERE id = ${childId} AND family_id = ${parent.family_id} AND role = 'child'` as Row[];
  if (!childRows[0]) throw Object.assign(new Error('孩子账号不存在'), { statusCode: 404 });
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
    ...(parsed.isActive ? [] : [sql`DELETE FROM kousuan.sessions WHERE user_id = ${childId}`]),
    sql`INSERT INTO kousuan.audit_events (family_id, actor_user_id, action, target_user_id, metadata) VALUES (${parent.family_id}, ${parent.id}, 'child.status_changed', ${childId}, ${JSON.stringify({ isActive: parsed.isActive })}::jsonb)`,
  ]);
  return send(res, 200, { ok: true });
}

function serializeRound(round: Row, questions: Row[]) {
  const challengerChain = questions.some((question) =>
    question.level === 'challenger' && ((String(question.expression).match(/[+−]/g) ?? []).length > 1),
  );
  return {
    id: round.id,
    status: round.status,
    source: round.source,
    packageName: round.package_name,
    counts: { starter: round.starter_count, explorer: round.explorer_count, challenger: round.challenger_count },
    totalCount: round.total_count,
    startedAt: round.started_at,
    completedAt: round.completed_at,
    challengerChain,
    questions: questions.map((question) => ({
      id: question.id, position: question.position, level: question.level, expression: question.expression,
      answer: question.answer_text ?? '', isCorrect: question.is_correct,
      correctAnswer: round.status === 'completed' ? question.correct_answer : undefined,
    })),
  };
}

async function fetchRound(userId: string, roundId: string) {
  const sql = db();
  const rounds = await sql`SELECT * FROM kousuan.practice_rounds WHERE id = ${roundId} AND user_id = ${userId} LIMIT 1` as Row[];
  if (!rounds[0]) throw Object.assign(new Error('练习不存在'), { statusCode: 404 });
  const questions = await sql`SELECT q.id, q.position, q.level, q.expression, q.correct_answer,
      a.answer_text, a.is_correct FROM kousuan.round_questions q
      LEFT JOIN kousuan.practice_answers a ON a.question_id = q.id
      WHERE q.round_id = ${roundId} ORDER BY q.position` as Row[];
  return serializeRound(rounds[0], questions);
}

async function createRound(req: VercelRequest, res: VercelResponse) {
  method(req, 'POST');
  const user = await requireUser(req, ['child']);
  const input = z.discriminatedUnion('source', [
    z.object({ source: z.literal('preset'), presetKey: z.string(), presetVersion: z.number().int(), idempotencyKey: z.uuid() }),
    z.object({ source: z.literal('custom'), counts: countSchema, challengerChain: z.boolean().default(false), idempotencyKey: z.uuid() }),
  ]).parse(body(req));
  const sql = db();
  const duplicate = await sql`SELECT id FROM kousuan.practice_rounds WHERE user_id = ${user.id} AND idempotency_key = ${input.idempotencyKey}` as Row[];
  if (duplicate[0]) return send(res, 200, { round: await fetchRound(user.id, String(duplicate[0].id)) });
  const active = await sql`SELECT id FROM kousuan.practice_rounds WHERE user_id = ${user.id} AND status IN ('generated', 'started') LIMIT 1` as Row[];
  if (active[0]) throw Object.assign(new Error('你还有一轮练习没有完成'), { statusCode: 409, activeRoundId: active[0].id });

  let counts: QuestionCounts;
  let packageName: string;
  let challengerChain = false;
  let presetKey: string | null = null;
  let presetVersion: number | null = null;
  if (input.source === 'preset') {
    const preset = getPreset(input.presetKey, input.presetVersion);
    if (!preset) throw Object.assign(new Error('这个推荐套餐已更新，请刷新后再试'), { statusCode: 409 });
    counts = preset.counts;
    packageName = preset.name;
    presetKey = preset.key;
    presetVersion = preset.version;
    challengerChain = preset.challengerChain;
  } else {
    counts = input.counts;
    packageName = '自选练习';
    challengerChain = input.challengerChain;
  }
  const roundId = randomUUID();
  const seed = randomInt(1, 2_000_000_000);
  const generated = makeQuestionsForCounts(seed, counts, { challengerChain });
  const statements = [
    sql`INSERT INTO kousuan.practice_rounds (id, user_id, family_id, idempotency_key, source, preset_key, preset_version, package_name, starter_count, explorer_count, challenger_count, total_count, seed)
      VALUES (${roundId}, ${user.id}, ${user.family_id}, ${input.idempotencyKey}, ${input.source}, ${presetKey}, ${presetVersion}, ${packageName}, ${counts.starter}, ${counts.explorer}, ${counts.challenger}, ${generated.length}, ${seed})`,
    ...generated.map((question, index) => sql`INSERT INTO kousuan.round_questions (round_id, position, level, expression, correct_answer)
      VALUES (${roundId}, ${index + 1}, ${question.level}, ${question.expression}, ${question.answer})`),
  ];
  await sql.transaction(statements);
  return send(res, 201, { round: await fetchRound(user.id, roundId) });
}

async function activeRound(req: VercelRequest, res: VercelResponse) {
  method(req, 'GET');
  const user = await requireUser(req, ['child']);
  const rows = await db()`SELECT id FROM kousuan.practice_rounds WHERE user_id = ${user.id} AND status IN ('generated', 'started') ORDER BY created_at DESC LIMIT 1` as Row[];
  return send(res, 200, { round: rows[0] ? await fetchRound(user.id, String(rows[0].id)) : null });
}

async function roundAction(req: VercelRequest, res: VercelResponse, roundId: string, action: string) {
  const user = await requireUser(req, ['child']);
  const sql = db();
  if (action === 'start') {
    method(req, 'POST');
    const rows = await sql`UPDATE kousuan.practice_rounds SET status = 'started', started_at = coalesce(started_at, now())
      WHERE id = ${roundId} AND user_id = ${user.id} AND status IN ('generated', 'started') RETURNING id` as Row[];
    if (!rows[0]) throw Object.assign(new Error('这轮练习无法开始'), { statusCode: 409 });
    return send(res, 200, { round: await fetchRound(user.id, roundId) });
  }
  if (action === 'answers') {
    method(req, 'PATCH');
    const parsed = z.object({ answers: z.array(z.object({ questionId: z.uuid(), answer: z.string().regex(/^-?\d{0,4}$/) })).max(100) }).parse(body(req));
    const roundRows = await sql`SELECT id FROM kousuan.practice_rounds WHERE id = ${roundId} AND user_id = ${user.id} AND status = 'started'` as Row[];
    if (!roundRows[0]) throw Object.assign(new Error('这轮练习不在答题中'), { statusCode: 409 });
    const allowed = await sql`SELECT id FROM kousuan.round_questions WHERE round_id = ${roundId}` as Row[];
    const allowedIds = new Set(allowed.map((row) => String(row.id)));
    if (parsed.answers.some((answer) => !allowedIds.has(answer.questionId))) throw Object.assign(new Error('答案中包含无效题目'), { statusCode: 400 });
    if (parsed.answers.length) await sql.transaction(parsed.answers.map((answer) => sql`INSERT INTO kousuan.practice_answers (question_id, round_id, answer_text, updated_at)
      VALUES (${answer.questionId}, ${roundId}, ${answer.answer}, now())
      ON CONFLICT (question_id) DO UPDATE SET answer_text = excluded.answer_text, updated_at = now()`));
    return send(res, 200, { ok: true });
  }
  if (action === 'submit') {
    method(req, 'POST');
    const rows = await sql`SELECT q.id, q.expression, q.correct_answer, q.level, a.answer_text
      FROM kousuan.round_questions q LEFT JOIN kousuan.practice_answers a ON a.question_id = q.id
      JOIN kousuan.practice_rounds r ON r.id = q.round_id
      WHERE q.round_id = ${roundId} AND r.user_id = ${user.id} AND r.status = 'started'
      ORDER BY q.position` as AnswerRow[];
    if (!rows.length) throw Object.assign(new Error('这轮练习不在答题中'), { statusCode: 409 });
    if (rows.some((row) => row.answer_text === null || String(row.answer_text).trim() === '')) throw Object.assign(new Error('请答完所有题目再交卷'), { statusCode: 400 });
    const correct = rows.filter((row) => Number(row.answer_text) === Number(row.correct_answer));
    const score = Math.round(correct.length / rows.length * 100);
    const statements = rows.map((row) => sql`UPDATE kousuan.practice_answers SET is_correct = ${Number(row.answer_text) === Number(row.correct_answer)} WHERE question_id = ${row.id}`);
    for (const row of rows.filter((item) => Number(item.answer_text) !== Number(item.correct_answer))) {
      statements.push(sql`INSERT INTO kousuan.wrong_question_stats (user_id, expression, correct_answer, level, last_answer)
        VALUES (${user.id}, ${String(row.expression)}, ${Number(row.correct_answer)}, ${String(row.level)}, ${String(row.answer_text)})
        ON CONFLICT (user_id, expression, correct_answer) DO UPDATE SET mistake_count = kousuan.wrong_question_stats.mistake_count + 1, last_answer = excluded.last_answer, last_seen_at = now()`);
    }
    statements.push(sql`UPDATE kousuan.practice_rounds SET status = 'completed', score = ${score}, correct_count = ${correct.length}, completed_at = now(), duration_seconds = greatest(0, extract(epoch from (now() - started_at))::int)
      WHERE id = ${roundId} AND user_id = ${user.id} AND status = 'started'`);
    await sql.transaction(statements);
    const result = await sql`SELECT score, correct_count, total_count, duration_seconds, completed_at FROM kousuan.practice_rounds WHERE id = ${roundId}` as Row[];
    return send(res, 200, { result: result[0], round: await fetchRound(user.id, roundId) });
  }
  if (action === 'abandon') {
    method(req, 'POST');
    const rows = await sql`UPDATE kousuan.practice_rounds SET status = 'abandoned', abandoned_at = now()
      WHERE id = ${roundId} AND user_id = ${user.id} AND status IN ('generated', 'started') RETURNING id` as Row[];
    if (!rows[0]) throw Object.assign(new Error('这轮练习已经结束'), { statusCode: 409 });
    return send(res, 200, { ok: true });
  }
  if (action === 'repeat') {
    method(req, 'POST');
    const parsed = z.object({ idempotencyKey: z.uuid() }).parse(body(req));
    const source = await sql`SELECT * FROM kousuan.practice_rounds WHERE id = ${roundId} AND user_id = ${user.id} AND status = 'completed'` as Row[];
    if (!source[0]) throw Object.assign(new Error('只能重练已完成的练习'), { statusCode: 409 });
    const active = await sql`SELECT id FROM kousuan.practice_rounds WHERE user_id = ${user.id} AND status IN ('generated', 'started') LIMIT 1` as Row[];
    if (active[0]) throw Object.assign(new Error('请先完成当前练习'), { statusCode: 409 });
    const counts = { starter: Number(source[0].starter_count), explorer: Number(source[0].explorer_count), challenger: Number(source[0].challenger_count) };
    const sourceQuestions = await sql`SELECT expression FROM kousuan.round_questions WHERE round_id = ${roundId} AND level = 'challenger'` as Row[];
    const challengerChain = sourceQuestions.some((question) => ((String(question.expression).match(/[+−]/g) ?? []).length > 1));
    const newId = randomUUID();
    const seed = randomInt(1, 2_000_000_000);
    const generated = makeQuestionsForCounts(seed, counts, { challengerChain });
    await sql.transaction([
      sql`INSERT INTO kousuan.practice_rounds (id, user_id, family_id, idempotency_key, source, package_name, starter_count, explorer_count, challenger_count, total_count, seed)
        VALUES (${newId}, ${user.id}, ${user.family_id}, ${parsed.idempotencyKey}, 'repeat', ${`${String(source[0].package_name)}·再练一次`}, ${counts.starter}, ${counts.explorer}, ${counts.challenger}, ${generated.length}, ${seed})`,
      ...generated.map((question, index) => sql`INSERT INTO kousuan.round_questions (round_id, position, level, expression, correct_answer) VALUES (${newId}, ${index + 1}, ${question.level}, ${question.expression}, ${question.answer})`),
    ]);
    return send(res, 201, { round: await fetchRound(user.id, newId) });
  }
  throw Object.assign(new Error('接口不存在'), { statusCode: 404 });
}

async function records(req: VercelRequest, res: VercelResponse) {
  method(req, 'GET');
  const user = await requireUser(req, ['child']);
  const rows = await db()`WITH recent AS (
      SELECT id, package_name, starter_count, explorer_count, challenger_count, total_count,
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
        'answer', a.answer_text,
        'isCorrect', a.is_correct,
        'correctAnswer', q.correct_answer
      ) ORDER BY q.position) FILTER (WHERE q.id IS NOT NULL), '[]'::json) AS questions
    FROM recent
    LEFT JOIN kousuan.round_questions q ON q.round_id = recent.id
    LEFT JOIN kousuan.practice_answers a ON a.question_id = q.id
    GROUP BY recent.id, recent.package_name, recent.starter_count, recent.explorer_count,
      recent.challenger_count, recent.total_count, recent.score, recent.correct_count,
      recent.duration_seconds, recent.started_at, recent.completed_at
    ORDER BY recent.completed_at DESC`;
  return send(res, 200, { records: rows });
}

async function wrongBook(req: VercelRequest, res: VercelResponse) {
  method(req, 'GET');
  const user = await requireUser(req, ['child']);
  const rows = await db()`SELECT id, expression, correct_answer, level, mistake_count, last_answer, last_seen_at
    FROM kousuan.wrong_question_stats WHERE user_id = ${user.id} ORDER BY last_seen_at DESC LIMIT 200`;
  return send(res, 200, { wrongQuestions: rows });
}

export async function handleApi(req: VercelRequest, res: VercelResponse) {
  try {
    const path = routePath(req);
    if (path === 'auth/register') return await register(req, res);
    if (path === 'auth/login') return await login(req, res);
    if (path === 'auth/logout') { method(req, 'POST'); await destroySession(req, res); return send(res, 200, { ok: true }); }
    if (path === 'auth/me') { method(req, 'GET'); return send(res, 200, { user: publicUser(await currentUser(req)) }); }
    if (path === 'auth/change-password') return await changePassword(req, res);
    if (path === 'parent/children') return await children(req, res);
    const childMatch = path.match(/^parent\/children\/([0-9a-f-]+)\/(reset-password|status)$/);
    if (childMatch) return await childAction(req, res, childMatch[1], childMatch[2]);
    if (path === 'presets') { method(req, 'GET'); await requireUser(req, ['child']); return send(res, 200, { presets: PRESETS }); }
    if (path === 'rounds') return await createRound(req, res);
    if (path === 'rounds/active') return await activeRound(req, res);
    const roundMatch = path.match(/^rounds\/([0-9a-f-]+)\/(start|answers|submit|repeat|abandon)$/);
    if (roundMatch) return await roundAction(req, res, roundMatch[1], roundMatch[2]);
    if (path === 'records') return await records(req, res);
    if (path === 'wrong-book') return await wrongBook(req, res);
    return send(res, 404, { error: '接口不存在' });
  } catch (error) {
    const issue = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : '服务暂时不可用';
    const status = error instanceof z.ZodError ? 400 : Number((error as { statusCode?: number })?.statusCode ?? 500);
    if (status >= 500) console.error(error);
    return send(res, status, { error: issue });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { db } from './db.js';
import { requireUser } from './auth.js';
import { body, method, send } from './http.js';
import { defaultPreferences } from '../lib/learning.js';
import { totalQuestions } from '../lib/questions.js';

export const preferencesSchema = z.object({
  counts: z
    .object({
      starter: z.number().int().min(0).max(50),
      explorer: z.number().int().min(0).max(50),
      challenger: z.number().int().min(0).max(50),
      multiplyMeaning: z.number().int().min(0).max(50),
      multiplyFacts: z.number().int().min(0).max(50),
      multiplyMixed: z.number().int().min(0).max(50).default(0),
      divisionMeaning: z.number().int().min(0).max(50).default(0),
      divisionFacts: z.number().int().min(0).max(50).default(0),
      mixedWordProblem: z.number().int().min(0).max(50).default(0),
      abacusMove: z.number().int().min(0).max(50),
      abacusMatch: z.number().int().min(0).max(50),
      abacusCalculation: z.number().int().min(0).max(50),
    })
    .refine(
      (c) =>
        c.abacusMatch !== 1 &&
        totalQuestions(c) >= 1 &&
        totalQuestions(c) <= 100,
      '请选择 1–100 道题，连线题至少 2 道',
    ),
  challengerChain: z.boolean().default(false),
  mode: z.enum(['practice', 'challenge']).default('practice'),
});

export async function learningUser(req: VercelRequest, childId?: string) {
  const user = await requireUser(
    req,
    childId ? ['parent', 'site_owner'] : ['child'],
  );
  if (!childId) return user.id;
  z.uuid().parse(childId);
  const rows =
    await db()`SELECT id FROM kousuan.users WHERE id=${childId} AND family_id=${user.family_id} AND role='child'`;
  if (!rows.length)
    throw Object.assign(new Error('孩子账号不存在'), { statusCode: 404 });
  return childId;
}

export async function preferences(
  req: VercelRequest,
  res: VercelResponse,
  childId?: string,
) {
  const userId = await learningUser(req, childId);
  if (req.method === 'GET') {
    const rows =
      await db()`SELECT settings FROM kousuan.learning_preferences WHERE user_id=${userId}`;
    return send(res, 200, {
      preferences: preferencesSchema.parse(
        rows[0]?.settings ?? defaultPreferences,
      ),
    });
  }
  method(req, 'PUT');
  const settings = preferencesSchema.parse(body(req));
  await db()`INSERT INTO kousuan.learning_preferences(user_id,settings) VALUES(${userId},${JSON.stringify(settings)}::jsonb)
    ON CONFLICT(user_id) DO UPDATE SET settings=excluded.settings,updated_at=now()`;
  return send(res, 200, { preferences: settings });
}

export async function progress(
  req: VercelRequest,
  res: VercelResponse,
  childId?: string,
) {
  method(req, 'GET');
  const id = await learningUser(req, childId);
  const sql = db();
  const [topics, summary, recent] = await Promise.all([
    sql`SELECT q.level, count(*)::int AS attempted, count(*) FILTER(WHERE a.is_correct)::int AS correct,
      round(100.0 * count(*) FILTER(WHERE a.is_correct AND r.completed_at>=now()-interval '7 days') / nullif(count(*) FILTER(WHERE r.completed_at>=now()-interval '7 days'),0))::int AS recent_accuracy,
      round(100.0 * count(*) FILTER(WHERE a.is_correct AND r.completed_at<now()-interval '7 days' AND r.completed_at>=now()-interval '14 days') / nullif(count(*) FILTER(WHERE r.completed_at<now()-interval '7 days' AND r.completed_at>=now()-interval '14 days'),0))::int AS previous_accuracy
      FROM kousuan.round_questions q JOIN kousuan.practice_rounds r ON r.id=q.round_id JOIN kousuan.practice_answers a ON a.question_id=q.id
      WHERE r.user_id=${id} AND r.status='completed' GROUP BY q.level`,
    sql`SELECT count(*)::int AS rounds, coalesce(sum(total_count),0)::int AS questions, coalesce(sum(correct_count),0)::int AS correct,
      count(DISTINCT (completed_at AT TIME ZONE 'Asia/Shanghai')::date)::int AS practice_days
      FROM kousuan.practice_rounds WHERE user_id=${id} AND status='completed'`,
    sql`SELECT completed_at,total_count,correct_count,mode FROM kousuan.practice_rounds WHERE user_id=${id} AND status='completed' ORDER BY completed_at DESC LIMIT 10`,
  ]);
  return send(res, 200, { topics, summary: summary[0], recent });
}

export async function reviewWrong(
  req: VercelRequest,
  res: VercelResponse,
  wrongId: string,
) {
  method(req, 'POST');
  const user = await requireUser(req, ['child']);
  const parsed = z
    .object({ answer: z.string().regex(/^-?\d{1,4}$/), attemptId: z.uuid() })
    .parse(body(req));
  const sql = db();
  // The row lock serializes attempts for one question; only a newly inserted attempt updates progress.
  const rows = await sql`WITH target AS MATERIALIZED (
      SELECT * FROM kousuan.wrong_question_stats WHERE id=${wrongId} AND user_id=${user.id} FOR UPDATE
    ), attempt AS (
      INSERT INTO kousuan.review_attempts(id,wrong_question_id,user_id,answer_text,is_correct)
      SELECT ${parsed.attemptId},id,${user.id},${parsed.answer},correct_answer=${Number(parsed.answer)} FROM target
      ON CONFLICT(id) DO NOTHING RETURNING is_correct
    ), updated AS (
      UPDATE kousuan.wrong_question_stats w SET
        review_count=w.review_count+1,
        correct_streak=CASE WHEN NOT a.is_correct THEN 0 WHEN w.next_review_at<=now() OR w.last_reviewed_at IS NULL THEN w.correct_streak+1 ELSE w.correct_streak END,
        mastered_at=CASE WHEN NOT a.is_correct THEN NULL WHEN w.correct_streak>=2 AND w.next_review_at<=now() THEN coalesce(w.mastered_at,now()) ELSE w.mastered_at END,
        next_review_at=CASE WHEN NOT a.is_correct THEN now() WHEN w.next_review_at<=now() OR w.last_reviewed_at IS NULL THEN now()+ CASE WHEN w.correct_streak=0 THEN interval '1 day' WHEN w.correct_streak=1 THEN interval '3 days' ELSE interval '7 days' END ELSE w.next_review_at END,
        last_reviewed_at=now()
      FROM attempt a WHERE w.id=${wrongId} AND w.user_id=${user.id} RETURNING w.*
    ) SELECT row_to_json(updated) AS item, attempt.is_correct AS correct FROM updated CROSS JOIN attempt`;
  if (rows[0]) return send(res, 200, rows[0]);
  const previous =
    await sql`SELECT a.is_correct AS correct,row_to_json(w) AS item FROM kousuan.review_attempts a JOIN kousuan.wrong_question_stats w ON w.id=a.wrong_question_id
    WHERE a.id=${parsed.attemptId} AND a.user_id=${user.id} AND a.wrong_question_id=${wrongId} AND a.answer_text=${parsed.answer}`;
  if (previous[0]) return send(res, 200, previous[0]);
  throw Object.assign(new Error('题目不存在或本次提交已变化，请刷新重试'), {
    statusCode: 409,
  });
}

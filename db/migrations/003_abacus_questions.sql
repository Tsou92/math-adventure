ALTER TABLE kousuan.practice_rounds
  ADD COLUMN IF NOT EXISTS abacus_move_count integer NOT NULL DEFAULT 0
  CHECK (abacus_move_count BETWEEN 0 AND 50);

ALTER TABLE kousuan.practice_rounds
  ADD COLUMN IF NOT EXISTS abacus_match_count integer NOT NULL DEFAULT 0
  CHECK (abacus_match_count = 0 OR abacus_match_count BETWEEN 2 AND 50);

ALTER TABLE kousuan.practice_rounds
  ADD COLUMN IF NOT EXISTS abacus_calculation_count integer NOT NULL DEFAULT 0
  CHECK (abacus_calculation_count BETWEEN 0 AND 50);

ALTER TABLE kousuan.practice_rounds
  DROP CONSTRAINT IF EXISTS practice_rounds_total_matches_counts;

ALTER TABLE kousuan.practice_rounds
  ADD CONSTRAINT practice_rounds_total_matches_counts CHECK (
    total_count = starter_count + explorer_count + challenger_count
      + multiply_meaning_count + multiply_facts_count + abacus_move_count
      + abacus_match_count + abacus_calculation_count
  );

ALTER TABLE kousuan.round_questions
  ADD COLUMN IF NOT EXISTS prompt_data jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE kousuan.round_questions
  DROP CONSTRAINT IF EXISTS round_questions_level_check;

ALTER TABLE kousuan.round_questions
  ADD CONSTRAINT round_questions_level_check CHECK (
    level IN (
      'starter', 'explorer', 'challenger', 'multiplyMeaning', 'multiplyFacts',
      'abacusMove', 'abacusMatch', 'abacusCalculation'
    )
  );

ALTER TABLE kousuan.practice_answers
  ADD COLUMN IF NOT EXISTS client_version integer NOT NULL DEFAULT 0
  CHECK (client_version >= 0);

ALTER TABLE kousuan.wrong_question_stats
  ADD COLUMN IF NOT EXISTS prompt_data jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE kousuan.wrong_question_stats
  ADD COLUMN IF NOT EXISTS question_key text;

UPDATE kousuan.wrong_question_stats
SET question_key = encode(
  digest(
    concat_ws(chr(31), '2', level, regexp_replace(replace(expression, '-', '−'), '[[:space:]]', '', 'g'), correct_answer::text),
    'sha256'
  ),
  'hex'
)
WHERE question_key IS NULL;

ALTER TABLE kousuan.wrong_question_stats
  ALTER COLUMN question_key SET NOT NULL;

ALTER TABLE kousuan.wrong_question_stats
  DROP CONSTRAINT IF EXISTS wrong_question_stats_user_id_expression_correct_answer_key;

ALTER TABLE kousuan.wrong_question_stats
  DROP CONSTRAINT IF EXISTS wrong_question_stats_level_check;

ALTER TABLE kousuan.wrong_question_stats
  ADD CONSTRAINT wrong_question_stats_level_check CHECK (
    level IN (
      'starter', 'explorer', 'challenger', 'multiplyMeaning', 'multiplyFacts',
      'abacusMove', 'abacusMatch', 'abacusCalculation'
    )
  );

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, question_key
      ORDER BY last_seen_at DESC, id
    ) AS duplicate_rank,
    sum(mistake_count) OVER (
      PARTITION BY user_id, question_key
    )::integer AS combined_mistake_count
  FROM kousuan.wrong_question_stats
), merged AS (
  UPDATE kousuan.wrong_question_stats AS wrong
  SET mistake_count = ranked.combined_mistake_count
  FROM ranked
  WHERE wrong.id = ranked.id AND ranked.duplicate_rank = 1
  RETURNING wrong.id
)
DELETE FROM kousuan.wrong_question_stats AS wrong
USING ranked
WHERE wrong.id = ranked.id AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS wrong_user_question_key_idx
  ON kousuan.wrong_question_stats(user_id, question_key);

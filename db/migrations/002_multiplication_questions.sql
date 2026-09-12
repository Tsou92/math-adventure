ALTER TABLE kousuan.practice_rounds
  ADD COLUMN IF NOT EXISTS multiply_meaning_count integer NOT NULL DEFAULT 0
  CHECK (multiply_meaning_count BETWEEN 0 AND 50);

ALTER TABLE kousuan.practice_rounds
  ADD COLUMN IF NOT EXISTS multiply_facts_count integer NOT NULL DEFAULT 0
  CHECK (multiply_facts_count BETWEEN 0 AND 50);

ALTER TABLE kousuan.round_questions
  DROP CONSTRAINT IF EXISTS round_questions_level_check;

ALTER TABLE kousuan.round_questions
  ADD CONSTRAINT round_questions_level_check
  CHECK (level IN (
    'starter', 'explorer', 'challenger', 'multiplyMeaning', 'multiplyFacts',
    'abacusMove', 'abacusMatch', 'abacusCalculation'
  ));

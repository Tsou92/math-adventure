ALTER TABLE kousuan.practice_rounds
  ADD COLUMN IF NOT EXISTS multiply_mixed_count integer NOT NULL DEFAULT 0
  CHECK (multiply_mixed_count BETWEEN 0 AND 50);

ALTER TABLE kousuan.practice_rounds
  DROP CONSTRAINT IF EXISTS practice_rounds_total_matches_counts;

ALTER TABLE kousuan.practice_rounds
  ADD CONSTRAINT practice_rounds_total_matches_counts CHECK (
    total_count = starter_count + explorer_count + challenger_count
      + multiply_meaning_count + multiply_facts_count + multiply_mixed_count
      + abacus_move_count + abacus_match_count + abacus_calculation_count
  );

ALTER TABLE kousuan.round_questions
  DROP CONSTRAINT IF EXISTS round_questions_level_check;

ALTER TABLE kousuan.round_questions
  ADD CONSTRAINT round_questions_level_check CHECK (
    level IN (
      'starter', 'explorer', 'challenger', 'multiplyMeaning', 'multiplyFacts',
      'multiplyMixed', 'abacusMove', 'abacusMatch', 'abacusCalculation'
    )
  );

ALTER TABLE kousuan.wrong_question_stats
  DROP CONSTRAINT IF EXISTS wrong_question_stats_level_check;

ALTER TABLE kousuan.wrong_question_stats
  ADD CONSTRAINT wrong_question_stats_level_check CHECK (
    level IN (
      'starter', 'explorer', 'challenger', 'multiplyMeaning', 'multiplyFacts',
      'multiplyMixed', 'abacusMove', 'abacusMatch', 'abacusCalculation'
    )
  );

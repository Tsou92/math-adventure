ALTER TABLE kousuan.practice_rounds
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'challenge'
  CHECK (mode IN ('practice', 'challenge'));

ALTER TABLE kousuan.wrong_question_stats
  ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_review_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS mastered_at timestamptz;

CREATE TABLE IF NOT EXISTS kousuan.review_attempts (
  id uuid PRIMARY KEY,
  wrong_question_id uuid NOT NULL REFERENCES kousuan.wrong_question_stats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES kousuan.users(id) ON DELETE CASCADE,
  answer_text text NOT NULL,
  is_correct boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_user_created_idx ON kousuan.review_attempts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kousuan.learning_preferences (
  user_id uuid PRIMARY KEY REFERENCES kousuan.users(id) ON DELETE CASCADE,
  settings jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kousuan.recovery_codes (
  user_id uuid PRIMARY KEY REFERENCES kousuan.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

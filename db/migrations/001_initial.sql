CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS kousuan;

CREATE TABLE IF NOT EXISTS kousuan.families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kousuan.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid REFERENCES kousuan.families(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('site_owner', 'parent', 'child')),
  is_active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_family_idx ON kousuan.users(family_id);

CREATE TABLE IF NOT EXISTS kousuan.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES kousuan.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON kousuan.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON kousuan.sessions(expires_at);

CREATE TABLE IF NOT EXISTS kousuan.login_attempts (
  bucket text PRIMARY KEY,
  attempt_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz
);

CREATE TABLE IF NOT EXISTS kousuan.practice_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES kousuan.users(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES kousuan.families(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('preset', 'custom', 'repeat')),
  preset_key text,
  preset_version integer,
  package_name text NOT NULL,
  starter_count integer NOT NULL CHECK (starter_count BETWEEN 0 AND 50),
  explorer_count integer NOT NULL CHECK (explorer_count BETWEEN 0 AND 50),
  challenger_count integer NOT NULL CHECK (challenger_count BETWEEN 0 AND 50),
  total_count integer NOT NULL CHECK (total_count BETWEEN 1 AND 100),
  seed integer NOT NULL,
  status text NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'started', 'completed', 'abandoned')),
  score integer CHECK (score BETWEEN 0 AND 100),
  correct_count integer,
  started_at timestamptz,
  completed_at timestamptz,
  abandoned_at timestamptz,
  duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_round_per_user
  ON kousuan.practice_rounds(user_id)
  WHERE status IN ('generated', 'started');
CREATE INDEX IF NOT EXISTS rounds_user_created_idx ON kousuan.practice_rounds(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rounds_family_idx ON kousuan.practice_rounds(family_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kousuan.round_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES kousuan.practice_rounds(id) ON DELETE CASCADE,
  position integer NOT NULL,
  level text NOT NULL CHECK (level IN ('starter', 'explorer', 'challenger')),
  expression text NOT NULL,
  correct_answer integer NOT NULL,
  UNIQUE(round_id, position)
);

CREATE TABLE IF NOT EXISTS kousuan.practice_answers (
  question_id uuid PRIMARY KEY REFERENCES kousuan.round_questions(id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES kousuan.practice_rounds(id) ON DELETE CASCADE,
  answer_text text NOT NULL,
  is_correct boolean,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS answers_round_idx ON kousuan.practice_answers(round_id);

CREATE TABLE IF NOT EXISTS kousuan.wrong_question_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES kousuan.users(id) ON DELETE CASCADE,
  expression text NOT NULL,
  correct_answer integer NOT NULL,
  level text NOT NULL,
  mistake_count integer NOT NULL DEFAULT 1,
  last_answer text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, expression, correct_answer)
);
CREATE INDEX IF NOT EXISTS wrong_user_seen_idx ON kousuan.wrong_question_stats(user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS kousuan.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid REFERENCES kousuan.families(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES kousuan.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_user_id uuid REFERENCES kousuan.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_family_idx ON kousuan.audit_events(family_id, created_at DESC);

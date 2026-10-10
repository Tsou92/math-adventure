-- 创建迁移追踪表并标记所有已存在的迁移为已执行
-- 此迁移应该在所有现有迁移之前运行（按文件名排序）

-- 全新数据库还没有 kousuan schema（001 才创建），先建好再建追踪表
CREATE SCHEMA IF NOT EXISTS kousuan;

CREATE TABLE IF NOT EXISTS kousuan.schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 标记所有已存在的迁移文件为已执行（针对现有数据库）
-- 新数据库会按正常顺序执行所有迁移
INSERT INTO kousuan.schema_migrations (filename, applied_at)
VALUES
  ('001_initial.sql', now()),
  ('002_multiplication_questions.sql', now()),
  ('003_abacus_questions.sql', now()),
  ('004_learning_experience.sql', now()),
  ('005_multiply_mixed.sql', now())
ON CONFLICT (filename) DO NOTHING;

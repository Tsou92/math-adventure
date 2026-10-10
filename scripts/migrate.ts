import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const sql = neon(databaseUrl);
const migrationsUrl = new URL('../db/migrations/', import.meta.url);
const requested = process.argv.slice(2);

// 确保迁移追踪表存在（全新数据库要先建 schema）
await sql`CREATE SCHEMA IF NOT EXISTS kousuan`;
await sql`
  CREATE TABLE IF NOT EXISTS kousuan.schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

const available = (await readdir(fileURLToPath(migrationsUrl)))
  .filter((file) => file.endsWith('.sql'))
  .sort();

if (requested.some((file) => !available.includes(file)))
  throw new Error('Unknown migration filename');

// 获取已执行的迁移
const executed =
  await sql`SELECT filename FROM kousuan.schema_migrations ORDER BY filename`;
const executedSet = new Set(executed.map((row) => String(row.filename)));

// 确定需要执行的迁移：如果指定了文件名，执行指定的；否则执行未执行过的
const migrationFiles = requested.length
  ? available.filter((file) => requested.includes(file))
  : available.filter((file) => !executedSet.has(file));

if (migrationFiles.length === 0) {
  console.log('No migrations to apply.');
  process.exit(0);
}

for (const file of migrationFiles) {
  // 跳过已执行的迁移（除非用户明确指定要重新执行）
  if (!requested.length && executedSet.has(file)) {
    console.log(`Skipped ${file} (already applied)`);
    continue;
  }

  const migration = await readFile(
    fileURLToPath(new URL(file, migrationsUrl)),
    'utf8',
  );
  const statements = migration
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  // 在同一事务内执行迁移并记录
  await sql.transaction([
    ...statements.map((statement) => sql.query(statement)),
    sql`INSERT INTO kousuan.schema_migrations (filename) VALUES (${file})
        ON CONFLICT (filename) DO UPDATE SET applied_at = now()`,
  ]);

  console.log(`Applied ${file}`);
}

console.log('Database migrations completed.');

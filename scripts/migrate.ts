import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const sql = neon(databaseUrl);
const migrationsUrl = new URL('../db/migrations/', import.meta.url);
const migrationFiles = (await readdir(fileURLToPath(migrationsUrl)))
  .filter((file) => file.endsWith('.sql'))
  .sort();

for (const file of migrationFiles) {
  const migration = await readFile(
    fileURLToPath(new URL(file, migrationsUrl)),
    'utf8',
  );
  const statements = migration
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await sql.query(statement);
  console.log(`Applied ${file}`);
}

console.log('Database migrations completed.');

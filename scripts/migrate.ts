import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const sql = neon(databaseUrl);
const migrationsUrl = new URL('../db/migrations/', import.meta.url);
const requested = process.argv.slice(2);
const available = (await readdir(fileURLToPath(migrationsUrl)))
  .filter((file) => file.endsWith('.sql'))
  .sort();

if (requested.some((file) => !available.includes(file)))
  throw new Error('Unknown migration filename');
const migrationFiles = requested.length
  ? available.filter((file) => requested.includes(file))
  : available;

for (const file of migrationFiles) {
  const migration = await readFile(
    fileURLToPath(new URL(file, migrationsUrl)),
    'utf8',
  );
  const statements = migration
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  await sql.transaction(statements.map((statement) => sql.query(statement)));
  console.log(`Applied ${file}`);
}

console.log('Database migrations completed.');

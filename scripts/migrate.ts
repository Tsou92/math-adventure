import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const sql = neon(databaseUrl);
const migrationUrl = new URL('../db/migrations/001_initial.sql', import.meta.url);
const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');
const statements = migration
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);
for (const statement of statements) await sql.query(statement);
console.log('Database migration completed.');

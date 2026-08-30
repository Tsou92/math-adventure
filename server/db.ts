import { neon } from '@neondatabase/serverless';

let client: ReturnType<typeof neon> | undefined;

export function db() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not configured');
  client ??= neon(databaseUrl);
  return client;
}


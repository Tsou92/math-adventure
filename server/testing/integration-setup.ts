import { readdir, readFile } from 'node:fs/promises';
import { pool } from './postgres';

export default async function setup() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(8675309)');
    const directory = new URL('../../db/migrations/', import.meta.url);
    for (const file of (await readdir(directory))
      .filter((file) => file.endsWith('.sql'))
      .sort()) {
      await client.query(await readFile(new URL(file, directory), 'utf8'));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

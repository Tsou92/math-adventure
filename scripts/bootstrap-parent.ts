import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const sql = neon(databaseUrl);
const username = process.env.BOOTSTRAP_PARENT_USERNAME ?? 'parent';
const displayName = process.env.BOOTSTRAP_PARENT_NAME ?? '家长';
const password = process.env.BOOTSTRAP_PARENT_PASSWORD ?? `Ks!${randomBytes(9).toString('base64url')}`;
const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });

const families = await sql`INSERT INTO kousuan.families (name)
  SELECT '我的家庭' WHERE NOT EXISTS (SELECT 1 FROM kousuan.users WHERE role IN ('parent', 'site_owner'))
  RETURNING id`;
if (!families[0]) {
  console.log('A parent account already exists; no changes made.');
} else {
  await sql`INSERT INTO kousuan.users (family_id, username, display_name, password_hash, role, must_change_password)
    VALUES (${families[0].id}, ${username}, ${displayName}, ${passwordHash}, 'parent', true)`;
  console.log(JSON.stringify({ created: true, username, temporaryPassword: password }));
}


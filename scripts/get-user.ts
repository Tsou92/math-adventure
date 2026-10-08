import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);
const users = await sql`SELECT id, username FROM kousuan.users LIMIT 1`;
console.log(users[0]?.id || 'no-users');

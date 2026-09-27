import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from './testing/postgres';

vi.mock('./db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db')>()),
  ...(await import('./testing/postgres')),
}));
import { fetchChildrenSummary } from './router';

const familyId = randomUUID();
const childId = randomUUID();
beforeAll(async () => {
  await pool.query('INSERT INTO kousuan.families(id,name) VALUES($1,$2)', [
    familyId,
    'summary-test',
  ]);
  await pool.query(
    "INSERT INTO kousuan.users(id,family_id,username,display_name,password_hash,role) VALUES($1,$2,$3,'测试孩子','not-a-login-hash','child')",
    [childId, familyId, childId],
  );
  for (const [status, score] of [
    ['completed', 80],
    ['completed', 100],
    ['generated', 0],
  ]) {
    await pool.query(
      "INSERT INTO kousuan.practice_rounds(user_id,family_id,idempotency_key,source,package_name,starter_count,explorer_count,challenger_count,total_count,seed,status,score) VALUES($1,$2,$3,'custom','test',1,0,0,1,1,$4,$5)",
      [childId, familyId, randomUUID(), status, score],
    );
  }
});
afterAll(async () => {
  await pool.query('DELETE FROM kousuan.families WHERE id=$1', [familyId]);
  await pool.end();
});

describe('parent child summary query', () => {
  it('counts and averages completed rounds only, within the requested family', async () => {
    expect(await fetchChildrenSummary(familyId)).toEqual([
      expect.objectContaining({
        id: childId,
        round_count: 2,
        average_score: 90,
      }),
    ]);
    expect(await fetchChildrenSummary(randomUUID())).toEqual([]);
  });
});

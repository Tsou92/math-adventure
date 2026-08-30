import { describe, expect, it } from 'vitest';
import { loadEnvFile } from 'node:process';
import { db } from './db.js';
import { fetchChildrenSummary } from './router.js';

try {
  loadEnvFile('.env.local');
} catch {
  // CI environments inject DATABASE_URL directly and may not have a local env file.
}

describe('parent child summary query', () => {
  it.skipIf(!process.env.DATABASE_URL)('在 PostgreSQL 中执行平均分筛选统计', async () => {
    const parents = await db()`SELECT family_id FROM kousuan.users WHERE role = 'parent' LIMIT 1` as Array<{ family_id: string }>;
    expect(parents[0]?.family_id).toBeTruthy();

    const children = await fetchChildrenSummary(parents[0].family_id) as Array<{ average_score: number; round_count: number }>;
    expect(Array.isArray(children)).toBe(true);
    for (const child of children) {
      expect(Number(child.average_score)).toBeGreaterThanOrEqual(0);
      expect(Number(child.round_count)).toBeGreaterThanOrEqual(0);
    }
  }, 20_000);
});

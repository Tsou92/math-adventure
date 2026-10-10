/**
 * 诊断工具：测量 createRound 各个步骤的实际耗时
 */
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';

const sql = neon(process.env.DATABASE_URL!);

async function diagnoseLatency() {
  const userId = process.argv[2];
  if (!userId) {
    console.error('用法: npx tsx scripts/diagnose-latency.ts <userId>');
    process.exit(1);
  }

  console.log('🔍 开始诊断数据库延迟...\n');

  // 测试 1：简单查询
  const t1 = Date.now();
  await sql`SELECT 1 as ping`;
  const pingLatency = Date.now() - t1;
  console.log(`✓ Ping 延迟: ${pingLatency}ms`);

  // 测试 2：锁定用户查询
  const t2 = Date.now();
  await sql`SELECT id, family_id FROM kousuan.users WHERE id = ${userId} FOR UPDATE`;
  const lockLatency = Date.now() - t2;
  console.log(`✓ 锁定用户查询: ${lockLatency}ms`);

  // 测试 3：合并查询（新优化）
  const testKey = randomUUID();
  const t3 = Date.now();
  await sql`
    WITH user_lock AS (
      SELECT id, family_id FROM kousuan.users WHERE id = ${userId} FOR UPDATE
    ),
    existing AS (
      SELECT id FROM kousuan.practice_rounds
      WHERE user_id = ${userId} AND idempotency_key = ${testKey} LIMIT 1
    ),
    active AS (
      SELECT id FROM kousuan.practice_rounds
      WHERE user_id = ${userId} AND status IN ('generated', 'started') LIMIT 1
    )
    SELECT
      user_lock.id as user_id,
      user_lock.family_id,
      existing.id as existing_round_id,
      active.id as active_round_id
    FROM user_lock
    LEFT JOIN existing ON true
    LEFT JOIN active ON true
  `;
  const mergedLatency = Date.now() - t3;
  console.log(`✓ 合并查询（新优化）: ${mergedLatency}ms`);

  // 测试 4：三次独立查询（旧方式）
  const testKey2 = randomUUID();
  const t4 = Date.now();
  await sql`SELECT id, family_id FROM kousuan.users WHERE id = ${userId} FOR UPDATE`;
  await sql`SELECT id FROM kousuan.practice_rounds WHERE user_id = ${userId} AND idempotency_key = ${testKey2} LIMIT 1`;
  await sql`SELECT id FROM kousuan.practice_rounds WHERE user_id = ${userId} AND status IN ('generated', 'started') LIMIT 1`;
  const oldLatency = Date.now() - t4;
  console.log(`✓ 三次独立查询（旧方式）: ${oldLatency}ms`);

  console.log(`\n📊 性能对比:`);
  console.log(`   合并查询: ${mergedLatency}ms`);
  console.log(`   三次查询: ${oldLatency}ms`);
  console.log(`   节省: ${oldLatency - mergedLatency}ms (${Math.round((1 - mergedLatency / oldLatency) * 100)}%)`);

  console.log(`\n💡 分析:`);
  if (pingLatency > 200) {
    console.log(`   ⚠️  Ping 延迟 ${pingLatency}ms 很高，数据库位于 us-east-1（美国），你的网络到美国延迟较大`);
  }
  if (mergedLatency > 500) {
    console.log(`   ⚠️  即使合并查询，单次往返仍需 ${mergedLatency}ms，主要瓶颈是网络延迟`);
  }
  if (oldLatency - mergedLatency < 200) {
    console.log(`   ℹ️  优化节省的时间较少（${oldLatency - mergedLatency}ms），因为查询本身很快，瓶颈在网络往返`);
  }
}

diagnoseLatency().catch(console.error);

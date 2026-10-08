import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const sql = neon(databaseUrl);

console.log('Cleaning old word problem rounds without promptData...');

// 查找包含应用题但没有 promptData 的练习回合
const rounds = await sql`
  SELECT DISTINCT r.id, r.package_name, r.created_at
  FROM kousuan.practice_rounds r
  JOIN kousuan.round_questions q ON q.round_id = r.id
  WHERE q.level = 'mixedWordProblem'
    AND (q.prompt_data IS NULL OR q.prompt_data::text = '{}')
  ORDER BY r.created_at DESC
`;

console.log(`Found ${rounds.length} rounds with old word problems`);

if (rounds.length === 0) {
  console.log('No old rounds to clean. All done!');
  process.exit(0);
}

// 显示要删除的回合
for (const round of rounds) {
  console.log(`  - ${round.id} (${round.package_name}, ${new Date(round.created_at).toLocaleString('zh-CN')})`);
}

// 删除这些旧回合
const roundIds = rounds.map(r => r.id);
await sql`DELETE FROM kousuan.practice_rounds WHERE id = ANY(${roundIds})`;

console.log(`\nDeleted ${rounds.length} old rounds.`);
console.log('Next time you start a new practice with word problems, it will use the new guided format!');

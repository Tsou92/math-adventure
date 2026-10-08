import { performance } from 'node:perf_hooks';
import { makeQuestionsForCounts } from '../lib/questions.js';

const counts = {
  divisionFacts: 10,
  mixedWordProblem: 5,
  starter: 0,
  explorer: 0,
  challenger: 0,
  multiplyMeaning: 0,
  multiplyFacts: 0,
  multiplyMixed: 0,
  divisionMeaning: 0,
  abacusMove: 0,
  abacusMatch: 0,
  abacusCalculation: 0
};

console.log('开始生成 15 道题目（10 道表内除法 + 5 道应用题）...\n');

const start = performance.now();
const questions = makeQuestionsForCounts(12345, counts, { challengerChain: false });
const end = performance.now();

const totalTime = end - start;
const avgTime = totalTime / questions.length;

console.log(`✓ 生成了 ${questions.length} 道题目`);
console.log(`✓ 总耗时: ${totalTime.toFixed(2)}ms`);
console.log(`✓ 平均每题: ${avgTime.toFixed(2)}ms`);
console.log();

// 分析应用题的数据大小
const wordProblems = questions.filter(q => q.level === 'mixedWordProblem');
if (wordProblems.length > 0) {
  const sampleSize = JSON.stringify(wordProblems[0].promptData).length;
  console.log(`应用题样本:`);
  console.log(`  - promptData 大小: ${sampleSize} 字符`);
  console.log(`  - promptData 样例:\n${JSON.stringify(wordProblems[0].promptData, null, 2).slice(0, 300)}...`);
}

if (totalTime > 500) {
  console.log('\n⚠️  题目生成超过 500ms，可能是性能瓶颈！');
} else {
  console.log('\n✓ 题目生成性能正常（< 500ms）');
}

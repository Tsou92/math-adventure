import { describe, expect, it } from 'vitest';
import { makeQuestionsForCounts } from './questions';

describe('makeQuestionsForCounts', () => {
  it('按自选数量生成且答案保持在题型范围内', () => {
    const questions = makeQuestionsForCounts(12345, { starter: 7, explorer: 11, challenger: 13 });
    expect(questions).toHaveLength(31);
    expect(questions.filter((question) => question.level === 'starter')).toHaveLength(7);
    expect(questions.filter((question) => question.level === 'explorer')).toHaveLength(11);
    expect(questions.filter((question) => question.level === 'challenger')).toHaveLength(13);
    for (const question of questions) {
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThanOrEqual(question.level === 'starter' ? 10 : question.level === 'explorer' ? 20 : 100);
    }
  });

  it('能稳定生成每类最多 50 题且同类不重复', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const questions = makeQuestionsForCounts(seed, { starter: 50, explorer: 50, challenger: 0 });
      expect(questions).toHaveLength(100);
      expect(new Set(questions.map((question) => `${question.level}:${question.expression}`)).size).toBe(100);
    }
  });
});


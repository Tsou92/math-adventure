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

  it('每类基础题最多只有一道答案为 0，且总体占比保持较低', () => {
    let zeroAnswers = 0;
    let total = 0;
    for (let seed = 1; seed <= 1_000; seed += 1) {
      const questions = makeQuestionsForCounts(seed, { starter: 10, explorer: 10, challenger: 0 });
      for (const level of ['starter', 'explorer'] as const) {
        const levelQuestions = questions.filter((question) => question.level === level);
        expect(levelQuestions.filter((question) => question.answer === 0)).toHaveLength(
          levelQuestions.some((question) => question.answer === 0) ? 1 : 0,
        );
      }
      zeroAnswers += questions.filter((question) => question.answer === 0).length;
      total += questions.length;
    }
    expect(zeroAnswers / total).toBeLessThan(0.03);
  });

  it('每轮基础题最多只有两道含 0 运算数的题，且总体占比保持较低', () => {
    let zeroOperands = 0;
    let total = 0;
    for (let seed = 1; seed <= 1_000; seed += 1) {
      const questions = makeQuestionsForCounts(seed, { starter: 10, explorer: 10, challenger: 0 });
      const count = questions.filter((question) => question.expression.split(' ').includes('0')).length;
      expect(count).toBeLessThanOrEqual(2);
      zeroOperands += count;
      total += questions.length;
    }
    expect(zeroOperands / total).toBeLessThan(0.04);
  });

  it('默认生成 100 以内单步进退位加减法', () => {
    const questions = makeQuestionsForCounts(24680, { starter: 0, explorer: 0, challenger: 50 });
    expect(questions).toHaveLength(50);
    for (const question of questions) {
      const operators = question.expression.match(/[+−]/g) ?? [];
      expect(operators).toHaveLength(1);
      const [left, right] = question.expression.split(/ [+−] /).map(Number);
      if (operators[0] === '+') expect((left % 10) + (right % 10)).toBeGreaterThanOrEqual(10);
      else expect(left % 10).toBeLessThan(right % 10);
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThanOrEqual(100);
    }
  });

  it('勾选后生成 100 以内连加连减题', () => {
    const questions = makeQuestionsForCounts(
      13579,
      { starter: 0, explorer: 0, challenger: 50 },
      { challengerChain: true },
    );
    expect(questions).toHaveLength(50);
    for (const question of questions) {
      expect(question.expression.match(/[+−]/g)).toHaveLength(2);
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThanOrEqual(100);
    }
  });
});

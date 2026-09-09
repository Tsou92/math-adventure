import { describe, expect, it } from 'vitest';
import { makeQuestionsForCounts, normalizeQuestionCount } from './questions';

describe('makeQuestionsForCounts', () => {
  it('题量输入清空后可直接输入正常数字，不保留前导 0', () => {
    expect(normalizeQuestionCount('')).toBe(0);
    expect(normalizeQuestionCount('10')).toBe(10);
    expect(normalizeQuestionCount('020')).toBe(20);
    expect(normalizeQuestionCount(-5)).toBe(0);
    expect(normalizeQuestionCount(80)).toBe(50);
  });

  it('按自选数量生成且答案保持在题型范围内', () => {
    const questions = makeQuestionsForCounts(12345, {
      starter: 7,
      explorer: 11,
      challenger: 13,
      multiplyMeaning: 9,
      multiplyFacts: 8,
    });
    expect(questions).toHaveLength(48);
    expect(
      questions.filter((question) => question.level === 'starter'),
    ).toHaveLength(7);
    expect(
      questions.filter((question) => question.level === 'explorer'),
    ).toHaveLength(11);
    expect(
      questions.filter((question) => question.level === 'challenger'),
    ).toHaveLength(13);
    expect(
      questions.filter((question) => question.level === 'multiplyMeaning'),
    ).toHaveLength(9);
    expect(
      questions.filter((question) => question.level === 'multiplyFacts'),
    ).toHaveLength(8);
    for (const question of questions) {
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThanOrEqual(
        question.level === 'starter'
          ? 10
          : question.level === 'explorer'
            ? 20
            : 100,
      );
    }
  });

  it('能稳定生成每类最多 50 题且同类不重复', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const questions = makeQuestionsForCounts(seed, {
        starter: 50,
        explorer: 50,
        challenger: 0,
        multiplyMeaning: 0,
        multiplyFacts: 0,
      });
      expect(questions).toHaveLength(100);
      expect(
        new Set(
          questions.map(
            (question) => `${question.level}:${question.expression}`,
          ),
        ).size,
      ).toBe(100);
    }
  });

  it('每类基础题最多只有一道答案为 0，且总体占比保持较低', () => {
    let zeroAnswers = 0;
    let total = 0;
    for (let seed = 1; seed <= 1_000; seed += 1) {
      const questions = makeQuestionsForCounts(seed, {
        starter: 10,
        explorer: 10,
        challenger: 0,
        multiplyMeaning: 0,
        multiplyFacts: 0,
      });
      for (const level of ['starter', 'explorer'] as const) {
        const levelQuestions = questions.filter(
          (question) => question.level === level,
        );
        expect(
          levelQuestions.filter((question) => question.answer === 0),
        ).toHaveLength(
          levelQuestions.some((question) => question.answer === 0) ? 1 : 0,
        );
      }
      zeroAnswers += questions.filter(
        (question) => question.answer === 0,
      ).length;
      total += questions.length;
    }
    expect(zeroAnswers / total).toBeLessThan(0.03);
  });

  it('每轮基础题最多只有两道含 0 运算数的题，且总体占比保持较低', () => {
    let zeroOperands = 0;
    let total = 0;
    for (let seed = 1; seed <= 1_000; seed += 1) {
      const questions = makeQuestionsForCounts(seed, {
        starter: 10,
        explorer: 10,
        challenger: 0,
        multiplyMeaning: 0,
        multiplyFacts: 0,
      });
      const count = questions.filter((question) =>
        question.expression.split(' ').includes('0'),
      ).length;
      expect(count).toBeLessThanOrEqual(2);
      zeroOperands += count;
      total += questions.length;
    }
    expect(zeroOperands / total).toBeLessThan(0.04);
  });

  it('默认生成 100 以内单步进退位加减法', () => {
    const questions = makeQuestionsForCounts(24680, {
      starter: 0,
      explorer: 0,
      challenger: 50,
      multiplyMeaning: 0,
      multiplyFacts: 0,
    });
    expect(questions).toHaveLength(50);
    for (const question of questions) {
      const operators = question.expression.match(/[+−]/g) ?? [];
      expect(operators).toHaveLength(1);
      const [left, right] = question.expression.split(/ [+−] /).map(Number);
      if (operators[0] === '+')
        expect((left % 10) + (right % 10)).toBeGreaterThanOrEqual(10);
      else expect(left % 10).toBeLessThan(right % 10);
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThanOrEqual(100);
    }
  });

  it('勾选后生成 100 以内连加连减题', () => {
    const questions = makeQuestionsForCounts(
      13579,
      {
        starter: 0,
        explorer: 0,
        challenger: 50,
        multiplyMeaning: 0,
        multiplyFacts: 0,
      },
      { challengerChain: true },
    );
    expect(questions).toHaveLength(50);
    for (const question of questions) {
      expect(question.expression.match(/[+−]/g)).toHaveLength(2);
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThanOrEqual(100);
    }
  });

  it('乘法启蒙题覆盖同数连加、几个几、交换乘数和乘数名称', () => {
    const questions = makeQuestionsForCounts(97531, {
      starter: 0,
      explorer: 0,
      challenger: 0,
      multiplyMeaning: 50,
      multiplyFacts: 0,
    });
    expect(questions).toHaveLength(50);
    expect(new Set(questions.map((question) => question.expression)).size).toBe(
      50,
    );
    expect(
      questions.some((question) => question.expression.includes('可以写成')),
    ).toBe(true);
    expect(
      questions.some((question) => question.expression.includes('相加')),
    ).toBe(true);
    expect(
      questions.some((question) =>
        question.expression.includes('交换两个乘数'),
      ),
    ).toBe(true);
    expect(
      questions.some((question) => question.expression.includes('另一个乘数')),
    ).toBe(true);
    for (const question of questions.filter((item) =>
      item.expression.includes('可以看成'),
    )) {
      const match = question.expression.match(
        /(\d+) × (\d+) 可以看成 □ 个 (\d+) 相加/,
      );
      expect(match).not.toBeNull();
      expect(Number(match?.[1])).toBe(Number(match?.[3]));
      expect(question.answer).toBe(Number(match?.[2]));
    }
    for (const question of questions) {
      expect(question.level).toBe('multiplyMeaning');
      expect(question.expression).toContain('□');
      expect(question.expression).not.toContain('几');
      expect(question.answer).toBeGreaterThanOrEqual(2);
      expect(question.answer).toBeLessThanOrEqual(81);
    }
  });

  it('表内乘法题只生成 2 至 9 的乘法且答案正确', () => {
    const questions = makeQuestionsForCounts(86420, {
      starter: 0,
      explorer: 0,
      challenger: 0,
      multiplyMeaning: 0,
      multiplyFacts: 50,
    });
    expect(questions).toHaveLength(50);
    expect(new Set(questions.map((question) => question.expression)).size).toBe(
      50,
    );
    for (const question of questions) {
      const [left, right] = question.expression.split(' × ').map(Number);
      expect(left).toBeGreaterThanOrEqual(2);
      expect(left).toBeLessThanOrEqual(9);
      expect(right).toBeGreaterThanOrEqual(2);
      expect(right).toBeLessThanOrEqual(9);
      expect(question.answer).toBe(left * right);
    }
  });
});

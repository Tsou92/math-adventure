import { describe, expect, it } from 'vitest';
import {
  makeQuestionsForCounts,
  normalizeQuestionCount,
} from './questions';
import { asWordProblemV2Prompt } from './word-problems';
import { emptyCounts } from './learning';

describe('makeQuestionsForCounts', () => {
  it('乘法后加减每题都进退位、加减均衡且最多50题不重复', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const counts = { ...emptyCounts, multiplyMixed: 50 };
      const questions = makeQuestionsForCounts(seed, counts);
      expect(questions).toEqual(makeQuestionsForCounts(seed, counts));
      expect(questions).toHaveLength(50);
      expect(new Set(questions.map((q) => q.expression)).size).toBe(50);
      expect(questions.filter((q) => q.expression.includes('+'))).toHaveLength(
        25,
      );
      for (const question of questions) {
        const parts = question.expression.match(
          /^(\d+) × (\d+) ([+−]) (\d+)$/,
        )!;
        expect(parts).not.toBeNull();
        const a = Number(parts[1]),
          b = Number(parts[2]),
          c = Number(parts[4]);
        expect(question.level).toBe('multiplyMixed');
        expect(a).toBeGreaterThanOrEqual(2);
        expect(a).toBeLessThanOrEqual(9);
        expect(b).toBeGreaterThanOrEqual(2);
        expect(b).toBeLessThanOrEqual(9);
        expect(c).toBeGreaterThanOrEqual(10);
        expect(c).toBeLessThanOrEqual(99);
        const product = a * b;
        if (parts[3] === '+') {
          expect((product % 10) + (c % 10)).toBeGreaterThanOrEqual(10);
          expect(question.answer).toBe(product + c);
        } else {
          expect(product % 10).toBeLessThan(c % 10);
          expect(question.answer).toBe(product - c);
        }
        expect(question.answer).toBeGreaterThan(0);
        expect(question.answer).toBeLessThanOrEqual(100);
      }
    }
  });

  it('新题型支持零题、奇数题量和与其他题型混选', () => {
    for (const count of [0, 1, 2, 49]) {
      const questions = makeQuestionsForCounts(20260916, {
        ...emptyCounts,
        starter: 2,
        multiplyMixed: count,
      });
      expect(questions).toHaveLength(count + 2);
      expect(questions.filter((q) => q.level === 'multiplyMixed')).toHaveLength(
        count,
      );
    }
  });

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
      multiplyMixed: 0,
      divisionMeaning: 0,
      divisionFacts: 0,
      mixedWordProblem: 0,
      abacusMove: 0,
      abacusMatch: 0,
      abacusCalculation: 0,
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
        multiplyMixed: 0,
        divisionMeaning: 0,
        divisionFacts: 0,
        mixedWordProblem: 0,
        abacusMove: 0,
        abacusMatch: 0,
        abacusCalculation: 0,
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
        multiplyMixed: 0,
        divisionMeaning: 0,
        divisionFacts: 0,
        mixedWordProblem: 0,
        abacusMove: 0,
        abacusMatch: 0,
        abacusCalculation: 0,
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
        multiplyMixed: 0,
        divisionMeaning: 0,
        divisionFacts: 0,
        mixedWordProblem: 0,
        abacusMove: 0,
        abacusMatch: 0,
        abacusCalculation: 0,
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
      multiplyMixed: 0,
      divisionMeaning: 0,
      divisionFacts: 0,
      mixedWordProblem: 0,
      abacusMove: 0,
      abacusMatch: 0,
      abacusCalculation: 0,
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
        multiplyMixed: 0,
        divisionMeaning: 0,
        divisionFacts: 0,
        mixedWordProblem: 0,
        abacusMove: 0,
        abacusMatch: 0,
        abacusCalculation: 0,
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
      multiplyMixed: 0,
      divisionMeaning: 0,
      divisionFacts: 0,
      mixedWordProblem: 0,
      abacusMove: 0,
      abacusMatch: 0,
      abacusCalculation: 0,
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
      multiplyMixed: 0,
      divisionMeaning: 0,
      divisionFacts: 0,
      mixedWordProblem: 0,
      abacusMove: 0,
      abacusMatch: 0,
      abacusCalculation: 0,
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

  it('空拨画珠按跨5、跨十和普通变化生成', () => {
    const questions = makeQuestionsForCounts(20260911, {
      starter: 0,
      explorer: 0,
      challenger: 0,
      multiplyMeaning: 0,
      multiplyFacts: 0,
      multiplyMixed: 0,
      divisionMeaning: 0,
      divisionFacts: 0,
      mixedWordProblem: 0,
      abacusMove: 50,
      abacusMatch: 0,
      abacusCalculation: 0,
    });
    expect(questions).toHaveLength(50);
    const kinds = { crossFive: 0, crossTen: 0, regular: 0 };
    for (const question of questions) {
      expect(question.level).toBe('abacusMove');
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThanOrEqual(99);
      const prompt = question.promptData;
      expect(prompt).toMatchObject({ version: 1 });
      if (!prompt || !('startValue' in prompt) || !('operand' in prompt))
        throw new Error('invalid abacus move prompt');
      const expected =
        prompt.operator === '+'
          ? prompt.startValue + prompt.operand
          : prompt.startValue - prompt.operand;
      expect(question.answer).toBe(expected);
      const startDigit = prompt.startValue % 10;
      const answerDigit = question.answer % 10;
      if (
        (question.answer > prompt.startValue && answerDigit < startDigit) ||
        (question.answer < prompt.startValue && answerDigit > startDigit)
      )
        kinds.crossTen += 1;
      else if (
        (startDigit < 5 && answerDigit >= 5) ||
        (startDigit >= 5 && answerDigit < 5)
      )
        kinds.crossFive += 1;
      else kinds.regular += 1;
    }
    expect(kinds).toEqual({ crossFive: 20, crossTen: 20, regular: 10 });
  });

  it('空拨连线每组有2至4道且答案互不重复', () => {
    for (const count of [2, 3, 4, 5, 9, 50]) {
      const questions = makeQuestionsForCounts(4000 + count, {
        starter: 0,
        explorer: 0,
        challenger: 0,
        multiplyMeaning: 0,
        multiplyFacts: 0,
        multiplyMixed: 0,
        divisionMeaning: 0,
        divisionFacts: 0,
        mixedWordProblem: 0,
        abacusMove: 0,
        abacusMatch: count,
        abacusCalculation: 0,
      });
      expect(questions).toHaveLength(count);
      const groups = Object.groupBy(questions, (question) => {
        const prompt = question.promptData;
        if (!prompt || !('groupId' in prompt)) throw new Error('invalid group');
        return prompt.groupId;
      });
      for (const group of Object.values(groups)) {
        expect(group).toBeDefined();
        expect(group!.length).toBeGreaterThanOrEqual(2);
        expect(group!.length).toBeLessThanOrEqual(4);
        expect(new Set(group!.map((question) => question.answer)).size).toBe(
          group!.length,
        );
        const first = group![0].promptData;
        if (!first || !('optionValues' in first))
          throw new Error('invalid options');
        expect(new Set(first.optionValues)).toEqual(
          new Set(group!.map((question) => question.answer)),
        );
      }
    }
  });

  it('空拨连线不允许只生成 1 道', () => {
    expect(() =>
      makeQuestionsForCounts(4001, {
        starter: 0,
        explorer: 0,
        challenger: 0,
        multiplyMeaning: 0,
        multiplyFacts: 0,
        multiplyMixed: 0,
        divisionMeaning: 0,
        divisionFacts: 0,
        mixedWordProblem: 0,
        abacusMove: 0,
        abacusMatch: 1,
        abacusCalculation: 0,
      }),
    ).toThrow('空拨连线至少需要 2 道题');
  });

  it('实拨计算固定三项且每一步都在0至99', () => {
    const questions = makeQuestionsForCounts(8888, {
      starter: 0,
      explorer: 0,
      challenger: 0,
      multiplyMeaning: 0,
      multiplyFacts: 0,
      multiplyMixed: 0,
      divisionMeaning: 0,
      divisionFacts: 0,
      mixedWordProblem: 0,
      abacusMove: 0,
      abacusMatch: 0,
      abacusCalculation: 50,
    });
    expect(questions).toHaveLength(50);
    for (const question of questions) {
      const prompt = question.promptData;
      if (!prompt || !('operations' in prompt))
        throw new Error('invalid calculation prompt');
      expect(prompt.operations).toHaveLength(2);
      let value = prompt.startValue;
      for (const operation of prompt.operations) {
        expect(operation.value).toBeGreaterThan(0);
        value =
          operation.operator === '+'
            ? value + operation.value
            : value - operation.value;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(99);
      }
      expect(question.answer).toBe(value);
    }
  });

  it('除法题只出表内除法：除数和商都在 2～9，且能整除', () => {
    const inTable = (n: number) => Number.isInteger(n) && n >= 2 && n <= 9;
    const bad: string[] = [];
    for (let seed = 1; seed <= 200; seed += 1) {
      const questions = makeQuestionsForCounts(seed, {
        ...emptyCounts,
        divisionMeaning: 25,
        divisionFacts: 25,
      });
      expect(questions).toHaveLength(50);
      for (const question of questions) {
        // 题面里最大的数是被除数，其余数字（除数、商）和答案都必须在 2～9
        const numbers = (question.expression.match(/\d+/g) ?? []).map(Number);
        const dividend = Math.max(...numbers);
        const others = numbers.filter((n) => n !== dividend);
        const ok =
          inTable(question.answer) &&
          others.every(inTable) &&
          dividend % question.answer === 0 &&
          inTable(dividend / question.answer);
        if (!ok) bad.push(`${question.expression} → ${question.answer}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('乘除应用题不出两位数商和除不尽，答案与所求问题、单位一致', () => {
    const tableDivision = (a: number, b: number) =>
      a % b === 0 && b >= 2 && b <= 9 && a / b >= 2 && a / b <= 9;
    const firstNumber = (text: string) => {
      const match = text.match(/\d+/);
      return match ? Number(match[0]) : Number.NaN;
    };
    const bad: string[] = [];
    // 每轮 50 题会让每种题型出现多次，原来固定文案的图形题会在这里卡死
    for (let seed = 1; seed <= 30; seed += 1) {
      const questions = makeQuestionsForCounts(seed, {
        ...emptyCounts,
        mixedWordProblem: 50,
      });
      expect(questions).toHaveLength(50);
      for (const question of questions) {
        const prompt = asWordProblemV2Prompt(question.promptData);
        if (!prompt) {
          bad.push(`不是新版应用题：${question.expression}`);
          continue;
        }
        const texts = prompt.parts.map((part) => part.text).join('\n');
        if (/\d\.\d/.test(texts)) bad.push(`小数：${prompt.story}`);
        const conditionTexts = prompt.conditionIds.map((id) => {
          const part = prompt.parts.find(
            (item) => 'id' in item && item.id === id,
          );
          return part?.text ?? '';
        });
        const questionPart = prompt.parts.find(
          (part) => 'id' in part && part.id === prompt.questionId,
        );
        if (!questionPart || !questionPart.text.includes(prompt.answerUnit))
          bad.push(`问题单位不一致：${prompt.story}`);
        if (prompt.kind === 'multiplyTotal') {
          const [a, b] = conditionTexts.map(firstNumber);
          if (!(a >= 2 && a <= 9 && b >= 2 && b <= 9))
            bad.push(`乘法因数越界：${prompt.story}`);
          else if (question.answer !== a * b)
            bad.push(`乘法答案不一致：${prompt.story}`);
        } else if (
          prompt.kind === 'divisionShare' ||
          prompt.kind === 'divisionGroup'
        ) {
          const [total, divisor] = conditionTexts.map(firstNumber);
          if (!tableDivision(total, divisor))
            bad.push(`除法不表内：${prompt.story}`);
          else if (question.answer !== total / divisor)
            bad.push(`除法答案不一致：${prompt.story}`);
        } else {
          const perDay = firstNumber(conditionTexts[0] ?? '');
          if (
            prompt.hiddenCondition?.kind !== 'weekDays' ||
            question.answer !== perDay * 7
          )
            bad.push(`星期题不一致：${prompt.story}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

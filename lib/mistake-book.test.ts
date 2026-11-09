import { describe, expect, it } from 'vitest';
import {
  buildMistakePractice,
  createRng,
  getMistakeType,
  isMistakeAnswerCorrect,
  mistakeTypes,
} from './mistake-book';

describe('错题集题型', () => {
  it('包含全部 8 个题型，且每个题型都有错题和方法', () => {
    expect(mistakeTypes).toHaveLength(8);
    for (const type of mistakeTypes) {
      expect(type.title).not.toBe('');
      expect(type.method.length).toBeGreaterThan(0);
      expect(type.examples.length).toBeGreaterThan(0);
    }
  });

  it('按照照片中的错题写下的标准答案', () => {
    const answers = mistakeTypes.flatMap((type) =>
      type.examples.map((e) => e.answer),
    );
    expect(answers).toEqual(
      expect.arrayContaining([
        '16',
        '10',
        '64',
        '36',
        '7 和 8',
        '4 和 9',
        '9',
        '192',
        '27',
        '8',
        '1',
        '5',
        '6',
        '16',
      ]),
    );
  });

  it('随机练习题的答案可以由题干验证', () => {
    const rng = createRng(42);
    for (let i = 0; i < 200; i++) {
      const id = mistakeTypes[i % mistakeTypes.length].id;
      const [q] = buildMistakePractice(id, 1, rng);
      expect(q.prompt).not.toBe('');
      expect(Number.isInteger(q.answer)).toBe(true);
      expect(q.answer).toBeGreaterThanOrEqual(0);
    }
  });

  it('最大能填几：生成的答案等于 (上限 − 1) ÷ 系数 向下取整', () => {
    const type = getMistakeType('maxFill');
    for (let i = 0; i < 50; i++) {
      const { prompt, answer } = type.generate(createRng(i + 1));
      const left = prompt.match(/^(\d+) × □ < (\d+)/);
      const right = prompt.match(/^(\d+) > (\d+) × □/);
      if (left) {
        const [a, p] = left.slice(1).map(Number);
        expect(answer).toBe(Math.floor((p - 1) / a));
      } else {
        expect(right).not.toBeNull();
        const [p, a] = right!.slice(1).map(Number);
        expect(answer).toBe(Math.floor((p - 1) / a));
      }
    }
  });

  it('同一个种子生成的练习题可以复现', () => {
    const a = buildMistakePractice('compareGroups', 5, createRng(7));
    const b = buildMistakePractice('compareGroups', 5, createRng(7));
    expect(a).toEqual(b);
  });

  it('未知题型会抛出错误', () => {
    expect(() => getMistakeType('nope' as never)).toThrow('未知题型');
  });

  it('判断答案：忽略首尾空格，空白和非整数都判错', () => {
    expect(isMistakeAnswerCorrect(' 16 ', 16)).toBe(true);
    expect(isMistakeAnswerCorrect('15', 16)).toBe(false);
    expect(isMistakeAnswerCorrect('', 16)).toBe(false);
    expect(isMistakeAnswerCorrect('1.6', 16)).toBe(false);
    expect(isMistakeAnswerCorrect('-1', -1)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  defaultPreferences,
  emptyCounts,
  expressionWithAnswerBlank,
  formatAnsweredExpression,
  formatDate,
  formatDuration,
  formatTimestamp,
  getQuestionHints,
  isAnswer,
  isDue,
  splitAnswerBlank,
} from './learning';

describe('学习体验辅助逻辑', () => {
  it('快捷开始默认提供十道基础练习，空配置仍可独立使用', () => {
    expect(defaultPreferences.counts.starter).toBe(10);
    expect(
      Object.values(defaultPreferences.counts).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(10);
    expect(defaultPreferences.mode).toBe('practice');
    expect(defaultPreferences.counts).not.toBe(emptyCounts);
    expect(Object.values(emptyCounts).every((count) => count === 0)).toBe(true);
  });

  it('答案接受整数和零，拒绝未完成输入、空白、科学计数和超长数字', () => {
    for (const answer of ['0', '12', '-3', '9999', '-9999'])
      expect(isAnswer(answer), answer).toBe(true);
    for (const answer of [
      '',
      '-',
      ' ',
      '1.2',
      '1e2',
      '12 ',
      ' 12',
      '+2',
      '10000',
      '１２',
    ])
      expect(isAnswer(answer), answer).toBe(false);
  });

  it('复习到期边界精确到当前时刻，已掌握题目不会再次进入待复习', () => {
    const now = Date.parse('2026-09-12T00:00:00.000Z');
    expect(isDue({ next_review_at: null, mastered_at: null }, now)).toBe(true);
    expect(
      isDue(
        { next_review_at: new Date(now).toISOString(), mastered_at: null },
        now,
      ),
    ).toBe(true);
    expect(
      isDue(
        { next_review_at: new Date(now + 1).toISOString(), mastered_at: null },
        now,
      ),
    ).toBe(false);
    expect(
      isDue(
        { next_review_at: new Date(now - 1).toISOString(), mastered_at: null },
        now,
      ),
    ).toBe(true);
    expect(
      isDue(
        { next_review_at: null, mastered_at: new Date(now - 1).toISOString() },
        now,
      ),
    ).toBe(false);
  });

  it('旧版乘法题转换为可填空表达式且保留题目后缀', () => {
    const examples = [
      ['3 × 几', '3 × □'],
      ['4 + 4 可以看成几个 4', '4 + 4 可以看成 □ 个 4'],
      ['3 个 4 相加，和是', '3 个 4 相加，和是 □'],
      ['每组 4 个，有 3 组，一共有', '每组 4 个，有 3 组，一共有 □ 个'],
      ['3 × 4 = 12，另一个乘数是', '3 × 4 = 12，另一个乘数是 □'],
      ['3 × □ = 12', '3 × □ = 12'],
      ['请读题', '请读题'],
    ];
    for (const [source, expected] of examples)
      expect(expressionWithAnswerBlank(source, 'multiplyMeaning')).toBe(
        expected,
      );
    expect(expressionWithAnswerBlank('3 × 几', 'multiplyFacts')).toBe('3 × 几');
    expect(splitAnswerBlank('3 × □ = 12', 'multiplyMeaning')).toEqual({
      before: '3 × ',
      after: ' = 12',
    });
    expect(splitAnswerBlank('8 + 7', 'explorer')).toBeNull();
    expect(formatAnsweredExpression('3 × □ = 12', 4, 'multiplyMeaning')).toBe(
      '3 × 4 = 12',
    );
    expect(formatAnsweredExpression('8 + 7', '15', 'explorer')).toBe(
      '8 + 7 = 15',
    );
  });

  it('加减法提示给出可操作步骤，并适配整十和不进位情况', () => {
    expect(
      getQuestionHints({ expression: '8 + 7', level: 'explorer' })[1],
    ).toContain('7 分成 2 和 5');
    expect(
      getQuestionHints({ expression: '28 + 7', level: 'challenger' })[0],
    ).toContain('30');
    expect(
      getQuestionHints({ expression: '3 + 4', level: 'starter' })[1],
    ).toContain('从 3 开始');
    expect(
      getQuestionHints({ expression: '10 + 2', level: 'explorer' })[1],
    ).toContain('向前数 2');
    expect(
      getQuestionHints({ expression: '42 - 13', level: 'challenger' })[1],
    ).toContain('13 分成 10 和 3');
    expect(
      getQuestionHints({ expression: '8 − 3', level: 'starter' })[1],
    ).toContain('往回数 3');
  });

  it('乘法提示说明组数与同数连加，零乘数不会产生负数步骤', () => {
    expect(
      getQuestionHints({ expression: '3 × 4', level: 'multiplyFacts' })[0],
    ).toContain('3 个 4 相加');
    expect(
      getQuestionHints({ expression: '3 × 4', level: 'multiplyFacts' })[1],
    ).toContain('2×4');
    expect(
      getQuestionHints({ expression: '0 × 4', level: 'multiplyFacts' })[1],
    ).not.toContain('-1');
  });

  it('算盘、连算、乘法文字题和未知题型分别提供适用的提示', () => {
    for (const level of ['abacusMove', 'abacusMatch'] as const)
      expect(
        getQuestionHints({ expression: '看珠形拨珠', level })[0],
      ).toContain('上珠表示 5');
    for (const level of ['abacusCalculation', 'challenger'] as const)
      expect(getQuestionHints({ expression: '8 + 7 − 3', level })[0]).toContain(
        '从左到右',
      );
    expect(
      getQuestionHints({
        expression: '每组 3 个，有 □ 组',
        level: 'multiplyMeaning',
      })[0],
    ).toContain('每组有几个');
    expect(
      getQuestionHints({ expression: '读题后填空', level: 'starter' }),
    ).toHaveLength(2);
    expect(
      getQuestionHints({ expression: '读题后填空', level: 'starter' })[0],
    ).toContain('已知的数');
  });

  it('空练习日期具有明确文案，时长和有效日期可阅读', () => {
    expect(formatDate(null)).toBe('还没有练习');
    expect(formatTimestamp(null)).toBe('—');
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(3600)).toBe('60:00');
    expect(formatDate('2026-09-12T04:30:00Z')).toMatch(/9.*12/);
    expect(formatTimestamp('2026-09-12T04:30:00Z')).toContain('2026');
  });
});

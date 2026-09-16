import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Results } from './Results';
import { emptyCounts } from '@/lib/learning';
import type { RecordItem, Round } from '@/lib/types';

const round: Round = {
  id: 'test-round',
  mode: 'challenge',
  status: 'completed',
  source: 'custom',
  packageName: '测试',
  counts: { ...emptyCounts, multiplyMixed: 1 },
  totalCount: 1,
  startedAt: '2026-09-15T15:58:00Z',
  completedAt: '2026-09-15T16:00:05Z',
  challengerChain: false,
  questions: [
    {
      id: 'q',
      position: 1,
      level: 'multiplyMixed',
      expression: '6 × 9 + 28',
      answer: '82',
      correctAnswer: 82,
      isCorrect: true,
      clientVersion: 1,
    },
  ],
};
const result: RecordItem = {
  id: round.id,
  package_name: '测试',
  starter_count: 0,
  explorer_count: 0,
  challenger_count: 0,
  multiply_meaning_count: 0,
  multiply_facts_count: 0,
  multiply_mixed_count: 1,
  abacus_move_count: 0,
  abacus_match_count: 0,
  abacus_calculation_count: 0,
  total_count: 1,
  score: 100,
  correct_count: 1,
  duration_seconds: 125,
  started_at: round.startedAt!,
  completed_at: round.completedAt!,
  questions: round.questions,
};
function render(item = result) {
  return renderToStaticMarkup(
    React.createElement(Results, {
      result: item,
      round,
      busy: false,
      onRepeat() {},
      onReview() {},
      onHome() {},
    }),
  );
}
describe('完成时间印章', () => {
  it('使用保存的交卷时间，转换北京时间跨日并保留秒数', () => {
    const html = render();
    expect(html).toContain('dateTime="2026-09-15T16:00:05Z"');
    expect(html).toContain('2026/09/16');
    expect(html).toContain('00:00:05');
    expect(html).toContain('北京时间');
  });
  it('之后重新查看成绩时，完成时间不随当前时间改变', () => {
    vi.useFakeTimers();
    try {
      const before = render();
      vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));
      expect(render()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
  it('无效的旧时间不会导致结果页崩溃或显示伪造时间', () => {
    const html = render({ ...result, completed_at: 'invalid' });
    expect(html).not.toContain('completion-stamp');
    expect(html).toContain('这一轮，全都答对了');
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  Component,
  createElement as h,
  StrictMode,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WrongBook } from './WrongBook';
import type { WrongItem } from '@/lib/types';

class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed
      ? h('p', { 'data-testid': 'crash' }, '页面没有顺利打开')
      : this.props.children;
  }
}
const questions: WrongItem[] = [
  {
    id: 'multiply',
    expression: '9 × 6',
    correct_answer: 54,
    level: 'multiplyFacts',
  },
  {
    id: 'addition',
    expression: '8 + 7',
    correct_answer: 15,
    level: 'explorer',
  },
].map((q) => ({
  ...q,
  level: q.level as WrongItem['level'],
  mistake_count: 1,
  last_answer: '0',
  last_seen_at: '2026-09-13T00:00:00Z',
  review_count: 0,
  correct_streak: 0,
  last_reviewed_at: null,
  next_review_at: null,
  mastered_at: null,
}));
let container: HTMLDivElement, root: Root;
let errors: unknown[];
const onReviewed = vi.fn();
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  errors = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container, {
    onCaughtError: (error) => errors.push(error),
  });
  vi.stubGlobal('fetch', vi.fn());
  await act(async () => {
    root.render(
      h(
        StrictMode,
        null,
        h(ErrorBoundary, {
          children: h(WrongBook, {
            items: questions,
            onBack: vi.fn(),
            onReviewed,
          }),
        }),
      ),
    );
  });
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function card(index = 0) {
  return container.querySelectorAll<HTMLElement>('.review-card')[index];
}
async function revealHints(index = 0) {
  const hint = [
    ...card(index).querySelectorAll<HTMLButtonElement>('button'),
  ].find((button) => button.textContent?.includes('一点提示'))!;
  for (let i = 0; i < 2; i++) await act(async () => hint.click());
}
async function toggle(index = 0) {
  await act(async () => {
    card(index).querySelector('summary')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
function expectNoCrash() {
  expect(
    errors.map((error) =>
      error instanceof Error ? error.message : String(error),
    ),
  ).toEqual([]);
  expect(container.querySelector('[data-testid=crash]')).toBeNull();
}
describe('错题查看答案', () => {
  it('两次提示后可以展开乘法答案，不触发页面异常或提交复习', async () => {
    expect(card().querySelector('details')).toBeNull();
    await revealHints();
    expect(card().querySelector('details')?.open).toBe(false);
    await toggle();
    expectNoCrash();
    expect(card().querySelector('details')?.open).toBe(true);
    expect(card().querySelector('details p')?.textContent).toContain('54');
    expect(onReviewed).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('可反复展开收起，不会连带打开其他错题答案', async () => {
    await revealHints();
    await revealHints(1);
    for (let i = 0; i < 3; i++) {
      await toggle();
      expectNoCrash();
      expect(card().querySelector('details')?.open).toBe(true);
      expect(card(1).querySelector('details')?.open).toBe(false);
      await toggle();
      expectNoCrash();
      expect(card().querySelector('details')?.open).toBe(false);
    }
    await toggle(1);
    expectNoCrash();
    expect(card(1).querySelector('details p')?.textContent).toContain('15');
    expect(card().querySelector('details')?.open).toBe(false);
  });
});

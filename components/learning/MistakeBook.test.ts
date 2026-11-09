// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement as h, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MistakeBook } from './MistakeBook';
import { mistakeTypes } from '@/lib/mistake-book';

let container: HTMLDivElement, root: Root;
const onBack = vi.fn();

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn());
  await act(async () => {
    root.render(h(StrictMode, null, h(MistakeBook, { onBack })));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function buttonByText(text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.includes(text),
  )!;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
}

describe('错题集页面', () => {
  it('列出全部题型', () => {
    const cards = container.querySelectorAll('.mistake-type-card');
    expect(cards).toHaveLength(mistakeTypes.length);
    expect(container.textContent).toContain('最大能填几');
    expect(container.textContent).toContain('找规律填数');
  });

  it('进入题型后可以看到原来的错题与答案', async () => {
    await click(container.querySelector('.mistake-type-card')!);
    expect(container.textContent).toContain('原来的错题');
    expect(container.textContent).toContain('答案：16');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('练一练：输入的答案会被判对或判错，并保持本地计算', async () => {
    await click(container.querySelector('.mistake-type-card')!);
    await click(buttonByText('来练一练'));
    const cards = container.querySelectorAll('.review-card');
    expect(cards).toHaveLength(5);
    const input = cards[0].querySelector<HTMLInputElement>('input')!;
    expect(input).not.toBeNull();
    // 空白时检查按钮禁用
    expect(
      cards[0].querySelector<HTMLButtonElement>('button.primary-button')!
        .disabled,
    ).toBe(true);
    // 输入一个几乎必然错误的数，应显示提示
    const setValue = (el: HTMLInputElement, value: string) => {
      const desc = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      );
      desc?.set?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => setValue(input, '-999'));
    await click(cards[0].querySelector('button.primary-button')!);
    expect(cards[0].textContent).toContain('还差一点');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('返回按钮回到题型列表', async () => {
    await click(container.querySelector('.mistake-type-card')!);
    await click(buttonByText('返回错题集'));
    expect(container.querySelectorAll('.mistake-type-card')).toHaveLength(
      mistakeTypes.length,
    );
  });
});

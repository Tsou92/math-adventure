// @vitest-environment jsdom
import { act, createElement, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Round } from './types';
import { useAutosave } from '../hooks/use-autosave';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./client-api', () => ({ api: request }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = '';
  sessionStorage.clear();
  request.mockReset();
});

describe('autosave recovered drafts', () => {
  it('saves recovered edits after StrictMode cleanup and remount', async () => {
    const round = {
      id: 'strict-round',
      status: 'started',
      questions: [{ id: 'q1', answer: '', clientVersion: 0 }],
    } as Round;
    sessionStorage.setItem(
      'round-draft:strict-round',
      JSON.stringify({
        answers: { q1: '7' },
        versions: { q1: 2 },
      }),
    );
    request.mockImplementation(async (_path: string, init: RequestInit) => ({
      saved: JSON.parse(init.body as string).answers.map(
        (item: {
          questionId: string;
          answer: string;
          clientVersion: number;
        }) => ({
          questionId: item.questionId,
          answerText: item.answer,
          clientVersion: item.clientVersion,
        }),
      ),
    }));
    let current: ReturnType<typeof useAutosave> | undefined;
    function Harness() {
      const saved = useAutosave(round);
      useEffect(() => {
        current = saved;
      }, [saved]);
      return null;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(createElement(StrictMode, null, createElement(Harness))),
    );
    expect(request).toHaveBeenCalled();
    expect(current?.answers.q1).toBe('7');
    expect(current?.state).toBe('saved');
    expect(current?.hasPending()).toBe(false);
    expect(
      JSON.parse(String(request.mock.calls.at(-1)?.[1].body)).answers,
    ).toEqual([expect.objectContaining({ questionId: 'q1', answer: '7' })]);
  });
});

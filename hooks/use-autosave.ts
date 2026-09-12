'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Round } from '@/lib/types';
import { api, ApiError } from '@/lib/client-api';

type Draft = {
  answers: Record<string, string>;
  versions: Record<string, number>;
};
function initialDraft(round: Round): Draft {
  const answers = Object.fromEntries(
    round.questions.map((q) => [q.id, q.answer ?? '']),
  );
  const versions = Object.fromEntries(
    round.questions.map((q) => [q.id, q.clientVersion ?? 0]),
  );
  try {
    const cached = JSON.parse(
      sessionStorage.getItem(`round-draft:${round.id}`) ?? 'null',
    ) as Draft | null;
    if (cached)
      for (const q of round.questions) {
        const version = cached.versions?.[q.id],
          answer = cached.answers?.[q.id];
        if (
          Number.isSafeInteger(version) &&
          version > versions[q.id] &&
          typeof answer === 'string' &&
          /^-?\d{0,4}$/.test(answer)
        ) {
          answers[q.id] = answer;
          versions[q.id] = version;
        }
      }
  } catch {
    /* Session storage is optional; cloud saving still works. */
  }
  return { answers, versions };
}
export function useAutosave(round: Round) {
  const [draft, setDraft] = useState(() => initialDraft(round));
  const current = useRef(draft);
  const dirty = useRef(
    new Set(
      round.questions
        .filter((q) => draft.versions[q.id] > (q.clientVersion ?? 0))
        .map((q) => q.id),
    ),
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<'saved' | 'saving' | 'dirty' | 'error'>(
    () =>
      round.questions.some((q) => draft.versions[q.id] > (q.clientVersion ?? 0))
        ? 'dirty'
        : 'saved',
  );
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<{
    questionId: string;
    answerText: string;
    clientVersion: number;
  } | null>(null);
  const backup = useCallback(() => {
    try {
      sessionStorage.setItem(
        `round-draft:${round.id}`,
        JSON.stringify(current.current),
      );
    } catch {
      /* Storage can be disabled. */
    }
  }, [round.id]);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (running.current) await running.current;
    if (!dirty.current.size) return;
    const task = (async () => {
      try {
        while (dirty.current.size) {
          const snapshot = current.current;
          const answers = [...dirty.current].map((questionId) => ({
            questionId,
            answer: snapshot.answers[questionId],
            clientVersion: snapshot.versions[questionId],
          }));
          setState('saving');
          const data = await api<{
            saved: Array<{
              questionId: string;
              answerText: string;
              clientVersion: number;
            }>;
          }>(`rounds/${round.id}/answers`, {
            method: 'PATCH',
            body: JSON.stringify({ answers }),
          });
          for (const item of data.saved)
            if (
              current.current.versions[item.questionId] === item.clientVersion
            )
              dirty.current.delete(item.questionId);
        }
        setError('');
        setConflict(null);
        setState('saved');
        try {
          sessionStorage.removeItem(`round-draft:${round.id}`);
        } catch {
          /* Optional backup. */
        }
      } catch (issue) {
        setState('error');
        if (
          issue instanceof ApiError &&
          issue.data.code === 'ANSWER_VERSION_STALE'
        ) {
          setConflict({
            questionId: String(issue.data.questionId),
            answerText:
              typeof issue.data.answerText === 'string'
                ? issue.data.answerText
                : '',
            clientVersion: Number(issue.data.clientVersion ?? 0),
          });
          setError('另一设备更新了这道题，请选择要保留的答案。');
        } else
          setError(
            issue instanceof Error ? issue.message : '答案暂未保存，请重试。',
          );
        throw issue;
      }
    })();
    running.current = task;
    try {
      await task;
    } finally {
      if (running.current === task) running.current = null;
    }
  }, [round.id]);
  const update = useCallback(
    (id: string, answer: string) => {
      if (!/^-?\d{0,4}$/.test(answer) || !(id in current.current.answers))
        return;
      current.current = {
        answers: { ...current.current.answers, [id]: answer },
        versions: {
          ...current.current.versions,
          [id]: current.current.versions[id] + 1,
        },
      };
      dirty.current.add(id);
      setDraft(current.current);
      backup();
      setState('dirty');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(
        () => void flush().catch(() => undefined),
        700,
      );
    },
    [backup, flush],
  );
  const resolveConflict = async (useServer: boolean) => {
    if (!conflict) return;
    const { questionId, answerText, clientVersion } = conflict;
    current.current = {
      answers: {
        ...current.current.answers,
        [questionId]: useServer
          ? answerText
          : current.current.answers[questionId],
      },
      versions: {
        ...current.current.versions,
        [questionId]: clientVersion + (useServer ? 0 : 1),
      },
    };
    if (useServer) dirty.current.delete(questionId);
    else dirty.current.add(questionId);
    setDraft(current.current);
    backup();
    setConflict(null);
    setError('');
    if (dirty.current.size) await flush();
    else setState('saved');
  };
  useEffect(() => {
    if (dirty.current.size && round.status === 'started')
      void flush().catch(() => undefined);
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current.size) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener('beforeunload', warn);
    };
  }, [flush, round.status]);
  return {
    answers: draft.answers,
    update,
    flush,
    state,
    error,
    conflict,
    resolveConflict,
  };
}

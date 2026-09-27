'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Round } from '@/lib/types';
import {
  ANSWER_SAVE_DEBOUNCE_MS,
  AnswerSaveController,
  type ConflictChoice,
  type SavedAnswer,
  type SaveState,
} from '@/lib/answer-save';
import { api } from '@/lib/client-api';

type Draft = {
  answers: Record<string, string>;
  versions: Record<string, number>;
};

type UiState = 'saved' | 'saving' | 'dirty' | 'error';

type UiConflict = {
  questionId: string;
  answerText: string;
  clientVersion: number;
};

/** 从 sessionStorage 恢复草稿；云端保存永远可用，本地缓存只是可选兜底。 */
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
    /* 本地缓存不可用时忽略，云端保存仍然工作。 */
  }
  return { answers, versions };
}

function hasRecovered(draft: Draft, round: Round): boolean {
  return round.questions.some(
    (q) => draft.versions[q.id] > (q.clientVersion ?? 0),
  );
}

function aborted(): Error {
  const error = new Error('答案保存已取消');
  error.name = 'AbortError';
  return error;
}

/**
 * 面向 live 界面的答案保存 hook：对外接口与旧版一致，内部改用 main 的
 * AnswerSaveController，从而获得串行保存、逐题冲突后继续、异常 ack/新编辑
 * 保护、请求超时/取消以及卸载清理；sessionStorage 草稿恢复继续保留。
 */
export function useAutosave(round: Round) {
  const seedRef = useRef<Draft | null>(null);
  const seed = (seedRef.current ??= initialDraft(round));
  const draftRef = useRef<Draft>(seed);
  const controllerRef = useRef<AnswerSaveController | null>(null);
  const conflictResolver = useRef<((choice: ConflictChoice) => void) | null>(
    null,
  );
  // 每次新建 controller 递增，用于屏蔽旧代的异步回调；closedRef 在显式
  // dispose 后阻止 getController/flush 无意复活新 controller。
  const generationRef = useRef(0);
  const closedRef = useRef(false);
  const [draft, setDraft] = useState<Draft>(seed);
  const [state, setState] = useState<UiState>(() =>
    hasRecovered(seed, round) ? 'dirty' : 'saved',
  );
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<UiConflict | null>(null);

  const backup = useCallback(
    (snapshot: Draft) => {
      try {
        sessionStorage.setItem(
          `round-draft:${round.id}`,
          JSON.stringify(snapshot),
        );
      } catch {
        /* 本地缓存可选。 */
      }
    },
    [round.id],
  );

  const getController = useCallback((): AnswerSaveController | null => {
    // 显式卸载/成功放弃后不再复活新 controller；effect 重建会重新放行。
    if (closedRef.current) return null;
    const existing = controllerRef.current;
    if (existing) return existing;
    const snapshot = draftRef.current;
    const generation = (generationRef.current += 1);
    const live = () => generationRef.current === generation;
    const controller = new AnswerSaveController({
      answers: snapshot.answers,
      versions: snapshot.versions,
      debounceMs: ANSWER_SAVE_DEBOUNCE_MS,
      request: (items, signal) =>
        api<{ saved?: SavedAnswer[] }>(`rounds/${round.id}/answers`, {
          method: 'PATCH',
          body: JSON.stringify({ answers: items }),
          signal,
        }),
      resolveConflict: (issue) =>
        new Promise<ConflictChoice>((resolve) => {
          if (!live()) {
            resolve('server');
            return;
          }
          conflictResolver.current = resolve;
          setConflict({
            questionId: issue.questionId,
            answerText: issue.answerText ?? '',
            clientVersion: issue.clientVersion ?? 0,
          });
          setError('另一设备更新了这道题，请选择要保留的答案。');
        }),
      onSnapshot: (next) => {
        // 旧代（已被 dispose）的快照不得回写当前界面/草稿。
        if (!live()) return;
        draftRef.current = next;
        setDraft(next);
        backup(next);
      },
      onState: (next: SaveState) => {
        if (!live()) return;
        setState(next === 'idle' ? 'saved' : next);
        if (next !== 'error') setError('');
      },
      onError: (message) => {
        if (live()) setError(message);
      },
    });
    controllerRef.current = controller;
    // 每个新 controller 都重新入队“尚未被云端确认”的本地草稿：StrictMode
    // 重建或卸载后重新挂载时，恢复出的草稿都会重新进入可靠队列。
    for (const q of round.questions)
      if ((snapshot.versions[q.id] ?? 0) > (q.clientVersion ?? 0))
        controller.update(q.id, snapshot.answers[q.id] ?? '');
    return controller;
  }, [backup, round]);

  const update = useCallback(
    (questionId: string, answer: string) => {
      if (!/^-?\d{0,4}$/.test(answer)) return;
      if (!(questionId in draftRef.current.answers)) return;
      getController()?.update(questionId, answer);
    },
    [getController],
  );

  const flush = useCallback(async () => {
    const controller = getController();
    if (!controller) throw aborted();
    const generation = generationRef.current;
    try {
      await controller.flush();
    } catch (issue) {
      // 旧代/已取消（dispose/AbortError）的失败不回写当前代界面状态。
      if (generationRef.current === generation) {
        setState('error');
        setError(
          issue instanceof Error
            ? issue.message
            : '答案暂时没有保存，请检查网络',
        );
      }
      throw issue;
    }
  }, [getController]);

  const resolveConflict = useCallback(async (useServer: boolean) => {
    const resolve = conflictResolver.current;
    conflictResolver.current = null;
    setConflict(null);
    setError('');
    // 当前 drain 仍在等待这个选择，继续处理剩余 dirty，无需再次 flush。
    resolve?.(useServer ? 'server' : 'overwrite');
  }, []);

  const dispose = useCallback(() => {
    // 关闭当前代：此后 getController/flush 不会无意复活新 controller；
    // effect 合法重建时会重新打开。
    closedRef.current = true;
    generationRef.current += 1;
    conflictResolver.current?.('server');
    conflictResolver.current = null;
    controllerRef.current?.dispose();
    controllerRef.current = null;
  }, []);

  useEffect(() => {
    // effect 重建（含 StrictMode 的 setup→cleanup→setup）开启新一代保存。
    closedRef.current = false;
    let active = true;
    queueMicrotask(() => {
      if (active && round.status === 'started')
        void flush().catch(() => undefined);
    });
    const warn = (event: BeforeUnloadEvent) => {
      if (controllerRef.current?.hasPending()) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      active = false;
      window.removeEventListener('beforeunload', warn);
      // 卸载清理：取消计时器与在途请求，避免已离开的页面继续发请求。
      dispose();
    };
  }, [dispose, flush, round.status]);

  return {
    answers: draft.answers,
    update,
    flush,
    state,
    error,
    conflict,
    resolveConflict,
    dispose,
    hasPending: () => controllerRef.current?.hasPending() ?? false,
  };
}

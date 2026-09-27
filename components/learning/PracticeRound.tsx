import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import { Check, Clock3, LogOut, Play, Target } from 'lucide-react';
import {
  ANSWER_SAVE_DEBOUNCE_MS,
  AnswerSaveController,
  type SaveState,
} from '@/lib/answer-save';
import { api } from '@/lib/api-client';
import {
  formatDuration,
  levelInfo,
  splitAnswerBlank,
} from '@/lib/learning-display';
import type { RecordItem, Round } from '@/lib/learning-types';
import type { AbacusMatchPrompt } from '@/lib/questions';
import {
  AbacusCalculationQuestion,
  AbacusMatchBoard,
  AbacusMoveQuestion,
} from './PracticeQuestions';

export type PracticeRoundHandle = {
  /** 等待所有未保存答案落库；失败时 reject 且保留 dirty。 */
  flush: () => Promise<void>;
  /** 取消计时器与在途请求并丢弃未保存数据，仅在放弃成功后调用。 */
  dispose: () => void;
};

export function PracticeRound({
  round,
  onChanged,
  onFinished,
  onAbandon,
  locked = false,
  ref,
}: {
  round: Round;
  onChanged: (round: Round) => void;
  onFinished: (result: RecordItem, round: Round) => Promise<void>;
  onAbandon: () => Promise<void>;
  /** 退出登录/交卷等关键流程期间锁定输入，避免 flush 之后答案又被修改。 */
  locked?: boolean;
  ref?: Ref<PracticeRoundHandle>;
}) {
  const initialAnswers = useMemo(
    () =>
      Object.fromEntries(
        round.questions.map((q) => [q.id, q.answer ?? '']),
      ) as Record<string, string>,
    [round],
  );
  const initialVersions = useMemo(
    () =>
      Object.fromEntries(
        round.questions.map((q) => [q.id, q.clientVersion ?? 0]),
      ) as Record<string, number>,
    [round],
  );
  const [answers, setAnswers] = useState<Record<string, string>>(
    () => initialAnswers,
  );
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controllerRef = useRef<AnswerSaveController | null>(null);

  const getController = () => {
    const existing = controllerRef.current;
    if (existing) return existing;
    const controller = new AnswerSaveController({
      answers: initialAnswers,
      versions: initialVersions,
      debounceMs: ANSWER_SAVE_DEBOUNCE_MS,
      request: (items, signal) =>
        api<{
          saved: Array<{
            questionId: string;
            answerText: string;
            clientVersion: number;
          }>;
        }>(`rounds/${round.id}/answers`, {
          method: 'PATCH',
          body: JSON.stringify({ answers: items }),
          signal,
        }),
      resolveConflict: () =>
        window.confirm(
          '这道题已在另一页面或设备更新。点击“确定”使用已保存答案；点击“取消”用当前答案覆盖。',
        )
          ? 'server'
          : 'overwrite',
      onSnapshot: (snapshot) => setAnswers(snapshot.answers),
      onState: (state) => {
        setSaveState(state);
        if (state !== 'error') setError('');
      },
      onError: (message) => setError(message),
    });
    controllerRef.current = controller;
    return controller;
  };

  useImperativeHandle(
    ref,
    () => ({
      flush: () => controllerRef.current?.flush() ?? Promise.resolve(),
      dispose: () => {
        controllerRef.current?.dispose();
        controllerRef.current = null;
      },
    }),
    [],
  );

  useEffect(() => {
    if (round.status !== 'started' || !round.startedAt) return;
    const tick = () =>
      setElapsed(
        Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(round.startedAt!).getTime()) / 1000,
          ),
        ),
      );
    tick();
    const timer = window.setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [round.status, round.startedAt]);

  useEffect(() => {
    if (!['dirty', 'saving', 'error'].includes(saveState)) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [saveState]);

  useEffect(
    () => () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    },
    [],
  );

  const inputsLocked = locked || busy;

  const updateAnswer = (id: string, value: string) => {
    if (inputsLocked) return;
    if (!/^-?\d{0,4}$/.test(value)) return;
    getController().update(id, value);
  };

  const start = async () => {
    if (inputsLocked) return;
    setBusy(true);
    setError('');
    try {
      const data = await api<{ round: Round }>(`rounds/${round.id}/start`, {
        method: 'POST',
      });
      onChanged(data.round);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '开始失败');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (inputsLocked) return;
    setBusy(true);
    setError('');
    try {
      await getController().flush();
    } catch {
      setError('还有答案没有保存成功，请检查网络后重试交卷');
      setBusy(false);
      return;
    }
    try {
      const data = await api<{ result: RecordItem; round: Round }>(
        `rounds/${round.id}/submit`,
        { method: 'POST' },
      );
      await onFinished(data.result, data.round);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '交卷失败');
    } finally {
      setBusy(false);
    }
  };

  // 放弃失败时绝不 dispose：保留 controller/dirty，让用户重试或先交卷。
  const abandonRound = async () => {
    if (inputsLocked) return;
    setBusy(true);
    setError('');
    try {
      await onAbandon();
      controllerRef.current?.dispose();
      controllerRef.current = null;
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : '退出本轮失败，请检查网络后重试',
      );
    } finally {
      setBusy(false);
    }
  };

  const exitRound = async () => {
    if (inputsLocked) return;
    if (!window.confirm('确定退出本轮答题吗？本轮计时和答案不会计入成绩。'))
      return;
    await abandonRound();
  };

  const answered = Object.values(answers).filter(
    (value) => value.trim() !== '',
  ).length;

  if (round.status === 'generated')
    return (
      <section className="hero-panel rounded-[32px] border border-white p-7 text-center shadow-[0_24px_70px_rgba(93,78,176,.14)] sm:p-12">
        <span className="mx-auto grid size-24 place-items-center rounded-full bg-[#F0EDFF] text-5xl">
          🚀
        </span>
        <h1 className="mt-6 font-title text-3xl font-black">
          {round.packageName} 已准备好！
        </h1>
        <p className="mx-auto mt-3 max-w-lg font-semibold text-[#7E889D]">
          本轮共 {round.totalCount} 道题。点击开始后题目才会出现，同时开始计时。
        </p>
        <div className="mx-auto mt-5 flex max-w-md flex-wrap justify-center gap-2">
          {(Object.keys(levelInfo) as Array<keyof typeof levelInfo>).map(
            (level) =>
              round.counts[level] > 0 && (
                <span className="count-pill" key={level}>
                  {levelInfo[level].title} {round.counts[level]} 道
                </span>
              ),
          )}
        </div>
        {error && <p className="notice-error mx-auto mt-4 max-w-md">{error}</p>}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            className="soft-button"
            disabled={inputsLocked}
            onClick={() => void abandonRound()}
          >
            重新选择题目
          </button>
          <button
            className="primary-button"
            disabled={inputsLocked}
            onClick={start}
          >
            <Play />
            开始答题并计时
          </button>
        </div>
      </section>
    );
  return (
    <div className="space-y-6">
      <section className="sticky top-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white bg-white/90 p-4 shadow-lg backdrop-blur">
        <div>
          <span className="text-xs font-bold text-[#939CAF]">正在挑战</span>
          <h1 className="font-title text-xl font-black">{round.packageName}</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            className="soft-button px-3 py-2 text-xs"
            disabled={inputsLocked}
            onClick={exitRound}
          >
            <LogOut className="size-4" />
            退出本轮
          </button>
          <span className="timer">
            <Clock3 />
            {formatDuration(elapsed)}
          </span>
          <span className="progress-text">
            {answered}/{round.totalCount}
          </span>
        </div>
      </section>
      {saveState !== 'idle' && (
        <p
          className={`text-right text-xs font-bold ${saveState === 'error' ? 'text-[#D95F52]' : 'text-[#7D879C]'}`}
        >
          {saveState === 'saving'
            ? '正在保存答案…'
            : saveState === 'saved'
              ? '答案已保存'
              : saveState === 'dirty'
                ? '答案将在片刻后保存'
                : '有答案尚未保存'}
        </p>
      )}
      {error && <p className="notice-error">{error}</p>}
      <div className="space-y-7">
        {(Object.keys(levelInfo) as Array<keyof typeof levelInfo>).map(
          (level) => {
            const questions = round.questions.filter((q) => q.level === level);
            if (!questions.length) return null;
            return (
              <section className="panel p-5 sm:p-7" key={level}>
                <div className={`level-heading tone-${levelInfo[level].tone}`}>
                  <Target />
                  <div>
                    <strong>{levelInfo[level].title}</strong>
                    <span>
                      {levelInfo[level].subtitle} · {questions.length} 道
                    </span>
                  </div>
                </div>
                {level === 'abacusMatch' ? (
                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    {Object.values(
                      questions.reduce<Record<string, typeof questions>>(
                        (groups, question) => {
                          const groupId = (
                            question.promptData as AbacusMatchPrompt
                          ).groupId;
                          (groups[groupId] ??= []).push(question);
                          return groups;
                        },
                        {},
                      ),
                    ).map((group) => (
                      <AbacusMatchBoard
                        questions={group}
                        answers={answers}
                        onAnswer={updateAnswer}
                        disabled={inputsLocked}
                        key={(group[0].promptData as AbacusMatchPrompt).groupId}
                      />
                    ))}
                  </div>
                ) : (
                  <div
                    className={`mt-5 grid gap-3 ${level === 'abacusMove' ? 'grid-cols-1' : 'sm:grid-cols-2 lg:grid-cols-3'}`}
                  >
                    {questions.map((question) => {
                      if (level === 'abacusMove')
                        return (
                          <AbacusMoveQuestion
                            question={question}
                            answer={answers[question.id] ?? ''}
                            onAnswer={updateAnswer}
                            disabled={inputsLocked}
                            key={question.id}
                          />
                        );
                      if (level === 'abacusCalculation')
                        return (
                          <AbacusCalculationQuestion
                            question={question}
                            answer={answers[question.id] ?? ''}
                            onAnswer={updateAnswer}
                            disabled={inputsLocked}
                            key={question.id}
                          />
                        );
                      const blank = splitAnswerBlank(
                        question.expression,
                        question.level,
                      );
                      const answerInput = (
                        <input
                          inputMode="numeric"
                          aria-label={`第 ${question.position} 题答案`}
                          value={answers[question.id] ?? ''}
                          disabled={inputsLocked}
                          onChange={(event) =>
                            updateAnswer(question.id, event.target.value)
                          }
                        />
                      );
                      return (
                        <label
                          className={`question-card ${blank ? 'question-card-concept' : ''}`}
                          key={question.id}
                        >
                          <span className="question-number">
                            {question.position}
                          </span>
                          {blank ? (
                            <span className="inline-question-prompt">
                              <strong>{blank.before}</strong>
                              {answerInput}
                              {blank.after && <strong>{blank.after}</strong>}
                            </span>
                          ) : (
                            <>
                              <strong>{question.expression} =</strong>
                              {answerInput}
                            </>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          },
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[#26334A] p-5 text-white">
        <div>
          <strong className="font-title text-lg">答完就交卷吧！</strong>
          <p className="text-xs text-white/65">
            已完成 {answered}/{round.totalCount} 道
          </p>
        </div>
        <button
          className="primary-button bg-[#FFC740] text-[#6A4800] shadow-[0_6px_0_#D99E00]"
          disabled={inputsLocked || answered !== round.totalCount}
          onClick={submit}
        >
          <Check />
          {busy ? '正在批改…' : '提交并查看成绩'}
        </button>
      </div>
    </div>
  );
}

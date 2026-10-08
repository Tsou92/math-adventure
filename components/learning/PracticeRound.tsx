'use client';
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  LayoutGrid,
  Lightbulb,
  ListChecks,
} from 'lucide-react';
import type { Round, RoundQuestion, RecordItem } from '@/lib/types';
import type { AbacusMatchPrompt } from '@/lib/questions';
import {
  formatDuration,
  isAnswer,
  levelInfo,
  splitAnswerBlank,
} from '@/lib/learning';
import { api } from '@/lib/client-api';
import { useAutosave } from '@/hooks/use-autosave';
import {
  AbacusCalculationQuestion,
  AbacusMatchBoard,
  AbacusMoveQuestion,
  WordProblemQuestion,
} from './Questions';
import { ErrorNotice, Modal } from './Shared';

export type PracticeRoundHandle = {
  /** 等待所有未保存答案落库；失败时 reject 并保留 dirty 供重试。 */
  flush: () => Promise<void>;
  /** 取消在途请求并丢弃未保存数据，仅在放弃成功或卸载后调用。 */
  dispose: () => void;
};
function groupQuestions(questions: RoundQuestion[]) {
  const units: RoundQuestion[][] = [];
  const groups = new Map<string, RoundQuestion[]>();
  for (const q of questions) {
    if (q.level === 'abacusMatch') {
      const key = (q.promptData as AbacusMatchPrompt).groupId;
      const existing = groups.get(key);
      if (existing) existing.push(q);
      else {
        const group = [q];
        groups.set(key, group);
        units.push(group);
      }
    } else units.push([q]);
  }
  return units;
}
export function PracticeRound({
  round,
  onChanged,
  onFinished,
  onHome,
  onAbandon,
  locked = false,
  ref,
}: {
  round: Round;
  onChanged: (round: Round) => void;
  onFinished: (result: RecordItem, round: Round) => void | Promise<void>;
  onHome: () => Promise<void>;
  onAbandon: () => Promise<void>;
  /** 退出登录/交卷等关键流程期间锁定输入，避免 flush 后答案又被修改。 */
  locked?: boolean;
  ref?: Ref<PracticeRoundHandle>;
}) {
  const saved = useAutosave(round);
  useImperativeHandle(
    ref,
    () => ({
      flush: () => saved.flush(),
      dispose: () => saved.dispose(),
    }),
    [saved],
  );
  const [busy, setBusy] = useState(false);
  const inputsLocked = locked || busy;
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [layout, setLayout] = useState<'single' | 'page'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 700
      ? 'single'
      : 'page',
  );
  const [index, setIndex] = useState(0);
  const [showMap, setShowMap] = useState(false);
  const [exit, setExit] = useState(false);
  const [feedback, setFeedback] = useState<
    Record<string, { answer: string; correct: boolean; hints: string[] }>
  >({});
  const [hints, setHints] = useState<Record<string, number>>({});
  const units = useMemo(
    () => groupQuestions(round.questions),
    [round.questions],
  );
  const content = useRef<HTMLDivElement>(null);
  const complete = round.questions.filter((q) =>
    isAnswer(saved.answers[q.id] ?? ''),
  ).length;
  useEffect(() => {
    if (!round.startedAt) return;
    const tick = () =>
      setElapsed(
        Math.max(
          0,
          Math.floor((Date.now() - Date.parse(round.startedAt!)) / 1000),
        ),
      );
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [round.startedAt]);
  const action = async (work: () => Promise<void>) => {
    if (inputsLocked) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  const move = (next: number) => {
    setIndex(Math.max(0, Math.min(units.length - 1, next)));
    requestAnimationFrame(() => {
      content.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
      content.current
        ?.querySelector<HTMLInputElement>('input[inputmode="numeric"]')
        ?.focus({ preventScroll: true });
    });
  };
  const check = async (q: RoundQuestion) => {
    const answer = saved.answers[q.id];
    if (!isAnswer(answer ?? '')) return;
    await action(async () => {
      await saved.flush();
      const data = await api<{ correct: boolean; hints: string[] }>(
        `rounds/${round.id}/check`,
        { method: 'POST', body: JSON.stringify({ questionId: q.id, answer }) },
      );
      setFeedback((prev) => ({ ...prev, [q.id]: { ...data, answer } }));
    });
  };
  const keyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement))
      return;
    event.preventDefault();
    if (layout === 'single') {
      if (event.shiftKey) move(index - 1);
      else if (index < units.length - 1) move(index + 1);
      else setShowMap(true);
    } else {
      const inputs = [
        ...content.current!.querySelectorAll<HTMLInputElement>(
          'input[inputmode="numeric"]',
        ),
      ];
      const current = inputs.indexOf(event.target);
      const next = inputs[current + (event.shiftKey ? -1 : 1)];
      if (next) {
        next.focus();
        next.select();
      } else if (!event.shiftKey) setShowMap(true);
    }
  };
  const update = (questionId: string, answer: string) => {
    if (inputsLocked) return;
    saved.update(questionId, answer);
  };
  const renderUnit = (unit: RoundQuestion[], unitIndex: number) => {
    const q = unit[0];
    const blank = splitAnswerBlank(q.expression, q.level);
    const answer = saved.answers[q.id] ?? '';
    const checked = feedback[q.id];
    const input = (
      <input
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="next"
        onKeyDown={keyboard}
        aria-label={`第 ${q.position} 题答案`}
        value={answer}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => update(q.id, e.target.value)}
      />
    );
    return (
      <section className="practice-unit" key={q.id} data-unit={unitIndex}>
        <div className="unit-heading">
          <span>
            第 {q.position}
            {unit.length > 1 ? `–${unit.at(-1)!.position}` : ''} 题
          </span>
          <span>{levelInfo[q.level].title}</span>
        </div>
        {q.level === 'abacusMatch' ? (
          <AbacusMatchBoard
            questions={unit}
            answers={saved.answers}
            onAnswer={update}
          />
        ) : q.level === 'abacusMove' ? (
          <AbacusMoveQuestion question={q} answer={answer} onAnswer={update} />
        ) : q.level === 'abacusCalculation' ? (
          <AbacusCalculationQuestion
            onKeyDown={keyboard}
            question={q}
            answer={answer}
            onAnswer={update}
          />
        ) : q.level === 'mixedWordProblem' ? (
          <WordProblemQuestion
            onKeyDown={keyboard}
            question={q}
            answer={answer}
            onAnswer={update}
          />
        ) : (
          <label
            className={`question-card ${blank ? 'question-card-concept' : ''}`}
          >
            <span className="question-number">{q.position}</span>
            {blank ? (
              <span className="inline-question-prompt">
                <strong>{blank.before}</strong>
                {input}
                {blank.after && <strong>{blank.after}</strong>}
              </span>
            ) : (
              <>
                <strong>{q.expression} =</strong>
                {input}
              </>
            )}
          </label>
        )}
        {round.mode === 'practice' &&
          unit.map((item) => (
            <div className="practice-feedback" key={item.id}>
              <button
                className="text-button"
                disabled={
                  inputsLocked || !isAnswer(saved.answers[item.id] ?? '')
                }
                onClick={() => void check(item)}
              >
                <Check />
                {unit.length > 1 ? `检查第 ${item.position} 题` : '检查答案'}
              </button>
              {feedback[item.id]?.answer === saved.answers[item.id] && (
                <output
                  className={
                    feedback[item.id].correct ? 'success-text' : 'muted'
                  }
                >
                  {feedback[item.id].correct
                    ? '答对了，继续前进！'
                    : '再想一想，可以看看提示。'}
                </output>
              )}
            </div>
          ))}
        {round.mode === 'practice' &&
          checked?.answer === answer &&
          !checked.correct && (
            <div className="hint-area">
              <button
                className="text-button"
                onClick={() =>
                  setHints((prev) => ({
                    ...prev,
                    [q.id]: Math.min(
                      checked.hints.length,
                      (prev[q.id] ?? 0) + 1,
                    ),
                  }))
                }
              >
                <Lightbulb />
                给我一点提示
              </button>
              {checked.hints.slice(0, hints[q.id] ?? 0).map((text) => (
                <p key={text}>{text}</p>
              ))}
            </div>
          )}
      </section>
    );
  };
  if (round.status === 'generated')
    return (
      <section className="panel ready-panel">
        <span className="eyebrow">
          {round.mode === 'practice' ? '轻松练习' : '计时挑战'}
        </span>
        <h1>{round.totalCount} 道题，准备好啦</h1>
        <p>
          {round.mode === 'practice'
            ? '按自己的节奏来，不会的可以看提示。'
            : '点击开始后计时，全部完成后统一批改。'}
        </p>
        <ErrorNotice message={error} />
        <button
          className="primary-button"
          disabled={inputsLocked}
          onClick={() =>
            void action(async () => {
              const data = await api<{ round: Round }>(
                `rounds/${round.id}/start`,
                { method: 'POST' },
              );
              onChanged(data.round);
            })
          }
        >
          {busy ? '准备中…' : '开始答题'}
          <ArrowRight />
        </button>
        <button
          className="text-button"
          disabled={inputsLocked}
          onClick={() => void action(onAbandon)}
        >
          重新选题
        </button>
      </section>
    );
  return (
    <div
      className={`practice-layout ${layout === 'single' ? 'single-layout' : ''}`}
    >
      <section className="practice-toolbar">
        <button
          className="icon-button"
          disabled={inputsLocked}
          onClick={() =>
            void action(async () => {
              await saved.flush();
              await onHome();
            })
          }
          aria-label="保存并返回首页"
        >
          <ArrowLeft />
        </button>
        <div className="practice-progress">
          <strong>{round.mode === 'practice' ? '轻松练习' : '计时挑战'}</strong>
          <span>
            {complete} / {round.totalCount} 已答
          </span>
          <progress
            value={complete}
            max={round.totalCount}
            aria-label="答题进度"
          />
        </div>
        {round.mode === 'challenge' && (
          <span className="timer">
            <Clock3 />
            {formatDuration(elapsed)}
          </span>
        )}
        <button
          className="icon-button"
          disabled={inputsLocked}
          onClick={() => setLayout(layout === 'single' ? 'page' : 'single')}
          aria-label={layout === 'single' ? '切换整页答题' : '切换单题答题'}
          title={layout === 'single' ? '整页模式' : '单题模式'}
        >
          <LayoutGrid />
        </button>
        <button
          className="icon-button"
          disabled={inputsLocked}
          onClick={() => setShowMap(true)}
          aria-label="查看答题卡"
        >
          <ListChecks />
        </button>
      </section>
      <output className="save-status">
        {saved.state === 'saving'
          ? '正在保存…'
          : saved.state === 'dirty'
            ? '等待保存…'
            : saved.state === 'error'
              ? '还有答案未保存'
              : '答案已保存'}
      </output>
      <ErrorNotice message={error} />
      <ErrorNotice
        message={saved.error}
        onRetry={!saved.conflict ? () => void action(saved.flush) : undefined}
      />
      {saved.conflict && (
        <div className="panel conflict-panel">
          <p>
            本页答案：{saved.answers[saved.conflict.questionId] || '空白'}
            ；已保存答案：{saved.conflict.answerText || '空白'}
          </p>
          <button
            className="soft-button"
            onClick={() => void action(() => saved.resolveConflict(true))}
          >
            使用已保存答案
          </button>
          <button
            className="primary-button"
            onClick={() => void action(() => saved.resolveConflict(false))}
          >
            保留本页答案并保存
          </button>
        </div>
      )}
      <div ref={content} className="practice-content">
        {layout === 'single'
          ? renderUnit(units[index], index)
          : units.map(renderUnit)}
      </div>
      <footer className="practice-footer">
        {layout === 'single' ? (
          <>
            <button
              className="soft-button"
              disabled={inputsLocked || index === 0}
              onClick={() => move(index - 1)}
            >
              <ArrowLeft />
              上一题
            </button>
            <span>
              {index + 1} / {units.length}
              {units[index].length > 1 ? ' 组' : ''}
            </span>
            {index < units.length - 1 ? (
              <button
                className="primary-button"
                disabled={inputsLocked}
                onClick={() => move(index + 1)}
              >
                {units[index].every((q) => isAnswer(saved.answers[q.id] ?? ''))
                  ? '下一题'
                  : '先跳过'}
                <ArrowRight />
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={inputsLocked}
                onClick={() => setShowMap(true)}
              >
                检查并交卷
                <Check />
              </button>
            )}
          </>
        ) : (
          <>
            <span>
              {complete === round.totalCount
                ? '全部答完了，检查一下吧'
                : `还有 ${round.totalCount - complete} 题待完成`}
            </span>
            <button
              className="primary-button"
              disabled={inputsLocked}
              onClick={() => setShowMap(true)}
            >
              查看答题卡
              <Check />
            </button>
          </>
        )}
      </footer>
      <button
        className="text-button end-round"
        disabled={inputsLocked}
        onClick={() => setExit(true)}
      >
        结束本轮
      </button>
      {showMap && (
        <Modal title="检查答题卡" onClose={() => setShowMap(false)}>
          <p>
            {complete === round.totalCount
              ? '已经全部填写，可以交卷了。'
              : '点题号回到还没答的题目。'}
          </p>
          <div className="answer-map">
            {round.questions.map((q) => (
              <button
                key={q.id}
                className={
                  isAnswer(saved.answers[q.id] ?? '') ? 'answered' : ''
                }
                aria-label={`第 ${q.position} 题，${isAnswer(saved.answers[q.id] ?? '') ? '已答' : '未答'}`}
                onClick={() => {
                  setShowMap(false);
                  setLayout('single');
                  move(units.findIndex((u) => u.some((x) => x.id === q.id)));
                }}
              >
                {q.position}
              </button>
            ))}
          </div>
          <ErrorNotice message={error} />
          <button
            className="primary-button w-full"
            disabled={inputsLocked || complete !== round.totalCount}
            onClick={() =>
              void action(async () => {
                await saved.flush();
                const data = await api<{ result: RecordItem; round: Round }>(
                  `rounds/${round.id}/submit`,
                  { method: 'POST' },
                );
                await onFinished(data.result, data.round);
              })
            }
          >
            {busy
              ? '正在批改…'
              : `提交并查看成绩（${complete}/${round.totalCount}）`}
          </button>
        </Modal>
      )}
      {exit && (
        <Modal title="结束这轮练习？" onClose={() => setExit(false)}>
          <p>结束后不会计入成绩。如果只是休息，可以保存后返回首页。</p>
          <div className="action-row">
            <button
              className="primary-button"
              disabled={inputsLocked}
              onClick={() =>
                void action(async () => {
                  await saved.flush();
                  await onHome();
                })
              }
            >
              保存并返回
            </button>
            <button
              className="soft-button"
              disabled={inputsLocked}
              onClick={() => void action(onAbandon)}
            >
              放弃本轮
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

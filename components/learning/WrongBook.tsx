'use client';
import { useRef, useState } from 'react';
import { ArrowLeft, Check, Lightbulb, RefreshCw } from 'lucide-react';
import type { WrongItem } from '@/lib/types';
import type { AbacusMatchPrompt } from '@/lib/questions';
import { api } from '@/lib/client-api';
import {
  formatDate,
  getQuestionHints,
  isAnswer,
  isDue,
  levelInfo,
  splitAnswerBlank,
} from '@/lib/learning';
import { Abacus } from '@/components/Abacus';
import { AbacusInput } from './AbacusInput';
import { ErrorNotice } from './Shared';
export function WrongBook({
  items,
  onBack,
  onReviewed,
}: {
  items: WrongItem[];
  onBack: () => void;
  onReviewed: (item: WrongItem) => void;
}) {
  const [filter, setFilter] = useState<'due' | 'all' | 'mastered'>(() =>
    items.some((i) => isDue(i)) ? 'due' : 'all',
  );
  const [dueIds] = useState(
    () => new Set(items.filter((i) => isDue(i)).map((i) => i.id)),
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [hints, setHints] = useState<Record<string, number>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(10);
  const attempts = useRef<Record<string, { answer: string; id: string }>>({});
  const visible = items.filter((i) =>
    filter === 'due'
      ? dueIds.has(i.id)
      : filter === 'mastered'
        ? !!i.mastered_at
        : !i.mastered_at,
  );
  const update = (id: string, value: string) => {
    if (!/^-?\d{0,4}$/.test(value)) return;
    setAnswers((a) => ({ ...a, [id]: value }));
    setResults((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
  };
  const check = async (item: WrongItem) => {
    const answer = answers[item.id];
    if (!isAnswer(answer ?? '') || busy) return;
    setBusy(item.id);
    setError('');
    if (attempts.current[item.id]?.answer !== answer)
      attempts.current[item.id] = { answer, id: crypto.randomUUID() };
    try {
      const data = await api<{ item: WrongItem; correct: boolean }>(
        `wrong-book/${item.id}/review`,
        {
          method: 'POST',
          body: JSON.stringify({
            answer,
            attemptId: attempts.current[item.id].id,
          }),
        },
      );
      setResults((r) => ({ ...r, [item.id]: data.correct }));
      onReviewed(data.item);
      delete attempts.current[item.id];
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '没有保存成功，请重试');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="review-page">
      <button className="text-button" onClick={onBack}>
        <ArrowLeft />
        返回首页
      </button>
      <div className="page-heading">
        <div>
          <span className="eyebrow">再挑战</span>
          <h1>把不会的，一点点练会</h1>
          <p>每次复习都会保存。隔天再答对，才算又迈出一步。</p>
        </div>
        <span className="count-label">
          已掌握 {items.filter((i) => i.mastered_at).length} 题
        </span>
      </div>
      <div className="topic-tabs" aria-label="复习筛选">
        {(['due', 'all', 'mastered'] as const).map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
              setLimit(10);
            }}
          >
            {f === 'due'
              ? `今天复习 ${dueIds.size}`
              : f === 'all'
                ? '还在练习'
                : '已经掌握'}
          </button>
        ))}
      </div>
      <ErrorNotice message={error} />
      {!visible.length ? (
        <section className="panel empty-learning">
          <Check />
          <h2>
            {filter === 'mastered'
              ? '每天复习一点，就会有收获'
              : '今天的复习完成啦'}
          </h2>
          <p>
            {filter === 'mastered'
              ? '分三次按复习计划答对，题目会出现在这里。'
              : '可以开始一轮新练习，或查看其他题目。'}
          </p>
          <button className="primary-button" onClick={onBack}>
            返回首页
          </button>
        </section>
      ) : (
        <>
          <div className="review-grid">
            {visible.slice(0, limit).map((item) => {
              const blank = splitAnswerBlank(item.expression, item.level);
              const input = (
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={`${item.expression} 的答案`}
                  value={answers[item.id] ?? ''}
                  onChange={(e) => update(item.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void check(item);
                    }
                  }}
                />
              );
              const tip = getQuestionHints({
                expression: item.expression,
                level: item.level,
              });
              return (
                <article
                  className={`review-card ${results[item.id] === true ? 'review-correct' : ''}`}
                  key={item.id}
                >
                  <div className="review-meta">
                    <span>{levelInfo[item.level].title}</span>
                    <span>
                      {Math.min(3, item.correct_streak ?? 0)}/3 次巩固
                    </span>
                  </div>
                  {item.level === 'abacusMove' ? (
                    <>
                      <strong>{item.expression}，拨出结果</strong>
                      <AbacusInput
                        value={answers[item.id] ?? ''}
                        onChange={(v) => update(item.id, v)}
                        label="复习作答算盘"
                      />
                    </>
                  ) : item.level === 'abacusMatch' ? (
                    <>
                      <strong>{item.expression}，选择正确算盘</strong>
                      <div className="review-abacus-options">
                        {(
                          item.prompt_data as AbacusMatchPrompt
                        ).optionValues.map((v, i) => (
                          <button
                            className={`abacus-match-option ${answers[item.id] === String(v) ? 'paired' : ''}`}
                            key={v}
                            aria-label={`候选算盘 ${i + 1}`}
                            aria-pressed={answers[item.id] === String(v)}
                            onClick={() => update(item.id, String(v))}
                          >
                            <Abacus value={v} compact />
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <label className="review-expression">
                      {blank ? (
                        <>
                          <strong>{blank.before}</strong>
                          {input}
                          <strong>{blank.after}</strong>
                        </>
                      ) : (
                        <>
                          <strong>{item.expression} =</strong>
                          {input}
                        </>
                      )}
                    </label>
                  )}
                  <button
                    className="primary-button w-full"
                    disabled={
                      !!busy ||
                      !isAnswer(answers[item.id] ?? '') ||
                      results[item.id] === true
                    }
                    onClick={() => void check(item)}
                  >
                    {busy === item.id ? (
                      '保存中…'
                    ) : results[item.id] === true ? (
                      <>
                        <Check />
                        答对了，已保存
                      </>
                    ) : results[item.id] === false ? (
                      <>
                        <RefreshCw />
                        再试一次
                      </>
                    ) : (
                      '检查答案'
                    )}
                  </button>
                  <div aria-live="polite">
                    {results[item.id] === false && (
                      <p className="review-feedback">
                        还差一点，看看提示再试试。
                      </p>
                    )}
                    {results[item.id] === true && (
                      <p className="success-text">
                        {item.mastered_at
                          ? '已经掌握这道题！'
                          : `下次复习：${formatDate(item.next_review_at)}`}
                      </p>
                    )}
                  </div>
                  <button
                    className="text-button"
                    onClick={() =>
                      setHints((h) => ({
                        ...h,
                        [item.id]: Math.min(tip.length, (h[item.id] ?? 0) + 1),
                      }))
                    }
                  >
                    <Lightbulb />
                    一点提示
                  </button>
                  {tip.slice(0, hints[item.id] ?? 0).map((t) => (
                    <p className="hint-text" key={t}>
                      {t}
                    </p>
                  ))}
                  {(hints[item.id] ?? 0) >= tip.length && (
                    <details
                      open={!!revealed[item.id]}
                      onToggle={(e) =>
                        setRevealed((r) => ({
                          ...r,
                          [item.id]: e.currentTarget.open,
                        }))
                      }
                    >
                      <summary>查看答案，再自己算一遍</summary>
                      {item.level.startsWith('abacus') &&
                      item.level !== 'abacusCalculation' ? (
                        <Abacus value={item.correct_answer} showValue />
                      ) : (
                        <p className="hint-text">
                          这道题的答案是 {item.correct_answer}。
                        </p>
                      )}
                    </details>
                  )}
                </article>
              );
            })}
          </div>
          {visible.length > limit && (
            <button
              className="soft-button"
              onClick={() => setLimit(limit + 10)}
            >
              再显示 10 题
            </button>
          )}
        </>
      )}
    </div>
  );
}

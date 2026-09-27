'use client';

import { useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronRight,
  RefreshCw,
  Target,
  Trophy,
} from 'lucide-react';
import { Abacus } from '@/components/Abacus';
import { splitAnswerBlank } from '@/lib/learning-display';
import type { AbacusMatchPrompt } from '@/lib/questions';
import type { WrongItem } from '@/lib/learning-types';

export function WrongBookPractice({
  wrong,
  onBack,
}: {
  wrong: WrongItem[];
  onBack: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, boolean | undefined>>(
    {},
  );
  const mastered = Object.values(results).filter(
    (result) => result === true,
  ).length;
  const attempted = Object.values(results).filter(
    (result) => result !== undefined,
  ).length;
  const updateAnswer = (id: string, value: string) => {
    if (!/^-?\d{0,4}$/.test(value)) return;
    setAnswers((current) => ({ ...current, [id]: value }));
    setResults((current) => ({ ...current, [id]: undefined }));
  };
  const checkAnswer = (item: WrongItem) => {
    const answer = answers[item.id];
    if (!answer?.trim()) return;
    setResults((current) => ({
      ...current,
      [item.id]: Number(answer) === Number(item.correct_answer),
    }));
  };
  return (
    <div className="space-y-6">
      <section className="hero-panel rounded-[32px] border border-white p-6 shadow-[0_24px_70px_rgba(93,78,176,.13)] sm:p-9">
        <button className="soft-button mb-6" onClick={onBack}>
          <ChevronRight className="rotate-180" />
          返回练习首页
        </button>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <span className="eyebrow">
              <BookOpen className="size-4" />
              错题再挑战
            </span>
            <h1 className="mt-4 font-title text-3xl font-black sm:text-4xl">
              把不会的，练成最拿手的！
            </h1>
            <p className="mt-2 font-semibold text-[#7D879C]">
              先自己重新计算，再点击“检查答案”。答错了也没关系，可以一直重试。
            </p>
          </div>
          <div className="flex gap-3">
            <div className="stat-bubble compact">
              <strong>{mastered}</strong>
              <span>本次答对</span>
            </div>
            <div className="stat-bubble compact">
              <strong>
                {attempted}/{wrong.length}
              </strong>
              <span>已经检查</span>
            </div>
          </div>
        </div>
      </section>
      {wrong.length ? (
        <section className="panel p-5 sm:p-7">
          <div className="section-title">
            <Target />
            全部错题 <span>{wrong.length} 题</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {wrong.map((item, index) => {
              const result = results[item.id];
              const blank = splitAnswerBlank(item.expression, item.level);
              const answerInput = (
                <input
                  className="min-w-0 flex-1 rounded-xl border-2 border-[#DFE3ED] bg-white px-3 py-2 text-center text-lg font-black outline-none transition focus:border-[#7565DD]"
                  inputMode="numeric"
                  aria-label={`${item.expression} 的答案`}
                  value={answers[item.id] ?? ''}
                  onChange={(event) =>
                    updateAnswer(item.id, event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') checkAnswer(item);
                  }}
                />
              );
              return (
                <article
                  className={`rounded-2xl border-2 p-4 transition ${result === true ? 'border-[#8AD6A8] bg-[#F0FFF5]' : result === false ? 'border-[#FFAAA0] bg-[#FFF4F2]' : 'border-[#E8EAF2] bg-white'}`}
                  key={item.id}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="question-number">{index + 1}</span>
                    <small className="font-bold text-[#9AA3B4]">
                      曾错 {item.mistake_count} 次
                    </small>
                  </div>
                  {item.level === 'abacusMove' ? (
                    <div className="grid justify-items-center gap-3">
                      <strong className="font-title text-lg text-[#354158]">
                        {item.expression}，拨出结果
                      </strong>
                      <Abacus
                        value={Number(answers[item.id] || 0)}
                        interactive
                        showValue
                        label={`${item.expression} 错题作答算盘`}
                        onChange={(value) =>
                          updateAnswer(item.id, String(value))
                        }
                      />
                      {!answers[item.id] && (
                        <button
                          className="abacus-zero-button"
                          type="button"
                          onClick={() => updateAnswer(item.id, '0')}
                        >
                          确认答案是 0
                        </button>
                      )}
                    </div>
                  ) : item.level === 'abacusMatch' ? (
                    <div className="grid gap-3">
                      <strong className="text-center font-title text-lg text-[#354158]">
                        {item.expression}，选择正确算盘
                      </strong>
                      <div className="grid grid-cols-2 gap-2">
                        {(
                          item.prompt_data as AbacusMatchPrompt
                        ).optionValues.map((value) => (
                          <button
                            type="button"
                            className={`abacus-match-option ${answers[item.id] === String(value) ? 'paired' : ''}`}
                            onClick={() => updateAnswer(item.id, String(value))}
                            key={value}
                          >
                            <Abacus value={value} compact label="候选算盘" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : blank ? (
                    <div className="inline-wrong-prompt">
                      <strong>{blank.before}</strong>
                      {answerInput}
                      {blank.after && <strong>{blank.after}</strong>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <strong className="whitespace-nowrap font-title text-lg text-[#354158]">
                        {item.expression} =
                      </strong>
                      {answerInput}
                    </div>
                  )}
                  <button
                    className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-black transition ${result === true ? 'bg-[#36B66B] text-white' : 'bg-[#ECE9FF] text-[#6755D9] hover:bg-[#DFDAFF]'}`}
                    disabled={!answers[item.id]?.trim()}
                    onClick={() => checkAnswer(item)}
                  >
                    {result === true ? (
                      <>
                        <Check className="size-4" />
                        答对了！
                      </>
                    ) : result === false ? (
                      <>
                        <RefreshCw className="size-4" />
                        再试一次
                      </>
                    ) : (
                      '检查答案'
                    )}
                  </button>
                  {result === false && (
                    <p className="mt-2 text-center text-xs font-bold text-[#E56F63]">
                      还不对，换个思路再算一次吧
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="panel p-6">
          <div className="empty-state">
            <Trophy className="size-8 text-[#F2A334]" />
            <div>
              <strong>错题已经全部掌握</strong>
              <span>继续保持，你真棒！</span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Rocket, Settings2 } from 'lucide-react';
import {
  normalizeQuestionCount,
  totalQuestions,
  type Level,
  type QuestionCounts,
} from '@/lib/questions';
import { emptyCounts, levelInfo } from '@/lib/learning-display';
import type { CreateRoundInput } from '@/lib/learning-types';

export function QuestionPicker({
  onCreate,
  busy,
}: {
  onCreate: (input: CreateRoundInput) => void;
  busy: boolean;
}) {
  const [counts, setCounts] = useState<QuestionCounts>(() => ({
    ...emptyCounts,
  }));
  const [challengerChain, setChallengerChain] = useState(false);
  const total = totalQuestions(counts);
  const invalidMatchCount = counts.abacusMatch === 1;
  const changeCount = (level: Level, delta: number) => {
    setCounts((current) => ({
      ...current,
      [level]: normalizeQuestionCount(current[level] + delta),
    }));
  };
  const typeCount = (level: Level, value: string) => {
    setCounts((current) => ({
      ...current,
      [level]: normalizeQuestionCount(value),
    }));
  };
  return (
    <section className="panel p-6 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="eyebrow">
            <Settings2 className="size-4" />
            自选知识点
          </span>
          <h2 className="mt-3 font-title text-2xl font-black">
            这轮想练什么？
          </h2>
          <p className="mt-2 text-sm font-semibold text-[#8993A7]">
            每类最多 50 道，本轮合计不超过 100 道。
          </p>
        </div>
        <div className="stat-bubble compact">
          <strong>{total}</strong>
          <span>道题</span>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(levelInfo) as Level[]).map((level) => (
          <article
            className={`count-card tone-${levelInfo[level].tone}`}
            key={level}
          >
            <span>{levelInfo[level].title}</span>
            <small>{levelInfo[level].subtitle}</small>
            <div>
              <button
                type="button"
                aria-label={`${levelInfo[level].title}减少10道`}
                onClick={() => changeCount(level, -10)}
              >
                −10
              </button>
              <button
                type="button"
                aria-label={`${levelInfo[level].title}减少5道`}
                onClick={() => changeCount(level, -5)}
              >
                −5
              </button>
              <input
                aria-label={`${levelInfo[level].title}题目数量`}
                type="number"
                inputMode="numeric"
                min="0"
                max="50"
                placeholder="0"
                value={counts[level] || ''}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => typeCount(level, event.target.value)}
              />
              <button
                type="button"
                aria-label={`${levelInfo[level].title}增加5道`}
                onClick={() => changeCount(level, 5)}
              >
                ＋5
              </button>
              <button
                type="button"
                aria-label={`${levelInfo[level].title}增加10道`}
                onClick={() => changeCount(level, 10)}
              >
                ＋10
              </button>
            </div>
          </article>
        ))}
      </div>
      {counts.challenger > 0 && (
        <div
          className={`mt-5 flex items-start gap-3 rounded-2xl border-2 p-4 transition ${challengerChain ? 'border-[#7565DD] bg-[#F3F0FF]' : 'border-[#E5E8F1] bg-white'}`}
        >
          <input
            aria-label="加入连加连减"
            className="mt-1 size-5 cursor-pointer accent-[#6755D9]"
            type="checkbox"
            checked={challengerChain}
            onChange={(event) => setChallengerChain(event.target.checked)}
          />
          <span>
            <strong className="font-title text-[#3D4960]">加入连加连减</strong>
            <small className="mt-1 block font-semibold leading-5 text-[#8993A7]">
              不勾选：91−68、38＋48；勾选后：61−28＋19
            </small>
          </span>
        </div>
      )}
      <button
        className="primary-button mt-6 w-full sm:w-auto"
        disabled={busy || total < 1 || total > 100 || invalidMatchCount}
        onClick={() => onCreate({ source: 'custom', counts, challengerChain })}
      >
        <Rocket />
        按所选知识点出题（{total} 道）
      </button>
      {total > 100 && (
        <p className="notice-error mt-4">本轮最多 100 道，请减少一些题目。</p>
      )}
      {invalidMatchCount && (
        <p className="notice-error mt-4">
          空拨连线至少选择 2 道，才能完成配对。
        </p>
      )}
    </section>
  );
}

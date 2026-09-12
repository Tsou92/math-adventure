'use client';
import { useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import type { Level } from '@/lib/questions';
import { normalizeQuestionCount, totalQuestions } from '@/lib/questions';
import type { LearningPreferences } from '@/lib/types';
import { levelInfo } from '@/lib/learning';
const groups: { name: string; levels: Level[] }[] = [
  { name: '加减法', levels: ['starter', 'explorer', 'challenger'] },
  { name: '乘法', levels: ['multiplyMeaning', 'multiplyFacts'] },
  {
    name: '珠心算',
    levels: ['abacusMove', 'abacusMatch', 'abacusCalculation'],
  },
];
export function ModePicker({
  value,
  onChange,
}: {
  value: LearningPreferences['mode'];
  onChange: (mode: LearningPreferences['mode']) => void;
}) {
  return (
    <fieldset className="mode-picker">
      <legend>这次怎么练？</legend>
      <div className="mode-options">
        {(['practice', 'challenge'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={value === mode}
            className={value === mode ? 'selected' : ''}
            onClick={() => onChange(mode)}
          >
            <strong>{mode === 'practice' ? '轻松练习' : '计时挑战'}</strong>
            <span>
              {mode === 'practice'
                ? '边做边检查，可以看提示'
                : '专心完成，交卷后看成绩'}
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
export function QuestionPicker({
  value,
  onChange,
}: {
  value: LearningPreferences;
  onChange: (prefs: LearningPreferences) => void;
}) {
  const [group, setGroup] = useState(0);
  const total = totalQuestions(value.counts);
  const update = (level: Level, count: string | number) =>
    onChange({
      ...value,
      counts: { ...value.counts, [level]: normalizeQuestionCount(count) },
    });
  return (
    <div className="question-picker">
      <div className="section-heading">
        <div>
          <h2>自选知识点</h2>
          <p>每类最多 50 题，一轮最多 100 题</p>
        </div>
        <span className="count-label">已选 {total} 题</span>
      </div>
      <div className="topic-tabs" aria-label="知识点分类">
        {groups.map((g, i) => (
          <button
            key={g.name}
            aria-pressed={group === i}
            onClick={() => setGroup(i)}
            type="button"
          >
            {g.name}
            <span>
              {g.levels.reduce((n, l) => n + value.counts[l], 0) || ''}
            </span>
          </button>
        ))}
      </div>
      <div className="topic-grid">
        {groups[group].levels.map((level) => (
          <article
            className={`topic-card ${value.counts[level] > 0 ? 'selected' : ''}`}
            key={level}
          >
            <div className="topic-title">
              <strong>{levelInfo[level].title.replace('珠心算·', '')}</strong>
              {value.counts[level] > 0 && <Check aria-label="已选择" />}
            </div>
            <p>{levelInfo[level].subtitle}</p>
            <div className="stepper">
              <button
                type="button"
                disabled={value.counts[level] === 0}
                aria-label={`${levelInfo[level].title}减少5道`}
                onClick={() => update(level, value.counts[level] - 5)}
              >
                <Minus />
              </button>
              <label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  inputMode="numeric"
                  aria-label={`${levelInfo[level].title}题目数量`}
                  value={value.counts[level] || ''}
                  placeholder="0"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => update(level, e.target.value)}
                />
                <span>题</span>
              </label>
              <button
                type="button"
                disabled={value.counts[level] >= 50}
                aria-label={`${levelInfo[level].title}增加5道`}
                onClick={() => update(level, value.counts[level] + 5)}
              >
                <Plus />
              </button>
            </div>
          </article>
        ))}
      </div>
      {value.counts.challenger > 0 && (
        <label className="check-field">
          <input
            type="checkbox"
            checked={value.challengerChain}
            onChange={(e) =>
              onChange({ ...value, challengerChain: e.target.checked })
            }
          />
          <span>
            100 以内加入连加连减<small>例如：61−28＋19</small>
          </span>
        </label>
      )}
      {total > 100 && (
        <p role="alert" className="notice-error">
          多选了 {total - 100} 题，请减少一些。
        </p>
      )}
      {value.counts.abacusMatch === 1 && (
        <p role="alert" className="notice-error">
          连线题至少需要 2 道，才能配成一组。
        </p>
      )}
      <ModePicker
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
      />
    </div>
  );
}

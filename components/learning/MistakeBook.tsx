'use client';
import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Lightbulb,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import {
  buildMistakePractice,
  createRng,
  getMistakeType,
  isMistakeAnswerCorrect,
  mistakeTypes,
  type MistakePractice,
  type MistakeTypeId,
} from '@/lib/mistake-book';

const PRACTICE_COUNT = 5;

function practiceSeed() {
  return Math.floor(Math.random() * 0xffffffff);
}

export function MistakeBook({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState<MistakeTypeId | null>(null);
  const [mode, setMode] = useState<'examples' | 'practice'>('examples');

  if (!selected)
    return (
      <div className="review-page">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft />
          返回首页
        </button>
        <div className="page-heading">
          <div>
            <span className="eyebrow">错题集</span>
            <h1>错过的题，归成几类练</h1>
            <p>每一类都有原来的错题、解题方法，还能随机换题练习。</p>
          </div>
          <span className="count-label">共 {mistakeTypes.length} 类</span>
        </div>
        <div className="review-grid">
          {mistakeTypes.map((type) => (
            <button
              key={type.id}
              className="review-card mistake-type-card"
              onClick={() => {
                setMode('examples');
                setSelected(type.id);
              }}
            >
              <div className="review-meta">
                <span>{type.examples.length} 道错题</span>
              </div>
              <strong>{type.title}</strong>
              <p className="hint-text">{type.summary}</p>
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <MistakeTypeView
      key={`${selected}-${mode}`}
      typeId={selected}
      mode={mode}
      onModeChange={setMode}
      onBack={() => setSelected(null)}
    />
  );
}

function MistakeTypeView({
  typeId,
  mode,
  onModeChange,
  onBack,
}: {
  typeId: MistakeTypeId;
  mode: 'examples' | 'practice';
  onModeChange: (mode: 'examples' | 'practice') => void;
  onBack: () => void;
}) {
  const type = getMistakeType(typeId);
  const [seed, setSeed] = useState(practiceSeed);
  const questions = useMemo<MistakePractice[]>(
    () => buildMistakePractice(typeId, PRACTICE_COUNT, createRng(seed)),
    [typeId, seed],
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [hints, setHints] = useState<Record<string, number>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});

  const check = (question: MistakePractice) => {
    const input = answers[question.id] ?? '';
    if (!input.trim()) return;
    setResults((r) => ({
      ...r,
      [question.id]: isMistakeAnswerCorrect(input, question.answer),
    }));
  };

  const reshuffle = () => {
    setSeed(practiceSeed());
    setAnswers({});
    setResults({});
    setHints({});
    setShown({});
  };

  return (
    <div className="review-page">
      <button className="text-button" onClick={onBack}>
        <ArrowLeft />
        返回错题集
      </button>
      <div className="page-heading">
        <div>
          <span className="eyebrow">错题集</span>
          <h1>{type.title}</h1>
          <p>{type.summary}</p>
        </div>
      </div>
      <div className="topic-tabs" aria-label="错题集视图">
        <button
          aria-pressed={mode === 'examples'}
          onClick={() => onModeChange('examples')}
        >
          看错题和方法
        </button>
        <button
          aria-pressed={mode === 'practice'}
          onClick={() => onModeChange('practice')}
        >
          来练一练
        </button>
      </div>

      {mode === 'examples' ? (
        <>
          <section className="panel content-panel">
            <h2>解题方法</h2>
            {type.method.map((line) => (
              <p className="hint-text" key={line}>
                {line}
              </p>
            ))}
          </section>
          <section className="panel content-panel">
            <h2>原来的错题</h2>
            <div className="review-grid">
              {type.examples.map((example) => (
                <article className="review-card" key={example.question}>
                  <strong>{example.question}</strong>
                  <p className="hint-text">答案：{example.answer}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="page-heading">
            <span className="count-label">
              {Object.values(results).filter(Boolean).length}/{questions.length}{' '}
              题答对
            </span>
            <button className="soft-button" onClick={reshuffle}>
              <RotateCcw />
              换一组题
            </button>
          </div>
          <div className="review-grid">
            {questions.map((question, index) => {
              const hintList = type.method;
              const hintCount = hints[question.id] ?? 0;
              const correct = results[question.id] === true;
              return (
                <article
                  className={`review-card ${correct ? 'review-correct' : ''}`}
                  key={question.id}
                >
                  <div className="review-meta">
                    <span>第 {index + 1} 题</span>
                  </div>
                  <label className="review-expression">
                    <strong>{question.prompt}</strong>
                    <input
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label={`第 ${index + 1} 题的答案`}
                      value={answers[question.id] ?? ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (!/^-?\d{0,6}$/.test(value)) return;
                        setAnswers((a) => ({ ...a, [question.id]: value }));
                        setResults((r) => {
                          const next = { ...r };
                          delete next[question.id];
                          return next;
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          check(question);
                        }
                      }}
                    />
                  </label>
                  <button
                    className="primary-button w-full"
                    disabled={!(answers[question.id] ?? '').trim()}
                    onClick={() => check(question)}
                  >
                    {correct ? (
                      <>
                        <Check />
                        答对了
                      </>
                    ) : results[question.id] === false ? (
                      <>
                        <RefreshCw />
                        再试一次
                      </>
                    ) : (
                      '检查答案'
                    )}
                  </button>
                  <div aria-live="polite">
                    {results[question.id] === false && (
                      <p className="review-feedback">
                        还差一点，看看提示再试试。
                      </p>
                    )}
                  </div>
                  <button
                    className="text-button"
                    onClick={() =>
                      setHints((h) => ({
                        ...h,
                        [question.id]: Math.min(
                          hintList.length,
                          (h[question.id] ?? 0) + 1,
                        ),
                      }))
                    }
                  >
                    <Lightbulb />
                    一点提示
                  </button>
                  {hintList.slice(0, hintCount).map((line) => (
                    <p className="hint-text" key={line}>
                      {line}
                    </p>
                  ))}
                  {hintCount >= hintList.length && (
                    <details
                      open={!!shown[question.id]}
                      onToggle={(e) => {
                        const open = e.currentTarget.open;
                        setShown((s) =>
                          s[question.id] === open
                            ? s
                            : { ...s, [question.id]: open },
                        );
                      }}
                    >
                      <summary>查看答案，再自己算一遍</summary>
                      <p className="hint-text">
                        这道题的答案是 {question.answer}。
                      </p>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

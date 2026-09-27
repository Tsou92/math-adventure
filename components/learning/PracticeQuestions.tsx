'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Abacus } from '@/components/Abacus';
import type {
  AbacusCalculationPrompt,
  AbacusMatchPrompt,
  AbacusMovePrompt,
} from '@/lib/questions';
import type { RoundQuestion } from '@/lib/learning-types';

export const pairColors = ['#7565DD', '#E07186', '#16917F', '#D88A18'];

export function AbacusMoveQuestion({
  question,
  answer,
  onAnswer,
  disabled = false,
}: {
  question: RoundQuestion;
  answer: string;
  onAnswer: (id: string, value: string) => void;
  disabled?: boolean;
}) {
  const prompt = question.promptData as AbacusMovePrompt;
  const currentValue = answer === '' ? 0 : Number(answer);
  return (
    <article className="abacus-move-card">
      <div className="flex items-center justify-between">
        <span className="question-number">{question.position}</span>
        <small className="font-bold text-[#9A8263]">拨出最后的结果</small>
      </div>
      <div className="abacus-move-stage">
        <Abacus value={prompt.startValue} label="起始算盘" />
        <span className="abacus-operation">
          {prompt.operator}
          {prompt.operand}
        </span>
        <div className="grid justify-items-center gap-2">
          <Abacus
            value={currentValue}
            interactive={!disabled}
            showValue
            label={`第 ${question.position} 题作答算盘`}
            onChange={(value) => onAnswer(question.id, String(value))}
          />
          {answer === '' && (
            <button
              className="abacus-zero-button"
              type="button"
              disabled={disabled}
              onClick={() => onAnswer(question.id, '0')}
            >
              确认答案是 0
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function AbacusMatchBoard({
  questions,
  answers,
  onAnswer,
  disabled = false,
}: {
  questions: RoundQuestion[];
  answers: Record<string, string>;
  onAnswer: (id: string, value: string) => void;
  disabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<
    Array<{
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
    }>
  >([]);
  const columnsRef = useRef<HTMLDivElement | null>(null);
  const expressionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const prompt = questions[0]?.promptData as AbacusMatchPrompt | undefined;
  const optionValues = prompt?.optionValues ?? [];
  const selected = questions.find((question) => question.id === selectedId);
  useEffect(() => {
    const drawLines = () => {
      const columns = columnsRef.current;
      if (!columns) return;
      const containerRect = columns.getBoundingClientRect();
      const nextLines = questions.flatMap((question, index) => {
        const value = answers[question.id];
        const from = expressionRefs.current[question.id];
        const to = optionRefs.current[value];
        if (!value || !from || !to) return [];
        const fromRect = from.getBoundingClientRect();
        const toRect = to.getBoundingClientRect();
        return [
          {
            id: question.id,
            x1: fromRect.right - containerRect.left,
            y1: fromRect.top + fromRect.height / 2 - containerRect.top,
            x2: toRect.left - containerRect.left,
            y2: toRect.top + toRect.height / 2 - containerRect.top,
            color: pairColors[index],
          },
        ];
      });
      setLines(nextLines);
    };
    const frame = window.requestAnimationFrame(drawLines);
    const observer = new ResizeObserver(drawLines);
    if (columnsRef.current) observer.observe(columnsRef.current);
    window.addEventListener('resize', drawLines);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', drawLines);
    };
  }, [answers, questions]);
  const assign = (value: number) => {
    if (disabled) return;
    if (!selected) {
      const occupied = questions.find(
        (question) => answers[question.id] === String(value),
      );
      if (occupied) setSelectedId(occupied.id);
      return;
    }
    if (answers[selected.id] === String(value)) {
      onAnswer(selected.id, '');
      setSelectedId(null);
      return;
    }
    const occupied = questions.find(
      (question) =>
        question.id !== selected.id && answers[question.id] === String(value),
    );
    if (occupied) onAnswer(occupied.id, '');
    onAnswer(selected.id, String(value));
    setSelectedId(null);
  };
  return (
    <article className="abacus-match-board">
      <div className="flex items-center justify-between gap-3">
        <strong className="font-title text-base text-[#704457]">
          先点算式，再点正确的算盘
        </strong>
        <small className="font-bold text-[#A08390]">
          {questions.filter((question) => answers[question.id] !== '').length}/
          {questions.length} 已连线
        </small>
      </div>
      <div className="abacus-match-columns" ref={columnsRef}>
        <svg className="abacus-match-lines" aria-hidden="true">
          {lines.map((line) => (
            <line
              key={line.id}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={line.color}
              strokeWidth="5"
              strokeLinecap="round"
            />
          ))}
        </svg>
        <div className="abacus-match-list">
          {questions.map((question, index) => {
            const paired = answers[question.id] !== '';
            return (
              <button
                className={`abacus-match-expression ${selectedId === question.id ? 'selected' : ''} ${paired ? 'paired' : ''}`}
                style={
                  paired
                    ? ({ '--pair-color': pairColors[index] } as CSSProperties)
                    : undefined
                }
                type="button"
                disabled={disabled}
                key={question.id}
                ref={(node) => {
                  expressionRefs.current[question.id] = node;
                }}
                onClick={() =>
                  setSelectedId(selectedId === question.id ? null : question.id)
                }
              >
                <span className="mr-2 text-xs opacity-55">
                  {question.position}
                </span>
                {question.expression}
              </button>
            );
          })}
        </div>
        <div className="abacus-match-list">
          {optionValues.map((value) => {
            const ownerIndex = questions.findIndex(
              (question) => answers[question.id] === String(value),
            );
            return (
              <button
                className={`abacus-match-option ${ownerIndex >= 0 ? 'paired' : ''}`}
                style={
                  ownerIndex >= 0
                    ? ({
                        '--pair-color': pairColors[ownerIndex],
                      } as CSSProperties)
                    : undefined
                }
                type="button"
                disabled={disabled}
                key={value}
                ref={(node) => {
                  optionRefs.current[String(value)] = node;
                }}
                aria-label={`选择这个算盘珠形${ownerIndex >= 0 ? '，已经配对' : ''}`}
                onClick={() => assign(value)}
              >
                <Abacus value={value} compact label="候选算盘" />
              </button>
            );
          })}
        </div>
      </div>
    </article>
  );
}

export function AbacusCalculationQuestion({
  question,
  answer,
  onAnswer,
  disabled = false,
}: {
  question: RoundQuestion;
  answer: string;
  onAnswer: (id: string, value: string) => void;
  disabled?: boolean;
}) {
  const prompt = question.promptData as AbacusCalculationPrompt;
  return (
    <label className="abacus-calculation-card">
      <span className="question-number">{question.position}</span>
      <span className="abacus-calculation-stack">
        <span>{prompt.startValue}</span>
        {prompt.operations.map((operation, index) => (
          <span key={`${operation.operator}-${operation.value}-${index}`}>
            {operation.operator} {operation.value}
          </span>
        ))}
        <span>＝</span>
      </span>
      <input
        inputMode="numeric"
        aria-label={`第 ${question.position} 题答案`}
        value={answer}
        disabled={disabled}
        onChange={(event) => onAnswer(question.id, event.target.value)}
      />
    </label>
  );
}

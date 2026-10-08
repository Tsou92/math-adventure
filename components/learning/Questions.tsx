'use client';
import { useState, useRef, useEffect, type CSSProperties } from 'react';
import type {
  AbacusMovePrompt,
  AbacusMatchPrompt,
  AbacusCalculationPrompt,
} from '@/lib/questions';
import type { RoundQuestion } from '@/lib/types';
import { Abacus } from '@/components/Abacus';
import { AbacusInput } from './AbacusInput';
const pairColors = ['#7565DD', '#E07186', '#16917F', '#D88A18'];
export function AbacusMoveQuestion({
  question,
  answer,
  onAnswer,
}: {
  question: RoundQuestion;
  answer: string;
  onAnswer: (id: string, value: string) => void;
}) {
  const prompt = question.promptData as AbacusMovePrompt;
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
          <AbacusInput
            value={answer}
            label={`第 ${question.position} 题作答算盘`}
            onChange={(value) => onAnswer(question.id, value)}
          />
        </div>
      </div>
    </article>
  );
}

export function AbacusMatchBoard({
  questions,
  answers,
  onAnswer,
}: {
  questions: RoundQuestion[];
  answers: Record<string, string>;
  onAnswer: (id: string, value: string) => void;
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
    setSelectedId(
      questions.find((q) => q.id !== selected.id && !answers[q.id])?.id ?? null,
    );
  };
  return (
    <article className="abacus-match-board">
      <div className="flex items-center justify-between gap-3">
        <strong className="font-title text-base text-[#704457]">
          先点算式，再点正确的算盘
        </strong>
        <small className="font-bold text-[#A08390]">
          {questions.filter((question) => Boolean(answers[question.id])).length}
          /{questions.length} 已连线
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
            const paired = Boolean(answers[question.id]);
            return (
              <button
                className={`abacus-match-expression ${selectedId === question.id ? 'selected' : ''} ${paired ? 'paired' : ''}`}
                style={
                  paired
                    ? ({ '--pair-color': pairColors[index] } as CSSProperties)
                    : undefined
                }
                type="button"
                key={question.id}
                aria-label={`第 ${question.position} 题，${question.expression}${paired ? '，已配对' : ''}`}
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
                key={value}
                ref={(node) => {
                  optionRefs.current[String(value)] = node;
                }}
                aria-label={`选择候选算盘 ${optionValues.indexOf(value) + 1}${ownerIndex >= 0 ? '，已经配对' : ''}`}
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
  onKeyDown,
}: {
  question: RoundQuestion;
  answer: string;
  onAnswer: (id: string, value: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
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
        onKeyDown={onKeyDown}
        enterKeyHint="next"
        aria-label={`第 ${question.position} 题答案`}
        value={answer}
        onChange={(event) => onAnswer(question.id, event.target.value)}
      />
    </label>
  );
}

export function WordProblemQuestion({
  question,
  answer,
  onAnswer,
  onKeyDown,
}: {
  question: RoundQuestion;
  answer: string;
  onAnswer: (id: string, value: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [stepAnswers, setStepAnswers] = useState<string[]>([]);

  const prompt = question.promptData as {
    version: 1;
    story: string;
    steps: Array<{
      type: 'expression' | 'meaning' | 'calculate';
      prompt: string;
      correctAnswer?: string | number;
      options?: string[];
    }>;
  };

  if (!prompt) {
    return (
      <label className="word-problem-card">
        <span className="question-number">{question.position}</span>
        <p className="text-base leading-relaxed mb-4">{question.expression}</p>
        <input
          inputMode="numeric"
          onKeyDown={onKeyDown}
          enterKeyHint="next"
          aria-label={`第 ${question.position} 题答案`}
          value={answer}
          onChange={(event) => onAnswer(question.id, event.target.value)}
          className="w-24 px-3 py-2 border-2 border-indigo-300 rounded-lg text-center text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </label>
    );
  }

  const currentStepData = prompt.steps[currentStep];
  const isLastStep = currentStep === prompt.steps.length - 1;
  const currentStepAnswer = stepAnswers[currentStep] || '';

  const handleStepAnswer = (value: string) => {
    const newAnswers = [...stepAnswers];
    newAnswers[currentStep] = value;
    setStepAnswers(newAnswers);
  };

  const handleNext = () => {
    if (currentStep < prompt.steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // 最后一步，提交答案
      onAnswer(question.id, currentStepAnswer);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceed = currentStepAnswer.trim() !== '';

  return (
    <article className="word-problem-card p-6 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <span className="question-number">{question.position}</span>
        <span className="text-sm font-medium text-indigo-600">
          第 {currentStep + 1} 步 / 共 {prompt.steps.length} 步
        </span>
      </div>

      <div className="mb-6 p-4 bg-white rounded-xl shadow-sm">
        <h3 className="text-sm font-semibold text-gray-600 mb-2">题目</h3>
        <p className="text-base leading-relaxed text-gray-800">{prompt.story}</p>
      </div>

      {currentStep > 0 && (
        <div className="mb-4 p-3 bg-green-50 rounded-lg border border-green-200">
          <h4 className="text-xs font-semibold text-green-700 mb-2">已完成的步骤：</h4>
          {stepAnswers.slice(0, currentStep).map((ans, idx) => (
            <div key={idx} className="text-sm text-green-800 mb-1">
              {prompt.steps[idx].prompt}：<strong>{ans}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 p-4 bg-white rounded-xl shadow-sm">
        <h3 className="text-base font-semibold text-indigo-700 mb-4">
          {currentStepData.prompt}
        </h3>

        {currentStepData.type === 'meaning' && currentStepData.options ? (
          <div className="space-y-3">
            {currentStepData.options.map((option, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleStepAnswer(option)}
                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                  currentStepAnswer === option
                    ? 'border-indigo-500 bg-indigo-50 shadow-md'
                    : 'border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm'
                }`}
              >
                <span className="text-sm leading-relaxed">{option}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <input
              type="text"
              inputMode={currentStepData.type === 'calculate' ? 'numeric' : 'text'}
              value={currentStepAnswer}
              onChange={(e) => handleStepAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canProceed) {
                  handleNext();
                }
              }}
              className="flex-1 px-4 py-3 border-2 border-indigo-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder={currentStepData.type === 'expression' ? '例如：20÷4' : '输入答案'}
            />
          </div>
        )}
      </div>

      <div className="flex gap-3 justify-between">
        <button
          type="button"
          onClick={handleBack}
          disabled={currentStep === 0}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            currentStep === 0
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          上一步
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={!canProceed}
          className={`px-6 py-2 rounded-lg font-medium transition-all ${
            canProceed
              ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          {isLastStep ? '提交答案' : '下一步'}
        </button>
      </div>
    </article>
  );
}


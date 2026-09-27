'use client';

import { BookOpen, Check, PartyPopper, RefreshCw } from 'lucide-react';
import { Abacus } from '@/components/Abacus';
import { scoreMessage } from '@/lib/questions';
import {
  formatAnsweredExpression,
  formatDuration,
} from '@/lib/learning-display';
import type { RecordItem, Round, RoundQuestion } from '@/lib/learning-types';

export function QuestionAnswerSummary({
  question,
}: {
  question: RoundQuestion;
}) {
  if (question.level === 'abacusMove' || question.level === 'abacusMatch')
    return (
      <div className="abacus-review-summary">
        <strong>{question.expression}</strong>
        <span>你的珠形</span>
        <Abacus value={Number(question.answer || 0)} compact label="作答珠形" />
        {!question.isCorrect && question.correctAnswer !== undefined && (
          <>
            <span>正确珠形</span>
            <Abacus
              value={Number(question.correctAnswer)}
              compact
              label="正确珠形"
            />
          </>
        )}
      </div>
    );
  return (
    <strong>
      {formatAnsweredExpression(
        question.expression,
        question.answer,
        question.level,
      )}
    </strong>
  );
}

export function ResultPanel({
  result,
  round,
  onNext,
}: {
  result: RecordItem;
  round: Round;
  onNext: () => void;
}) {
  const message = scoreMessage(
    Number(result.score),
    Number(result.total_count),
  );
  return (
    <div className="space-y-6">
      <section className="hero-panel rounded-[32px] border border-white p-8 text-center shadow-xl">
        <PartyPopper className="mx-auto size-12 text-[#F09B35]" />
        <h1 className="mt-3 font-title text-3xl font-black">{message.title}</h1>
        <p className="mt-2 font-semibold text-[#7E889D]">{message.note}</p>
        <div className="mx-auto mt-6 grid max-w-xl grid-cols-3 gap-3">
          <div className="result-stat">
            <strong>{result.score}</strong>
            <span>得分</span>
          </div>
          <div className="result-stat">
            <strong>
              {result.correct_count}/{result.total_count}
            </strong>
            <span>答对</span>
          </div>
          <div className="result-stat">
            <strong>{formatDuration(result.duration_seconds)}</strong>
            <span>用时</span>
          </div>
        </div>
        <button className="primary-button mt-7" onClick={onNext}>
          <RefreshCw />
          选择下一轮题目
        </button>
      </section>
      <section className="panel p-6">
        <div className="section-title">
          <BookOpen />
          本轮答题详情
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {round.questions.map((q) => (
            <div
              className={`answer-card ${q.isCorrect ? 'correct' : 'wrong'}`}
              key={q.id}
            >
              <span>{q.position}</span>
              <QuestionAnswerSummary question={q} />
              {q.isCorrect ? (
                <Check />
              ) : q.level !== 'abacusMove' && q.level !== 'abacusMatch' ? (
                <small>正确答案 {q.correctAnswer}</small>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

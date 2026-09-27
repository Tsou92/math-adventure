'use client';
import { useState } from 'react';
import { Check, ChevronDown, Trophy } from 'lucide-react';
import { Abacus } from '@/components/Abacus';
import type { RoundQuestion, RecordItem } from '@/lib/types';
import {
  formatDuration,
  formatDate,
  formatTimestamp,
  formatAnsweredExpression,
} from '@/lib/learning';
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

export function PracticeHistory({ records }: { records: RecordItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!records.length)
    return (
      <div className="empty-state">
        <Trophy className="size-8 text-[#F2A334]" />
        <div>
          <strong>第一轮练习，从今天开始</strong>
          <span>完成一轮练习后会记录在这里</span>
        </div>
      </div>
    );
  return (
    <div className="space-y-3">
      {records.map((item) => {
        const isOpen = openId === item.id;
        return (
          <article
            className="overflow-hidden rounded-2xl border border-[#E9EBF3] bg-white"
            key={item.id}
          >
            <button
              className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-[#FAFAFF]"
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenId(isOpen ? null : item.id)}
            >
              <div className="score-dot shrink-0">{item.score}</div>
              <div className="min-w-0 flex-1">
                <strong className="block truncate">{item.package_name}</strong>
                <p className="text-xs font-semibold text-[#8A94A8]">
                  {item.correct_count}/{item.total_count} 题 · 用时{' '}
                  {formatDuration(item.duration_seconds)}
                </p>
              </div>
              <time className="hidden text-xs font-bold text-[#9AA3B4] sm:block">
                {formatDate(item.completed_at)}
              </time>
              <ChevronDown
                className={`size-5 shrink-0 text-[#8D96A9] transition ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {isOpen && (
              <div className="border-t border-[#ECEEF5] bg-[#F8F8FD] p-4">
                <div className="mb-4 grid gap-2 text-xs font-bold text-[#6F7A90] sm:grid-cols-3">
                  <p>
                    <span className="block text-[#A0A8B7]">开始时间</span>
                    {formatTimestamp(item.started_at)}
                  </p>
                  <p>
                    <span className="block text-[#A0A8B7]">结束时间</span>
                    {formatTimestamp(item.completed_at)}
                  </p>
                  <p>
                    <span className="block text-[#A0A8B7]">本轮成绩</span>
                    {item.score} 分 · {item.correct_count}/{item.total_count} 题
                    · {formatDuration(item.duration_seconds)}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {item.questions.map((question) => (
                    <div
                      className={`answer-card ${question.isCorrect ? 'correct' : 'wrong'}`}
                      key={question.id}
                    >
                      <span>{question.position}</span>
                      <QuestionAnswerSummary question={question} />
                      {question.isCorrect ? (
                        <Check />
                      ) : question.level !== 'abacusMove' &&
                        question.level !== 'abacusMatch' ? (
                        <small>正确答案 {question.correctAnswer}</small>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

import { ArrowRight, Check, RefreshCw, Sparkles } from 'lucide-react';
import type { Round, RecordItem } from '@/lib/types';
import { formatDuration } from '@/lib/learning';
import { QuestionAnswerSummary } from './History';
export function Results({
  result,
  round,
  onRepeat,
  onReview,
  onHome,
  busy,
}: {
  result: RecordItem;
  round: Round;
  onRepeat: () => void;
  onReview: () => void;
  onHome: () => void;
  busy: boolean;
}) {
  const wrong = round.questions.filter((q) => !q.isCorrect);
  return (
    <div className="results-page">
      <section className="panel result-hero">
        <span className="reward-symbol">
          <Sparkles />
        </span>
        <span className="eyebrow">
          {round.mode === 'practice' ? '轻松练习完成' : '计时挑战完成'}
        </span>
        <h1>{wrong.length ? '又完成了一次练习！' : '这一轮，全都答对了！'}</h1>
        <p>
          {wrong.length
            ? `答对 ${result.correct_count} 题，还有 ${wrong.length} 题值得再试试。`
            : '认真完成每一道题，就是进步。'}
        </p>
        <div className="summary-stats">
          <div>
            <strong>
              {result.correct_count}/{result.total_count}
            </strong>
            <span>答对题目</span>
          </div>
          <div>
            <strong>{result.score}</strong>
            <span>本轮得分</span>
          </div>
          <div>
            <strong>{formatDuration(result.duration_seconds)}</strong>
            <span>本轮用时</span>
          </div>
        </div>
        <div className="action-row">
          <button
            className="primary-button"
            disabled={busy}
            onClick={wrong.length ? onReview : onRepeat}
          >
            {wrong.length ? '复习这次不会的' : '相同设置再来一轮'}
            <ArrowRight />
          </button>
          {wrong.length > 0 && (
            <button className="soft-button" disabled={busy} onClick={onRepeat}>
              <RefreshCw />
              相同设置再练
            </button>
          )}
          <button className="text-button" onClick={onHome}>
            调整题目
          </button>
        </div>
      </section>
      <section className="panel content-panel">
        <div className="section-heading">
          <h2>本轮答题详情</h2>
          <span className="muted">错题已加入再挑战</span>
        </div>
        <div className="result-answers">
          {round.questions.map((q) => (
            <article
              className={`answer-card ${q.isCorrect ? 'correct' : 'wrong'}`}
              key={q.id}
            >
              <span>{q.position}</span>
              <QuestionAnswerSummary question={q} />
              {q.isCorrect ? (
                <Check aria-label="正确" />
              ) : q.level !== 'abacusMove' && q.level !== 'abacusMatch' ? (
                <small>正确答案 {q.correctAnswer}</small>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

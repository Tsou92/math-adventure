import type { LearningProgress } from '@/lib/types';
import { formatDate, levelInfo } from '@/lib/learning';
export function Progress({ data }: { data: LearningProgress }) {
  const topics = [...data.topics].sort(
    (a, b) =>
      a.correct / Math.max(1, a.attempted) -
      b.correct / Math.max(1, b.attempted),
  );
  return (
    <div className="learning-progress">
      <div className="summary-stats">
        <div>
          <strong>{data.summary.practice_days}</strong>
          <span>练习天数</span>
        </div>
        <div>
          <strong>{data.summary.questions}</strong>
          <span>完成题目</span>
        </div>
        <div>
          <strong>{data.summary.rounds}</strong>
          <span>完成轮数</span>
        </div>
      </div>
      <h3>知识点掌握情况</h3>
      {topics.length ? (
        <div className="topic-progress-list">
          {topics.map((t) => {
            const accuracy = Math.round(
              (t.correct / Math.max(1, t.attempted)) * 100,
            );
            const change =
              t.recent_accuracy !== null && t.previous_accuracy !== null
                ? t.recent_accuracy - t.previous_accuracy
                : null;
            return (
              <article key={t.level}>
                <div className="topic-progress-heading">
                  <strong>{levelInfo[t.level].title}</strong>
                  <span>{accuracy}%</span>
                </div>
                <progress
                  value={t.correct}
                  max={t.attempted}
                  aria-label={`${levelInfo[t.level].title} 正确率 ${accuracy}%`}
                />
                <div className="topic-progress-caption">
                  <span>
                    答对 {t.correct}/{t.attempted} 题
                  </span>
                  {change !== null && (
                    <span>
                      近 7 天较前 7 天 {change > 0 ? '+' : ''}
                      {change} 个百分点
                    </span>
                  )}
                </div>
                {t.attempted >= 5 && accuracy < 80 && (
                  <p className="practice-suggestion">
                    下一次可以先用轻松练习巩固这个知识点。
                  </p>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty-copy">
          完成第一轮练习后，这里就会记录各知识点的进步。
        </p>
      )}
      <p className="muted">
        包含轻松练习与计时挑战；题目难度和提示使用会影响正确率，请结合具体题目看进步。
      </p>
      {data.recent.length > 0 && (
        <>
          <h3>最近练习</h3>
          <div className="recent-progress">
            {data.recent.slice(0, 5).map((r, i) => (
              <div key={`${r.completed_at}-${i}`}>
                <span>{formatDate(r.completed_at)}</span>
                <span>{r.mode === 'practice' ? '轻松练习' : '计时挑战'}</span>
                <strong>
                  答对 {r.correct_count}/{r.total_count}
                </strong>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

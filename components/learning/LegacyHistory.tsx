'use client';
import { useState } from 'react';
import type { LegacyRecord } from '@/lib/types';
import { formatDate, formatDuration } from '@/lib/learning';
export function LegacyHistory() {
  const [records, setRecords] = useState<LegacyRecord[]>([]);
  return (
    <details
      className="panel content-panel legacy-history"
      onToggle={(event) => {
        if (!event.currentTarget.open) return;
        try {
          const saved: unknown = JSON.parse(
            localStorage.getItem('kousuan-planet-records-v1') ?? '[]',
          );
          setRecords(
            Array.isArray(saved)
              ? saved
                  .filter(
                    (item): item is LegacyRecord =>
                      item &&
                      typeof item.id === 'string' &&
                      Number.isFinite(item.score) &&
                      Number.isFinite(item.correctCount) &&
                      Number.isFinite(item.durationSeconds) &&
                      typeof item.completedAt === 'string' &&
                      Number.isFinite(Date.parse(item.completedAt)),
                  )
                  .slice(0, 12)
              : [],
          );
        } catch {
          setRecords([]);
        }
      }}
    >
      <summary>查看本机旧记录</summary>
      <p className="muted">
        升级前保存在当前浏览器里的记录，不会自动归入孩子账号。
      </p>
      {records.length ? (
        <div className="legacy-records">
          {records.map((item) => (
            <article className="record-card" key={item.id}>
              <strong>{item.score} 分</strong>
              <p>
                {item.correctCount}/30 题 ·{' '}
                {formatDuration(item.durationSeconds)}
              </p>
              <span>{formatDate(item.completedAt)}</span>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">当前浏览器没有旧记录。</p>
      )}
    </details>
  );
}

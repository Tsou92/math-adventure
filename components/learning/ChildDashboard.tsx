'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronRight,
  History,
  RefreshCw,
  Sparkles,
  Star,
} from 'lucide-react';
import { api, apiVoid } from '@/lib/api-client';
import { formatAnsweredExpression, formatDate } from '@/lib/learning-display';
import type {
  CreateRoundInput,
  RecordItem,
  Round,
  User,
  WrongItem,
} from '@/lib/learning-types';
import { AppHeader } from './AppHeader';
import { QuestionPicker } from './QuestionPicker';
import { PracticeRound, type PracticeRoundHandle } from './PracticeRound';
import { ResultPanel } from './ResultPanel';
import { PracticeHistory } from './PracticeHistory';
import { WrongBookPractice } from './WrongBookPractice';

export function ChildDashboard({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void | Promise<void>;
}) {
  const [round, setRound] = useState<Round | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [wrong, setWrong] = useState<WrongItem[]>([]);
  const [result, setResult] = useState<RecordItem | null>(null);
  const [showWrongBook, setShowWrongBook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const intentRef = useRef<{ key: string; signature: string } | null>(null);
  const practiceRef = useRef<PracticeRoundHandle | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const loggingOutRef = useRef(false);

  const loadData = useCallback(async () => {
    const [a, r, w] = await Promise.all([
      api<{ round: Round | null }>('rounds/active'),
      api<{ records: RecordItem[] }>('records'),
      api<{ wrongQuestions: WrongItem[] }>('wrong-book'),
    ]);
    setRound(a.round);
    setRecords(r.records);
    setWrong(w.wrongQuestions);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void loadData().catch((issue) =>
          setError(issue instanceof Error ? issue.message : '加载失败'),
        ),
      0,
    );
    return () => clearTimeout(timer);
  }, [loadData]);

  const refreshLookups = useCallback(async () => {
    setRefreshError('');
    try {
      const [r, w] = await Promise.all([
        api<{ records: RecordItem[] }>('records'),
        api<{ wrongQuestions: WrongItem[] }>('wrong-book'),
      ]);
      setRecords(r.records);
      setWrong(w.wrongQuestions);
    } catch (issue) {
      setRefreshError(
        issue instanceof Error ? issue.message : '刷新记录失败，请重试',
      );
    }
  }, []);

  const create = async (input: CreateRoundInput) => {
    setBusy(true);
    setError('');
    const signature = JSON.stringify(input);
    // 同一个出题意图在失败后重试时复用 idempotencyKey，成功后清理。
    let intent = intentRef.current;
    if (!intent || intent.signature !== signature) {
      intent = { key: crypto.randomUUID(), signature };
      intentRef.current = intent;
    }
    try {
      const data = await api<{ round: Round }>('rounds', {
        method: 'POST',
        body: JSON.stringify({ ...input, idempotencyKey: intent.key }),
      });
      intentRef.current = null;
      setRound(data.round);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '出题失败');
    } finally {
      setBusy(false);
    }
  };

  const abandon = async () => {
    if (!round) return;
    try {
      await apiVoid(`rounds/${round.id}/abandon`, { method: 'POST' });
      // 只有服务端确认放弃后才卸载本轮，之前保留未保存数据。
      setRound(null);
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : '操作失败';
      setError(message);
      throw issue instanceof Error ? issue : new Error(message);
    }
  };

  const logout = async () => {
    // 同一次登出请求防重入：状态更新是异步的，用 ref 同步拦截重复点击。
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setError('');
    setLoggingOut(true);
    try {
      // 退出登录会卸载页面，必须先等未保存答案落库；失败则留在本页并提示。
      await practiceRef.current?.flush();
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : '还有答案没有保存成功，请检查网络后重试',
      );
      loggingOutRef.current = false;
      setLoggingOut(false);
      return;
    }
    try {
      await onLogout();
    } finally {
      loggingOutRef.current = false;
      setLoggingOut(false);
    }
  };

  const finished = async (nextResult: RecordItem, nextRound: Round) => {
    // 交卷结果已经拿到，先保留成绩；刷新记录/错题本失败只提示刷新，不回滚。
    setResult(nextResult);
    setRound(nextRound);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await refreshLookups();
  };

  if (showWrongBook)
    return (
      <main className="min-h-screen pb-24">
        <AppHeader user={user} onLogout={logout} disabled={loggingOut} />
        <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
          <WrongBookPractice
            wrong={wrong}
            onBack={() => {
              setShowWrongBook(false);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </div>
      </main>
    );
  return (
    <main className="min-h-screen pb-24">
      <AppHeader user={user} onLogout={logout} disabled={loggingOut} />
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        {error && <p className="notice-error mb-5">{error}</p>}
        {refreshError && (
          <p className="notice-error mb-5">
            <span>{refreshError}</span>
            <button
              type="button"
              className="tiny-button ml-2"
              onClick={() => void refreshLookups()}
            >
              <RefreshCw className="size-3.5" />
              重试刷新记录与错题本
            </button>
          </p>
        )}
        {result && round ? (
          <ResultPanel
            result={result}
            round={round}
            onNext={() => {
              setResult(null);
              setRound(null);
              setRefreshError('');
            }}
          />
        ) : round ? (
          <PracticeRound
            key={round.id}
            ref={practiceRef}
            round={round}
            locked={loggingOut}
            onChanged={setRound}
            onFinished={finished}
            onAbandon={abandon}
          />
        ) : (
          <>
            <section className="hero-panel mb-8 rounded-[32px] border border-white p-7 shadow-[0_24px_70px_rgba(93,78,176,.13)] sm:p-10">
              <span className="eyebrow">
                <Sparkles className="size-4" />
                今天也要闪闪发光
              </span>
              <h1 className="mt-4 font-title text-3xl font-black sm:text-5xl">
                {user.displayName}，选择你的
                <br className="hidden sm:block" />
                数学冒险吧！
              </h1>
              <p className="mt-3 max-w-xl font-semibold text-[#7D879C]">
                选好这轮要练的知识点和题量，出题后再点击“开始答题”，计时才会启动。
              </p>
            </section>
            <QuestionPicker onCreate={create} busy={busy} />
            <div className="mt-8 grid gap-7 lg:grid-cols-2">
              <section className="panel p-6">
                <div className="section-title">
                  <History />
                  最近 5 轮详情 <span>{records.length} 轮</span>
                </div>
                <PracticeHistory records={records} />
              </section>
              <section className="panel p-6">
                <div className="section-title">
                  <BookOpen />
                  错题本 <span>{wrong.length} 题</span>
                </div>
                {wrong.length ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {wrong.slice(0, 10).map((item) => (
                        <article className="wrong-card" key={item.id}>
                          <div className="flex items-center justify-between">
                            <strong>
                              {formatAnsweredExpression(
                                item.expression,
                                item.correct_answer,
                                item.level,
                              )}
                            </strong>
                            <span>错 {item.mistake_count} 次</span>
                          </div>
                          <p>上次回答：{item.last_answer || '未填写'}</p>
                          <time>{formatDate(item.last_seen_at)}</time>
                        </article>
                      ))}
                    </div>
                    <button
                      className="primary-button mt-5 w-full"
                      onClick={() => {
                        setShowWrongBook(true);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      <BookOpen />
                      查看全部 {wrong.length} 道并练习
                      <ChevronRight />
                    </button>
                  </>
                ) : (
                  <div className="empty-state">
                    <Star className="size-8 text-[#F2A334]" />
                    <div>
                      <strong>错题本还是空的</strong>
                      <span>认真答题，争取一直保持哦</span>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

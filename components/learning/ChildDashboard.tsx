'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  History,
  Home,
  RefreshCw,
  Rocket,
  Settings2,
  Star,
} from 'lucide-react';
import type {
  CreateRoundInput,
  LearningPreferences,
  LearningProgress,
  RecordItem,
  Round,
  User,
  WrongItem,
} from '@/lib/types';
import { totalQuestions } from '@/lib/questions';
import {
  defaultPreferences,
  emptyCounts,
  isDue,
  levelInfo,
} from '@/lib/learning';
import { api, apiVoid } from '@/lib/client-api';
import { useLearningView } from '@/hooks/use-learning-view';
import { AppHeader, ErrorNotice, LoadingPanel } from './Shared';
import { ModePicker, QuestionPicker } from './QuestionPicker';
import { PracticeRound, type PracticeRoundHandle } from './PracticeRound';
import { WrongBook } from './WrongBook';
import { PracticeHistory } from './History';
import { Progress } from './Progress';
import { Results } from './Results';
function recordRound(record: RecordItem): Round {
  return {
    id: record.id,
    status: 'completed',
    source: 'custom',
    packageName: record.package_name,
    mode: record.mode ?? 'challenge',
    counts: {
      starter: record.starter_count,
      explorer: record.explorer_count,
      challenger: record.challenger_count,
      multiplyMeaning: record.multiply_meaning_count,
      multiplyFacts: record.multiply_facts_count,
      multiplyMixed: record.multiply_mixed_count ?? 0,
      divisionMeaning: record.division_meaning_count ?? 0,
      divisionFacts: record.division_facts_count ?? 0,
      mixedWordProblem: record.mixed_word_problem_count ?? 0,
      abacusMove: record.abacus_move_count,
      abacusMatch: record.abacus_match_count,
      abacusCalculation: record.abacus_calculation_count,
    },
    totalCount: record.total_count,
    startedAt: record.started_at,
    completedAt: record.completed_at,
    challengerChain: record.questions.some(
      (q) =>
        q.level === 'challenger' &&
        (q.expression.match(/[+−]/g)?.length ?? 0) > 1,
    ),
    questions: record.questions,
  };
}
export default function ChildDashboard({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void | Promise<void>;
}) {
  const [view, navigate] = useLearningView();
  const [round, setRound] = useState<Round | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [wrong, setWrong] = useState<WrongItem[]>([]);
  const [progress, setProgress] = useState<LearningProgress | null>(null);
  const [prefs, setPrefs] = useState<LearningPreferences>(defaultPreferences);
  const [result, setResult] = useState<{
    result: RecordItem;
    round: Round;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [custom, setCustom] = useState(false);
  const [reviewIds, setReviewIds] = useState<Set<string> | null>(null);
  const [refreshError, setRefreshError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const intentRef = useRef<{ key: string; signature: string } | null>(null);
  const practiceRef = useRef<PracticeRoundHandle | null>(null);
  const loggingOutRef = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [a, r, w, p, g] = await Promise.all([
        api<{ round: Round | null }>('rounds/active'),
        api<{ records: RecordItem[] }>('records'),
        api<{ wrongQuestions: WrongItem[] }>('wrong-book'),
        api<{ preferences: LearningPreferences }>('learning/preferences'),
        api<LearningProgress>('learning/progress'),
      ]);
      setRound(a.round);
      setRecords(r.records);
      setWrong(w.wrongQuestions);
      setPrefs(p.preferences);
      setProgress(g);
      if (r.records[0])
        setResult({ result: r.records[0], round: recordRound(r.records[0]) });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const refreshProgress = async () => {
    setRefreshError('');
    try {
      const [r, w, g] = await Promise.all([
        api<{ records: RecordItem[] }>('records'),
        api<{ wrongQuestions: WrongItem[] }>('wrong-book'),
        api<LearningProgress>('learning/progress'),
      ]);
      setRecords(r.records);
      setWrong(w.wrongQuestions);
      setProgress(g);
    } catch (issue) {
      // 交卷结果已经拿到，刷新统计失败只提示重试，绝不回滚成绩。
      setRefreshError(
        issue instanceof Error ? issue.message : '最新统计暂未加载，请重试。',
      );
    }
  };
  const create = async (settings: LearningPreferences) => {
    setBusy(true);
    setError('');
    const input: CreateRoundInput = { ...settings, source: 'custom' };
    // 同一出题意图失败重试时复用幂等 key，成功后清理，避免重复建轮。
    const signature = JSON.stringify(input);
    let intent = intentRef.current;
    if (!intent || intent.signature !== signature) {
      intent = { key: crypto.randomUUID(), signature };
      intentRef.current = intent;
    }
    try {
      await apiVoid('learning/preferences', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      setPrefs(settings);
      const data = await api<{ round: Round }>('rounds', {
        method: 'POST',
        body: JSON.stringify({ ...input, idempotencyKey: intent.key }),
      });
      intentRef.current = null;
      setRound(data.round);
      navigate('practice');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '无法开始，请重试');
      try {
        const active = await api<{ round: Round | null }>('rounds/active');
        setRound(active.round);
      } catch {
        /* Keep the primary error visible. */
      }
    } finally {
      setBusy(false);
    }
  };
  const finished = (next: RecordItem, completed: Round) => {
    // 交卷结果先保留，刷新记录/错题本失败只提示刷新，不回滚成绩。
    setResult({ result: next, round: completed });
    setRound(null);
    navigate('result');
    void refreshProgress();
  };
  const reviewed = (item: WrongItem) =>
    setWrong((current) => current.map((q) => (q.id === item.id ? item : q)));
  const abandon = async () => {
    if (!round) return;
    await apiVoid(`rounds/${round.id}/abandon`, { method: 'POST' });
    setRound(null);
    navigate('home');
  };
  const openReview = () => {
    setReviewIds(null);
    navigate('review');
  };
  const refreshActive = async () => {
    const active = await api<{ round: Round | null }>('rounds/active');
    setRound(active.round);
  };
  const resume = async () => {
    setBusy(true);
    setError('');
    try {
      await refreshActive();
      navigate('practice');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '读取练习失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  const goHome = async () => {
    await refreshActive();
    navigate('home');
  };
  const reviewResult = async () => {
    if (!result) return;
    setBusy(true);
    setError('');
    try {
      const data = await api<{ wrongQuestions: WrongItem[] }>('wrong-book');
      setWrong(data.wrongQuestions);
      const keys = new Set(
        result.round.questions
          .filter((q) => !q.isCorrect)
          .map((q) => `${q.level}:${q.expression}`),
      );
      setReviewIds(
        new Set(
          data.wrongQuestions
            .filter((w) => keys.has(`${w.level}:${w.expression}`))
            .map((w) => w.id),
        ),
      );
      navigate('review');
    } catch (issue) {
      setError(
        issue instanceof Error ? issue.message : '读取本轮错题失败，请重试',
      );
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    // 退出会卸载页面，必须先等未保存答案落库；失败则留在本页提示重试。
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setError('');
    setLoggingOut(true);
    try {
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
  const selected = Object.entries(prefs.counts)
    .filter(([, count]) => count > 0)
    .map(
      ([level, count]) =>
        `${levelInfo[level as keyof typeof levelInfo].title} ${count} 题`,
    );
  const total = totalQuestions(prefs.counts);
  const valid = total > 0 && total <= 100 && prefs.counts.abacusMatch !== 1;
  const content = () => {
    if (loading) return <LoadingPanel />;
    if (view === 'practice' && round)
      return (
        <PracticeRound
          key={round.id}
          ref={practiceRef}
          round={round}
          locked={loggingOut}
          onChanged={setRound}
          onFinished={finished}
          onHome={goHome}
          onAbandon={abandon}
        />
      );
    if (view === 'review')
      return (
        <WrongBook
          key={reviewIds ? 'round' : 'all'}
          items={reviewIds ? wrong.filter((w) => reviewIds.has(w.id)) : wrong}
          onBack={() => navigate('home')}
          onReviewed={reviewed}
        />
      );
    if (view === 'result' && result)
      return (
        <Results
          {...result}
          busy={busy}
          onRepeat={() =>
            void create({
              counts: result.round.counts,
              challengerChain: result.round.challengerChain,
              mode: result.round.mode,
            })
          }
          onReview={() => void reviewResult()}
          onHome={() => {
            setCustom(true);
            navigate('home');
          }}
        />
      );
    if (view === 'history')
      return (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">我的进步</span>
              <h1>每一次认真，都算数</h1>
              <p>跟昨天的自己比，一点点积累。</p>
            </div>
          </div>
          {progress && (
            <section className="panel content-panel">
              <Progress data={progress} />
            </section>
          )}
          <section className="panel content-panel">
            <h2>最近 5 轮答题记录</h2>
            <PracticeHistory records={records} />
          </section>
        </>
      );
    return (
      <>
        <div className="child-welcome">
          <div>
            <span className="eyebrow">今天也练一点点</span>
            <h1>{user.displayName}，准备出发了吗？</h1>
          </div>
          <span className="day-progress">
            <Star />
            已练习 {progress?.summary.practice_days ?? 0} 天
          </span>
        </div>
        {round ? (
          <section className="mission-panel">
            <span className="eyebrow">上次的练习还在这里</span>
            <h2>继续完成这一轮</h2>
            <p>
              {round.questions.filter((q) => q.answer !== '').length}/
              {round.totalCount} 题已经填写。
              {round.mode === 'challenge' && round.startedAt
                ? '计时挑战的计时仍在继续。'
                : '按自己的节奏来。'}
            </p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void resume()}
            >
              继续练习
              <ArrowRight />
            </button>
          </section>
        ) : (
          <section className="mission-panel">
            <div className="mission-copy">
              <span className="eyebrow">你的下一轮</span>
              <h2>{total} 道题，一小步进步</h2>
              <p>{selected.join(' · ') || '展开自选知识点，选好这一轮。'}</p>
              <button
                className="primary-button"
                disabled={busy || !valid || !!error}
                onClick={() => void create(prefs)}
              >
                <Rocket />
                {busy ? '正在准备…' : `开始这 ${total} 题`}
                <ArrowRight />
              </button>
            </div>
            <div className="mission-mode">
              <ModePicker
                value={prefs.mode}
                onChange={(mode) => setPrefs({ ...prefs, mode })}
              />
            </div>
          </section>
        )}
        <div className="home-secondary">
          <button className="review-entry" onClick={openReview}>
            <span className="feature-symbol">
              <BookOpen />
            </span>
            <span>
              <strong>
                {wrong.some((i) => isDue(i))
                  ? `${wrong.filter((i) => isDue(i)).length} 题等你再挑战`
                  : '再挑战'}
              </strong>
              <small>
                {wrong.some((i) => isDue(i))
                  ? '把不会的，再练会一点'
                  : '看看已经练会的题目'}
              </small>
            </span>
            <ArrowRight />
          </button>
          <button className="review-entry" onClick={() => navigate('history')}>
            <span className="feature-symbol warm">
              <Star />
            </span>
            <span>
              <strong>看看我的进步</strong>
              <small>已完成 {progress?.summary.questions ?? 0} 道题</small>
            </span>
            <ArrowRight />
          </button>
        </div>
        {!round && (
          <section className="panel custom-panel">
            <button
              className="custom-toggle"
              aria-expanded={custom}
              aria-controls="custom-questions"
              onClick={() => setCustom(!custom)}
            >
              <span>
                <Settings2 />
                <strong>自己选题</strong>
                <small>调整知识点和题量</small>
              </span>
              <ChevronDown className={custom ? 'rotate-180' : ''} />
            </button>
            {custom && (
              <div id="custom-questions">
                <QuestionPicker value={prefs} onChange={setPrefs} />
                <div className="action-row">
                  <button
                    className="text-button"
                    onClick={() =>
                      setPrefs({
                        ...prefs,
                        counts: { ...emptyCounts, starter: 10 },
                      })
                    }
                  >
                    恢复 10 题基础练习
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      setPrefs({ ...prefs, counts: { ...emptyCounts } })
                    }
                  >
                    清空题量
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
        <div className="home-start-bar">
          <div>
            <strong>{round ? '继续上次练习' : `已选 ${total} 题`}</strong>
            <span>
              {round
                ? '进度已经保存'
                : prefs.mode === 'practice'
                  ? '轻松练习'
                  : '计时挑战'}
            </span>
          </div>
          <button
            className="primary-button"
            disabled={busy || (!round && (!valid || !!error))}
            onClick={() => (round ? void resume() : void create(prefs))}
          >
            {busy ? '准备中…' : round ? '继续' : '开始'}
            <ArrowRight />
          </button>
        </div>
      </>
    );
  };
  return (
    <main
      className={`learning-app child-app ${view === 'practice' && round ? 'in-practice' : ''}`}
    >
      <AppHeader
        user={user}
        onLogout={logout}
        onHome={() => navigate('home')}
        disabled={loggingOut}
      />
      <div className="app-content">
        <ErrorNotice message={error} onRetry={() => void load()} />
        {refreshError && (
          <div role="alert" className="notice-error error-notice">
            <span>{refreshError}</span>
            <button
              type="button"
              className="soft-button"
              onClick={() => void refreshProgress()}
            >
              <RefreshCw />
              重试刷新记录与错题本
            </button>
          </div>
        )}
        {content()}
      </div>
      {!(view === 'practice' && round) && (
        <nav className="bottom-nav" aria-label="主要导航">
          <button
            aria-current={view === 'home' ? 'page' : undefined}
            onClick={() => navigate('home')}
          >
            <Home />
            练习
          </button>
          <button
            aria-current={view === 'review' ? 'page' : undefined}
            onClick={openReview}
          >
            <BookOpen />
            再挑战
          </button>
          <button
            aria-current={view === 'history' ? 'page' : undefined}
            onClick={() => navigate('history')}
          >
            <History />
            进步
          </button>
        </nav>
      )}
    </main>
  );
}

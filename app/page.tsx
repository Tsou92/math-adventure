'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  History,
  KeyRound,
  LogOut,
  PartyPopper,
  Play,
  RefreshCw,
  Rocket,
  Settings2,
  Sparkles,
  Star,
  Target,
  Trophy,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  normalizeQuestionCount,
  scoreMessage,
  totalQuestions,
  type Level,
  type QuestionCounts,
} from '@/lib/questions';

type User = {
  id: string;
  username: string;
  displayName: string;
  role: 'parent' | 'site_owner' | 'child';
  mustChangePassword: boolean;
};
type RoundQuestion = {
  id: string;
  position: number;
  level: Level;
  expression: string;
  answer: string;
  isCorrect?: boolean;
  correctAnswer?: number;
};
type Round = {
  id: string;
  status: 'generated' | 'started' | 'completed';
  source: string;
  packageName: string;
  counts: QuestionCounts;
  totalCount: number;
  startedAt: string | null;
  completedAt: string | null;
  challengerChain: boolean;
  questions: RoundQuestion[];
};
type RecordItem = {
  id: string;
  package_name: string;
  starter_count: number;
  explorer_count: number;
  challenger_count: number;
  multiply_meaning_count: number;
  multiply_facts_count: number;
  total_count: number;
  score: number;
  correct_count: number;
  duration_seconds: number;
  started_at: string;
  completed_at: string;
  questions: RoundQuestion[];
};
type WrongItem = {
  id: string;
  expression: string;
  correct_answer: number;
  level: Level;
  mistake_count: number;
  last_answer: string;
  last_seen_at: string;
};
type ChildItem = {
  id: string;
  username: string;
  display_name: string;
  is_active: boolean;
  must_change_password: boolean;
  round_count: number;
  average_score: number;
  last_practiced_at: string | null;
};
type LegacyRecord = {
  id: string;
  completedAt: string;
  durationSeconds: number;
  score: number;
  correctCount: number;
};
type CreateRoundInput = {
  source: 'custom';
  counts: QuestionCounts;
  challengerChain: boolean;
};

const levelInfo: Record<
  Level,
  { title: string; subtitle: string; tone: string }
> = {
  starter: {
    title: '10 以内加减法',
    subtitle: '基础加减与数感练习',
    tone: 'coral',
  },
  explorer: {
    title: '20 以内加减法',
    subtitle: '进位、退位计算基础',
    tone: 'green',
  },
  challenger: {
    title: '100 以内进退位',
    subtitle: '可选择加入连加连减',
    tone: 'purple',
  },
  multiplyMeaning: {
    title: '乘法启蒙',
    subtitle: '同数连加、几个几、乘数与积',
    tone: 'orange',
  },
  multiplyFacts: {
    title: '表内乘法',
    subtitle: '2～9 的乘法计算',
    tone: 'blue',
  },
};

const emptyCounts: QuestionCounts = {
  starter: 0,
  explorer: 0,
  challenger: 0,
  multiplyMeaning: 0,
  multiplyFacts: 0,
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/${path}`, { ...options, headers });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) throw new Error(data.error ?? '网络开小差了，请再试一次');
  return data as T;
}

function formatDuration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatDate(value: string | null) {
  if (!value) return '还没有练习';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatTimestamp(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function expressionWithAnswerBlank(expression: string, level: Level) {
  if (level !== 'multiplyMeaning' || expression.includes('□')) return expression;
  if (expression.endsWith(' × 几')) return expression.replace(/几$/, '□');
  if (expression.includes('可以看成几个 '))
    return expression.replace('可以看成几个 ', '可以看成 □ 个 ');
  if (expression.endsWith('和是')) return `${expression} □`;
  if (expression.endsWith('一共有')) return `${expression} □ 个`;
  if (expression.endsWith('另一个乘数是')) return `${expression} □`;
  return expression;
}

function splitAnswerBlank(expression: string, level: Level) {
  const normalized = expressionWithAnswerBlank(expression, level);
  const blankIndex = normalized.indexOf('□');
  if (blankIndex < 0) return null;
  return {
    before: normalized.slice(0, blankIndex),
    after: normalized.slice(blankIndex + 1),
  };
}

function formatAnsweredExpression(
  expression: string,
  answer: string | number,
  level: Level,
) {
  const normalized = expressionWithAnswerBlank(expression, level);
  return normalized.includes('□')
    ? normalized.replace('□', String(answer))
    : `${normalized} = ${answer}`;
}

function AppHeader({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <header className="relative z-10 border-b border-white/70 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="grid size-11 -rotate-6 place-items-center rounded-2xl bg-[#6755D9] text-white shadow-[0_7px_0_#4E3DC4]">
            <Rocket className="size-6" />
          </span>
          <div>
            <p className="font-title text-xl font-black">口算星球</p>
            <p className="text-xs font-bold text-[#8B94A7]">
              每天一小步，数学一大步
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-full bg-[#FFF7D9] px-4 py-2 text-sm font-extrabold text-[#A86600] sm:inline-flex">
            <Star className="mr-1 size-4 fill-[#FFC740]" />
            {user.displayName}
          </span>
          <button className="soft-button" onClick={onLogout} title="退出登录">
            <LogOut className="size-4" />
            <span className="hidden sm:inline">退出</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setError('');
    setPassword('');
    setRepeatPassword('');
  };
  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setError('');
    if (mode === 'register' && password !== repeatPassword)
      return setError('两次输入的密码不一致');
    setBusy(true);
    try {
      const data = await api<{ user: User }>(
        mode === 'login' ? 'auth/login' : 'auth/register',
        {
          method: 'POST',
          body: JSON.stringify(
            mode === 'login'
              ? { username, password }
              : { familyName, displayName, username, password },
          ),
        },
      );
      onLogin(data.user);
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : mode === 'login'
            ? '登录失败'
            : '注册失败',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-5 py-12">
      <div className="sky-glow sky-glow-left" />
      <div className="sky-glow sky-glow-right" />
      <section
        className={`hero-panel relative z-10 w-full ${mode === 'register' ? 'max-w-lg' : 'max-w-md'} rounded-[34px] border border-white p-7 shadow-[0_28px_80px_rgba(80,67,160,.18)] sm:p-10`}
      >
        <div className="mb-6 text-center">
          <span className="mx-auto mb-5 grid size-20 -rotate-6 place-items-center rounded-[26px] bg-[#6755D9] text-white shadow-[0_10px_0_#4E3DC4]">
            <Rocket className="size-10" />
          </span>
          <h1 className="font-title text-3xl font-black">欢迎来到口算星球</h1>
          <p className="mt-2 font-semibold text-[#808AA0]">
            {mode === 'login'
              ? '登录账号，开始今天的数学冒险'
              : '注册家长账号，为孩子建立专属学习空间'}
          </p>
        </div>
        <div className="mb-6 grid grid-cols-2 rounded-2xl bg-[#EEEAFB] p-1.5">
          <button
            type="button"
            className={`rounded-xl px-3 py-2.5 text-sm font-black transition ${mode === 'login' ? 'bg-white text-[#5D4CCB] shadow-sm' : 'text-[#858DA0]'}`}
            onClick={() => switchMode('login')}
          >
            登录账号
          </button>
          <button
            type="button"
            className={`rounded-xl px-3 py-2.5 text-sm font-black transition ${mode === 'register' ? 'bg-white text-[#5D4CCB] shadow-sm' : 'text-[#858DA0]'}`}
            onClick={() => switchMode('register')}
          >
            家长注册
          </button>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          {mode === 'register' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field-label">
                家庭名称
                <input
                  autoComplete="organization"
                  value={familyName}
                  onChange={(event) => setFamilyName(event.target.value)}
                  placeholder="例如：小宇的家"
                  maxLength={30}
                  required
                />
              </label>
              <label className="field-label">
                家长称呼
                <input
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="例如：小宇妈妈"
                  maxLength={20}
                  required
                />
              </label>
            </div>
          )}
          <label className="field-label">
            用户名
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="3–24 位中文、字母或数字"
              required
            />
          </label>
          <label className="field-label">
            密码
            <input
              type="password"
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                mode === 'login' ? '请输入密码' : '请设置至少 10 位的密码'
              }
              required
            />
          </label>
          {mode === 'register' && (
            <label className="field-label">
              再次输入密码
              <input
                type="password"
                autoComplete="new-password"
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
                placeholder="请再次输入密码"
                required
              />
            </label>
          )}
          {error && (
            <p className="notice-error">
              <CircleAlert className="size-4 shrink-0" />
              {error}
            </p>
          )}
          <button className="primary-button w-full" disabled={busy}>
            {busy ? (
              mode === 'login' ? (
                '正在登录…'
              ) : (
                '正在创建家庭账号…'
              )
            ) : mode === 'login' ? (
              <>
                进入口算星球 <ChevronRight className="size-5" />
              </>
            ) : (
              <>
                <UserPlus className="size-5" />
                注册并开始使用
              </>
            )}
          </button>
        </form>
        {mode === 'register' ? (
          <div className="mt-5 rounded-2xl bg-[#FFF6D9] px-4 py-3 text-xs font-semibold leading-5 text-[#8D6812]">
            <strong className="block">请牢记家长密码</strong>
            目前不绑定手机或邮箱，忘记家长密码时需要联系站点管理员处理。注册后可为自己的孩子创建独立账号。
          </div>
        ) : (
          <p className="mt-6 text-center text-xs font-semibold text-[#9AA2B2]">
            没有账号？点击上方“家长注册”即可免费创建
          </p>
        )}
      </section>
    </main>
  );
}

function ChangePassword({ user, onDone }: { user: User; onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState('');
  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setMessage('');
    if (newPassword !== repeat) return setMessage('两次输入的新密码不一致');
    try {
      await api('auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onDone();
    } catch (issue) {
      setMessage(issue instanceof Error ? issue.message : '修改失败');
    }
  };
  return (
    <main className="grid min-h-screen place-items-center px-5">
      <section className="panel w-full max-w-md p-7">
        <KeyRound className="mb-4 size-10 text-[#6755D9]" />
        <h1 className="font-title text-2xl font-black">先设置一个新密码</h1>
        <p className="mt-2 text-sm font-semibold text-[#808AA0]">
          这是临时密码首次登录，为了账号安全，请设置你自己的密码。
        </p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="field-label">
            当前密码
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          <label className="field-label">
            新密码（{user.role === 'child' ? '至少 6 位' : '至少 10 位'}）
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </label>
          <label className="field-label">
            再输入一次新密码
            <input
              type="password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
            />
          </label>
          {message && <p className="notice-error">{message}</p>}
          <button className="primary-button w-full">保存新密码</button>
        </form>
      </section>
    </main>
  );
}

function ParentDashboard({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [children, setChildren] = useState<ChildItem[]>([]);
  const [form, setForm] = useState({
    displayName: '',
    username: '',
    password: '',
  });
  const [message, setMessage] = useState('');
  const [legacy, setLegacy] = useState<LegacyRecord[]>([]);
  const load = useCallback(async () => {
    const data = await api<{ children: ChildItem[] }>('parent/children');
    setChildren(data.children);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
      try {
        setLegacy(
          JSON.parse(localStorage.getItem('kousuan-planet-records-v1') ?? '[]'),
        );
      } catch {
        setLegacy([]);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const createChild = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setMessage('');
    try {
      await api('parent/children', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setForm({ displayName: '', username: '', password: '' });
      setMessage('孩子账号创建成功！');
      await load();
    } catch (issue) {
      setMessage(issue instanceof Error ? issue.message : '创建失败');
    }
  };
  const resetPassword = async (child: ChildItem) => {
    const password = window.prompt(
      `请为 ${child.display_name} 设置新密码（至少 6 位）`,
    );
    if (!password) return;
    try {
      await api(`parent/children/${child.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setMessage(`${child.display_name} 的密码已重置，下次登录需修改密码。`);
      await load();
    } catch (issue) {
      setMessage(issue instanceof Error ? issue.message : '重置失败');
    }
  };
  const toggleStatus = async (child: ChildItem) => {
    try {
      await api(`parent/children/${child.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ isActive: !child.is_active }),
      });
      await load();
    } catch (issue) {
      setMessage(issue instanceof Error ? issue.message : '操作失败');
    }
  };
  return (
    <main className="min-h-screen pb-20">
      <AppHeader user={user} onLogout={onLogout} />
      <div className="mx-auto max-w-6xl space-y-7 px-5 py-8 sm:px-8">
        <section className="hero-panel rounded-[32px] border border-white p-7 shadow-[0_20px_60px_rgba(93,78,176,.12)] sm:p-9">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <span className="eyebrow">
                <Users className="size-4" />
                家长管理中心
              </span>
              <h1 className="mt-4 font-title text-3xl font-black sm:text-4xl">
                陪孩子一起收集进步 ✨
              </h1>
              <p className="mt-2 font-semibold text-[#7D879C]">
                创建孩子账号、查看练习概况，并在需要时重置密码。
              </p>
            </div>
            <div className="stat-bubble">
              <strong>{children.length}</strong>
              <span>个孩子账号</span>
            </div>
          </div>
        </section>
        <div className="grid gap-7 lg:grid-cols-[1fr_360px]">
          <section className="panel p-6">
            <div className="section-title">
              <Users />
              孩子账号
            </div>
            {message && (
              <p className="mb-4 rounded-2xl bg-[#F0EDFF] p-3 text-sm font-bold text-[#6755D9]">
                {message}
              </p>
            )}
            <div className="space-y-3">
              {children.length ? (
                children.map((child) => (
                  <article className="child-card" key={child.id}>
                    <div className="avatar">
                      {child.display_name.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <strong className="font-title">
                          {child.display_name}
                        </strong>
                        <span
                          className={
                            child.is_active ? 'status-on' : 'status-off'
                          }
                        >
                          {child.is_active ? '使用中' : '已停用'}
                        </span>
                      </div>
                      <p className="truncate text-xs font-semibold text-[#8A94A8]">
                        用户名：{child.username} · 已完成 {child.round_count} 轮
                        · 平均 {child.average_score} 分
                      </p>
                      <p className="mt-1 text-xs text-[#A0A8B7]">
                        最近：{formatDate(child.last_practiced_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="tiny-button"
                        onClick={() => resetPassword(child)}
                      >
                        <KeyRound />
                        重置密码
                      </button>
                      <button
                        className="tiny-button"
                        onClick={() => toggleStatus(child)}
                      >
                        {child.is_active ? '停用' : '启用'}
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <UserPlus className="size-8 text-[#7565DD]" />
                  <div>
                    <strong>还没有孩子账号</strong>
                    <span>在右侧创建第一个账号吧</span>
                  </div>
                </div>
              )}
            </div>
          </section>
          <section className="panel p-6">
            <div className="section-title">
              <UserPlus />
              创建孩子账号
            </div>
            <form className="space-y-4" onSubmit={createChild}>
              <label className="field-label">
                孩子昵称
                <input
                  value={form.displayName}
                  onChange={(e) =>
                    setForm({ ...form, displayName: e.target.value })
                  }
                  placeholder="例如：小宇"
                  required
                />
              </label>
              <label className="field-label">
                登录用户名
                <input
                  value={form.username}
                  onChange={(e) =>
                    setForm({ ...form, username: e.target.value })
                  }
                  placeholder="3–24 位，不可重复"
                  required
                />
              </label>
              <label className="field-label">
                初始密码
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  placeholder="至少 6 位"
                  required
                />
              </label>
              <button className="primary-button w-full">
                <UserPlus />
                创建账号
              </button>
            </form>
          </section>
        </div>
        <section className="panel p-6">
          <div className="section-title">
            <History />
            本机旧记录
          </div>
          <p className="mb-4 text-sm font-semibold text-[#8A94A8]">
            这里只展示升级前保存在当前浏览器里的记录，不会自动归入任何孩子账号。
          </p>
          {legacy.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {legacy.slice(0, 12).map((item) => (
                <div className="record-card" key={item.id}>
                  <strong>{item.score} 分</strong>
                  <p>
                    {item.correctCount}/30 题 ·{' '}
                    {formatDuration(item.durationSeconds)}
                  </p>
                  <span>{formatDate(item.completedAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm font-bold text-[#A0A8B7]">
              当前浏览器没有旧记录
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function QuestionPicker({
  onCreate,
  busy,
}: {
  onCreate: (input: CreateRoundInput) => void;
  busy: boolean;
}) {
  const [counts, setCounts] = useState<QuestionCounts>(() => ({
    ...emptyCounts,
  }));
  const [challengerChain, setChallengerChain] = useState(false);
  const total = totalQuestions(counts);
  const changeCount = (level: Level, delta: number) => {
    setCounts((current) => ({
      ...current,
      [level]: normalizeQuestionCount(current[level] + delta),
    }));
  };
  const typeCount = (level: Level, value: string) => {
    setCounts((current) => ({
      ...current,
      [level]: normalizeQuestionCount(value),
    }));
  };
  return (
    <section className="panel p-6 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="eyebrow">
            <Settings2 className="size-4" />
            自选知识点
          </span>
          <h2 className="mt-3 font-title text-2xl font-black">
            这轮想练什么？
          </h2>
          <p className="mt-2 text-sm font-semibold text-[#8993A7]">
            每类最多 50 道，本轮合计不超过 100 道。
          </p>
        </div>
        <div className="stat-bubble compact">
          <strong>{total}</strong>
          <span>道题</span>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(levelInfo) as Level[]).map((level) => (
          <article
            className={`count-card tone-${levelInfo[level].tone}`}
            key={level}
          >
            <span>{levelInfo[level].title}</span>
            <small>{levelInfo[level].subtitle}</small>
            <div>
              <button
                type="button"
                aria-label={`${levelInfo[level].title}减少10道`}
                onClick={() => changeCount(level, -10)}
              >
                −10
              </button>
              <button
                type="button"
                aria-label={`${levelInfo[level].title}减少5道`}
                onClick={() => changeCount(level, -5)}
              >
                −5
              </button>
              <input
                aria-label={`${levelInfo[level].title}题目数量`}
                type="number"
                inputMode="numeric"
                min="0"
                max="50"
                placeholder="0"
                value={counts[level] || ''}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => typeCount(level, event.target.value)}
              />
              <button
                type="button"
                aria-label={`${levelInfo[level].title}增加5道`}
                onClick={() => changeCount(level, 5)}
              >
                ＋5
              </button>
              <button
                type="button"
                aria-label={`${levelInfo[level].title}增加10道`}
                onClick={() => changeCount(level, 10)}
              >
                ＋10
              </button>
            </div>
          </article>
        ))}
      </div>
      {counts.challenger > 0 && (
        <div
          className={`mt-5 flex items-start gap-3 rounded-2xl border-2 p-4 transition ${challengerChain ? 'border-[#7565DD] bg-[#F3F0FF]' : 'border-[#E5E8F1] bg-white'}`}
        >
          <input
            aria-label="加入连加连减"
            className="mt-1 size-5 cursor-pointer accent-[#6755D9]"
            type="checkbox"
            checked={challengerChain}
            onChange={(event) => setChallengerChain(event.target.checked)}
          />
          <span>
            <strong className="font-title text-[#3D4960]">加入连加连减</strong>
            <small className="mt-1 block font-semibold leading-5 text-[#8993A7]">
              不勾选：91−68、38＋48；勾选后：61−28＋19
            </small>
          </span>
        </div>
      )}
      <button
        className="primary-button mt-6 w-full sm:w-auto"
        disabled={busy || total < 1 || total > 100}
        onClick={() => onCreate({ source: 'custom', counts, challengerChain })}
      >
        <Rocket />
        按所选知识点出题（{total} 道）
      </button>
      {total > 100 && (
        <p className="notice-error mt-4">本轮最多 100 道，请减少一些题目。</p>
      )}
    </section>
  );
}

function PracticeRound({
  round,
  onChanged,
  onFinished,
  onAbandon,
}: {
  round: Round;
  onChanged: (round: Round) => void;
  onFinished: (result: RecordItem, round: Round) => void;
  onAbandon: () => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(round.questions.map((q) => [q.id, q.answer ?? ''])),
  );
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (round.status !== 'started' || !round.startedAt) return;
    const tick = () =>
      setElapsed(
        Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(round.startedAt!).getTime()) / 1000,
          ),
        ),
      );
    tick();
    const timer = window.setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [round.status, round.startedAt]);
  const save = useCallback(
    async (next: Record<string, string>) => {
      const list = Object.entries(next).map(([questionId, answer]) => ({
        questionId,
        answer,
      }));
      if (list.length)
        await api(`rounds/${round.id}/answers`, {
          method: 'PATCH',
          body: JSON.stringify({ answers: list }),
        });
    },
    [round.id],
  );
  const updateAnswer = (id: string, value: string) => {
    if (!/^-?\d{0,4}$/.test(value)) return;
    const next = { ...answers, [id]: value };
    setAnswers(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(
      () =>
        void save(next).catch(() => setError('答案暂时没有保存，请检查网络')),
      700,
    );
  };
  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ round: Round }>(`rounds/${round.id}/start`, {
        method: 'POST',
      });
      onChanged(data.round);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '开始失败');
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await save(answers);
      const data = await api<{ result: RecordItem; round: Round }>(
        `rounds/${round.id}/submit`,
        { method: 'POST' },
      );
      onFinished(data.result, data.round);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '交卷失败');
    } finally {
      setBusy(false);
    }
  };
  const exitRound = async () => {
    if (!window.confirm('确定退出本轮答题吗？本轮计时和答案不会计入成绩。'))
      return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setBusy(true);
    await onAbandon();
    setBusy(false);
  };
  const answered = Object.values(answers).filter(
    (value) => value.trim() !== '',
  ).length;
  if (round.status === 'generated')
    return (
      <section className="hero-panel rounded-[32px] border border-white p-7 text-center shadow-[0_24px_70px_rgba(93,78,176,.14)] sm:p-12">
        <span className="mx-auto grid size-24 place-items-center rounded-full bg-[#F0EDFF] text-5xl">
          🚀
        </span>
        <h1 className="mt-6 font-title text-3xl font-black">
          {round.packageName} 已准备好！
        </h1>
        <p className="mx-auto mt-3 max-w-lg font-semibold text-[#7E889D]">
          本轮共 {round.totalCount} 道题。点击开始后题目才会出现，同时开始计时。
        </p>
        <div className="mx-auto mt-5 flex max-w-md flex-wrap justify-center gap-2">
          {(Object.keys(levelInfo) as Level[]).map(
            (level) =>
              round.counts[level] > 0 && (
                <span className="count-pill" key={level}>
                  {levelInfo[level].title} {round.counts[level]} 道
                </span>
              ),
          )}
        </div>
        {error && <p className="notice-error mx-auto mt-4 max-w-md">{error}</p>}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button className="soft-button" onClick={onAbandon}>
            重新选择题目
          </button>
          <button className="primary-button" disabled={busy} onClick={start}>
            <Play />
            开始答题并计时
          </button>
        </div>
      </section>
    );
  return (
    <div className="space-y-6">
      <section className="sticky top-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white bg-white/90 p-4 shadow-lg backdrop-blur">
        <div>
          <span className="text-xs font-bold text-[#939CAF]">正在挑战</span>
          <h1 className="font-title text-xl font-black">{round.packageName}</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            className="soft-button px-3 py-2 text-xs"
            disabled={busy}
            onClick={exitRound}
          >
            <LogOut className="size-4" />
            退出本轮
          </button>
          <span className="timer">
            <Clock3 />
            {formatDuration(elapsed)}
          </span>
          <span className="progress-text">
            {answered}/{round.totalCount}
          </span>
        </div>
      </section>
      {error && <p className="notice-error">{error}</p>}
      <div className="space-y-7">
        {(Object.keys(levelInfo) as Level[]).map((level) => {
          const questions = round.questions.filter((q) => q.level === level);
          if (!questions.length) return null;
          return (
            <section className="panel p-5 sm:p-7" key={level}>
              <div className={`level-heading tone-${levelInfo[level].tone}`}>
                <Target />
                <div>
                  <strong>{levelInfo[level].title}</strong>
                  <span>
                    {levelInfo[level].subtitle} · {questions.length} 道
                  </span>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {questions.map((question) => {
                  const blank = splitAnswerBlank(
                    question.expression,
                    question.level,
                  );
                  const answerInput = (
                    <input
                      inputMode="numeric"
                      aria-label={`第 ${question.position} 题答案`}
                      value={answers[question.id] ?? ''}
                      onChange={(e) =>
                        updateAnswer(question.id, e.target.value)
                      }
                    />
                  );
                  return (
                    <label
                      className={`question-card ${blank ? 'question-card-concept' : ''}`}
                      key={question.id}
                    >
                      <span className="question-number">
                        {question.position}
                      </span>
                      {blank ? (
                        <span className="inline-question-prompt">
                          <strong>{blank.before}</strong>
                          {answerInput}
                          {blank.after && <strong>{blank.after}</strong>}
                        </span>
                      ) : (
                        <>
                          <strong>{question.expression} =</strong>
                          {answerInput}
                        </>
                      )}
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[#26334A] p-5 text-white">
        <div>
          <strong className="font-title text-lg">答完就交卷吧！</strong>
          <p className="text-xs text-white/65">
            已完成 {answered}/{round.totalCount} 道
          </p>
        </div>
        <button
          className="primary-button bg-[#FFC740] text-[#6A4800] shadow-[0_6px_0_#D99E00]"
          disabled={busy || answered !== round.totalCount}
          onClick={submit}
        >
          <Check />
          {busy ? '正在批改…' : '提交并查看成绩'}
        </button>
      </div>
    </div>
  );
}

function ResultPanel({
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
              <strong>
                {formatAnsweredExpression(q.expression, q.answer, q.level)}
              </strong>
              {q.isCorrect ? (
                <Check />
              ) : (
                <small>正确答案 {q.correctAnswer}</small>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PracticeHistory({ records }: { records: RecordItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!records.length)
    return (
      <div className="empty-state">
        <Trophy className="size-8 text-[#F2A334]" />
        <div>
          <strong>第一枚奖章等你来拿</strong>
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
                      <strong>
                        {formatAnsweredExpression(
                          question.expression,
                          question.answer,
                          question.level,
                        )}
                      </strong>
                      {question.isCorrect ? (
                        <Check />
                      ) : (
                        <small>正确答案 {question.correctAnswer}</small>
                      )}
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

function WrongBookPractice({
  wrong,
  onBack,
}: {
  wrong: WrongItem[];
  onBack: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, boolean | undefined>>(
    {},
  );
  const mastered = Object.values(results).filter(
    (result) => result === true,
  ).length;
  const attempted = Object.values(results).filter(
    (result) => result !== undefined,
  ).length;
  const updateAnswer = (id: string, value: string) => {
    if (!/^-?\d{0,4}$/.test(value)) return;
    setAnswers((current) => ({ ...current, [id]: value }));
    setResults((current) => ({ ...current, [id]: undefined }));
  };
  const checkAnswer = (item: WrongItem) => {
    const answer = answers[item.id];
    if (!answer?.trim()) return;
    setResults((current) => ({
      ...current,
      [item.id]: Number(answer) === Number(item.correct_answer),
    }));
  };
  return (
    <div className="space-y-6">
      <section className="hero-panel rounded-[32px] border border-white p-6 shadow-[0_24px_70px_rgba(93,78,176,.13)] sm:p-9">
        <button className="soft-button mb-6" onClick={onBack}>
          <ChevronRight className="rotate-180" />
          返回练习首页
        </button>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <span className="eyebrow">
              <BookOpen className="size-4" />
              错题再挑战
            </span>
            <h1 className="mt-4 font-title text-3xl font-black sm:text-4xl">
              把不会的，练成最拿手的！
            </h1>
            <p className="mt-2 font-semibold text-[#7D879C]">
              先自己重新计算，再点击“检查答案”。答错了也没关系，可以一直重试。
            </p>
          </div>
          <div className="flex gap-3">
            <div className="stat-bubble compact">
              <strong>{mastered}</strong>
              <span>本次答对</span>
            </div>
            <div className="stat-bubble compact">
              <strong>
                {attempted}/{wrong.length}
              </strong>
              <span>已经检查</span>
            </div>
          </div>
        </div>
      </section>
      {wrong.length ? (
        <section className="panel p-5 sm:p-7">
          <div className="section-title">
            <Target />
            全部错题 <span>{wrong.length} 题</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {wrong.map((item, index) => {
              const result = results[item.id];
              const blank = splitAnswerBlank(item.expression, item.level);
              const answerInput = (
                <input
                  className="min-w-0 flex-1 rounded-xl border-2 border-[#DFE3ED] bg-white px-3 py-2 text-center text-lg font-black outline-none transition focus:border-[#7565DD]"
                  inputMode="numeric"
                  aria-label={`${item.expression} 的答案`}
                  value={answers[item.id] ?? ''}
                  onChange={(event) =>
                    updateAnswer(item.id, event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') checkAnswer(item);
                  }}
                />
              );
              return (
                <article
                  className={`rounded-2xl border-2 p-4 transition ${result === true ? 'border-[#8AD6A8] bg-[#F0FFF5]' : result === false ? 'border-[#FFAAA0] bg-[#FFF4F2]' : 'border-[#E8EAF2] bg-white'}`}
                  key={item.id}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="question-number">{index + 1}</span>
                    <small className="font-bold text-[#9AA3B4]">
                      曾错 {item.mistake_count} 次
                    </small>
                  </div>
                  {blank ? (
                    <div className="inline-wrong-prompt">
                      <strong>{blank.before}</strong>
                      {answerInput}
                      {blank.after && <strong>{blank.after}</strong>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <strong className="whitespace-nowrap font-title text-lg text-[#354158]">
                        {item.expression} =
                      </strong>
                      {answerInput}
                    </div>
                  )}
                  <button
                    className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-black transition ${result === true ? 'bg-[#36B66B] text-white' : 'bg-[#ECE9FF] text-[#6755D9] hover:bg-[#DFDAFF]'}`}
                    disabled={!answers[item.id]?.trim()}
                    onClick={() => checkAnswer(item)}
                  >
                    {result === true ? (
                      <>
                        <Check className="size-4" />
                        答对了！
                      </>
                    ) : result === false ? (
                      <>
                        <RefreshCw className="size-4" />
                        再试一次
                      </>
                    ) : (
                      '检查答案'
                    )}
                  </button>
                  {result === false && (
                    <p className="mt-2 text-center text-xs font-bold text-[#E56F63]">
                      还不对，换个思路再算一次吧
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="panel p-6">
          <div className="empty-state">
            <Trophy className="size-8 text-[#F2A334]" />
            <div>
              <strong>错题已经全部掌握</strong>
              <span>继续保持，你真棒！</span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function ChildDashboard({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [round, setRound] = useState<Round | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [wrong, setWrong] = useState<WrongItem[]>([]);
  const [result, setResult] = useState<RecordItem | null>(null);
  const [showWrongBook, setShowWrongBook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
  const create = async (input: CreateRoundInput) => {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ round: Round }>('rounds', {
        method: 'POST',
        body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }),
      });
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
      await api(`rounds/${round.id}/abandon`, { method: 'POST' });
      setRound(null);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '操作失败');
    }
  };
  const finished = async (nextResult: RecordItem, nextRound: Round) => {
    setResult(nextResult);
    setRound(nextRound);
    const [r, w] = await Promise.all([
      api<{ records: RecordItem[] }>('records'),
      api<{ wrongQuestions: WrongItem[] }>('wrong-book'),
    ]);
    setRecords(r.records);
    setWrong(w.wrongQuestions);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  if (showWrongBook)
    return (
      <main className="min-h-screen pb-24">
        <AppHeader user={user} onLogout={onLogout} />
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
      <AppHeader user={user} onLogout={onLogout} />
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        {error && <p className="notice-error mb-5">{error}</p>}
        {result && round ? (
          <ResultPanel
            result={result}
            round={round}
            onNext={() => {
              setResult(null);
              setRound(null);
            }}
          />
        ) : round ? (
          <PracticeRound
            round={round}
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

export default function Home() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    void api<{ user: User | null }>('auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);
  const logout = async () => {
    await api('auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
  };
  if (user === undefined)
    return (
      <main className="grid min-h-screen place-items-center">
        <div className="text-center">
          <Rocket className="mx-auto size-10 animate-bounce text-[#6755D9]" />
          <p className="mt-3 font-title font-black">正在飞往口算星球…</p>
        </div>
      </main>
    );
  if (!user) return <Login onLogin={setUser} />;
  if (user.mustChangePassword)
    return (
      <ChangePassword
        user={user}
        onDone={() => setUser({ ...user, mustChangePassword: false })}
      />
    );
  if (user.role === 'child')
    return <ChildDashboard user={user} onLogout={logout} />;
  return <ParentDashboard user={user} onLogout={logout} />;
}

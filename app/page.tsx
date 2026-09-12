'use client';
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@/lib/types';
import { api } from '@/lib/client-api';
import { ChangePassword, Login } from '@/components/learning/Auth';
import { ErrorNotice, LoadingPanel } from '@/components/learning/Shared';
const ChildDashboard = lazy(
  () => import('@/components/learning/ChildDashboard'),
);
const ParentDashboard = lazy(
  () => import('@/components/learning/ParentDashboard'),
);
class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="auth-page">
          <section className="auth-panel">
            <h1>页面没有顺利打开</h1>
            <p>已保存的学习记录不会丢失，请重新加载。</p>
            <button
              className="primary-button"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
          </section>
        </main>
      );
    return this.props.children;
  }
}
function LearningApp() {
  const [user, setUser] = useState<User | null>();
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api<{ user: User | null }>('auth/me');
      setUser(data.user);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '登录状态暂时无法读取');
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const login = (next: User) => {
    window.history.replaceState(null, '', '#home');
    setUser(next);
    setError('');
  };
  const logout = async () => {
    try {
      await api('auth/logout', { method: 'POST' });
      window.history.replaceState(null, '', '#home');
      setUser(null);
      setError('');
    } catch {
      setError('退出没有成功，请检查网络后重试。');
    }
  };
  if (user === undefined)
    return (
      <main className="auth-page">
        <section className="auth-panel">
          {error ? (
            <ErrorNotice message={error} onRetry={() => void load()} />
          ) : (
            <LoadingPanel />
          )}
        </section>
      </main>
    );
  if (!user) return <Login onLogin={login} />;
  if (user.mustChangePassword)
    return (
      <>
        <ErrorNotice message={error} />
        <ChangePassword
          onLogout={() => void logout()}
          user={user}
          onDone={() => setUser({ ...user, mustChangePassword: false })}
        />
      </>
    );
  return (
    <>
      <ErrorNotice message={error} />
      <Suspense
        fallback={
          <main className="app-content">
            <LoadingPanel />
          </main>
        }
      >
        {user.role === 'child' ? (
          <ChildDashboard
            key={user.id}
            user={user}
            onLogout={() => void logout()}
          />
        ) : (
          <ParentDashboard
            key={user.id}
            user={user}
            onLogout={() => void logout()}
            onSwitch={login}
          />
        )}
      </Suspense>
    </>
  );
}
export default function Home() {
  return (
    <AppErrorBoundary>
      <LearningApp />
    </AppErrorBoundary>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { CircleAlert, Rocket } from 'lucide-react';
import { api, apiVoid } from '@/lib/api-client';
import type { User } from '@/lib/learning-types';
import { ChangePassword, Login } from '@/components/learning/Auth';
import { ChildDashboard } from '@/components/learning/ChildDashboard';
import { ParentDashboard } from '@/components/learning/ParentDashboard';

export default function Home() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [logoutError, setLogoutError] = useState('');
  useEffect(() => {
    void api<{ user: User | null }>('auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);
  const logout = async () => {
    setLogoutError('');
    try {
      // 退出接口没有响应体；只有请求真正成功才清除本地登录态。
      await apiVoid('auth/logout', { method: 'POST' });
      setUser(null);
    } catch (issue) {
      setLogoutError(
        issue instanceof Error ? issue.message : '退出登录失败，请重试',
      );
    }
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
  return (
    <>
      {logoutError && (
        <div className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-[#FFF1EF] px-4 py-3 text-sm font-bold text-[#C0493C] shadow-lg">
          <CircleAlert className="size-4" />
          <span>{logoutError}</span>
          <button
            type="button"
            className="tiny-button"
            onClick={() => setLogoutError('')}
          >
            关闭
          </button>
        </div>
      )}
      {user.role === 'child' ? (
        <ChildDashboard user={user} onLogout={logout} />
      ) : (
        <ParentDashboard user={user} onLogout={logout} />
      )}
    </>
  );
}

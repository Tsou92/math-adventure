'use client';

import { useCallback, useEffect, useState } from 'react';
import { History, KeyRound, UserPlus, Users } from 'lucide-react';
import { AppHeader } from './AppHeader';
import { api, apiVoid } from '@/lib/api-client';
import {
  formatDate,
  formatDuration,
  parseLegacyRecords,
} from '@/lib/learning-display';
import type { ChildItem, LegacyRecord, User } from '@/lib/learning-types';

export function ParentDashboard({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void | Promise<void>;
}) {
  const [children, setChildren] = useState<ChildItem[]>([]);
  const [form, setForm] = useState({
    displayName: '',
    username: '',
    password: '',
  });
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [legacy, setLegacy] = useState<LegacyRecord[]>([]);
  const load = useCallback(async () => {
    const data = await api<{ children: ChildItem[] }>('parent/children');
    setChildren(data.children);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((issue) =>
        setLoadError(issue instanceof Error ? issue.message : '加载失败'),
      );
      setLegacy(
        parseLegacyRecords(localStorage.getItem('kousuan-planet-records-v1')),
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const createChild = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setMessage('');
    try {
      await apiVoid('parent/children', {
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
      await apiVoid(`parent/children/${child.id}/reset-password`, {
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
      await apiVoid(`parent/children/${child.id}/status`, {
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
        {loadError && <p className="notice-error">{loadError}</p>}
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

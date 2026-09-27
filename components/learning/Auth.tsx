'use client';

import { useState } from 'react';
import {
  ChevronRight,
  CircleAlert,
  KeyRound,
  Rocket,
  UserPlus,
} from 'lucide-react';
import { api, apiVoid } from '@/lib/api-client';
import type { User } from '@/lib/learning-types';

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
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

export function ChangePassword({
  user,
  onDone,
}: {
  user: User;
  onDone: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState('');
  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setMessage('');
    if (newPassword !== repeat) return setMessage('两次输入的新密码不一致');
    try {
      await apiVoid('auth/change-password', {
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

'use client';
import { useState } from 'react';
import { ArrowRight, Download, KeyRound, Rocket } from 'lucide-react';
import type { User } from '@/lib/types';
import { api, apiVoid } from '@/lib/client-api';
import { ErrorNotice, PasswordField } from './Shared';

export function RecoveryReceipt({
  code,
  username,
  onDone,
}: {
  code: string;
  username: string;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const download = () => {
    const blob = new Blob(
      [
        `数学星球账号恢复码\n用户名：${username}\n恢复码：${code}\n请离线妥善保存，不要发给他人。每个恢复码只能使用一次。\n`,
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '数学星球-账号恢复码.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
  };
  return (
    <div className="recovery-receipt">
      <KeyRound />
      <h2>保存你的账号恢复码</h2>
      <p>忘记家长密码时，可以用它重设密码。只显示这一次，请离线保管。</p>
      <code>{code}</code>
      <button className="primary-button w-full" onClick={download}>
        <Download />
        下载恢复码
      </button>
      <label className="check-field">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        <span>我已经下载或抄写保存</span>
      </label>
      <button className="soft-button w-full" disabled={!saved} onClick={onDone}>
        已保存，继续
        <ArrowRight />
      </button>
    </div>
  );
}
export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'recover'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    user: User;
    recoveryCode: string;
  } | null>(null);
  const [remember, setRemember] = useState(false);
  const [known, setKnown] = useState<string[]>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem('planet-usernames') ?? '[]',
      );
      return Array.isArray(value)
        ? value.filter((v) => typeof v === 'string').slice(0, 4)
        : [];
    } catch {
      return [];
    }
  });
  const switchMode = (next: typeof mode) => {
    setMode(next);
    setError('');
    setNotice('');
    setPassword('');
    setRepeat('');
    setCode('');
  };
  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setError('');
    if (mode !== 'login' && password !== repeat) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'recover') {
        await apiVoid('auth/recover', {
          method: 'POST',
          body: JSON.stringify({ username, code, password }),
        });
        switchMode('login');
        setNotice('密码已重设，请用新密码登录。登录后请生成新的恢复码。');
        return;
      }
      const data = await api<{ user: User; recoveryCode?: string }>(
        mode === 'login' ? 'auth/login' : 'auth/register',
        {
          method: 'POST',
          body: JSON.stringify(
            mode === 'login'
              ? { username, password }
              : {
                  username,
                  password,
                  displayName: displayName.trim() || '家长',
                  familyName: familyName.trim() || '我的家庭',
                },
          ),
        },
      );
      if (mode === 'login' && remember) {
        const next = [
          data.user.username,
          ...known.filter((n) => n !== data.user.username),
        ].slice(0, 4);
        try {
          localStorage.setItem('planet-usernames', JSON.stringify(next));
        } catch {
          /* Remembering a username is optional. */
        }
        setKnown(next);
      }
      setPassword('');
      setRepeat('');
      if (data.recoveryCode)
        setPending({ user: data.user, recoveryCode: data.recoveryCode });
      else onLogin(data.user);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-panel">
        {pending ? (
          <RecoveryReceipt
            code={pending.recoveryCode}
            username={pending.user.username}
            onDone={() => onLogin(pending.user)}
          />
        ) : (
          <>
            <div className="auth-brand">
              <span className="brand-symbol">
                <Rocket />
              </span>
              <span>数学星球</span>
            </div>
            <h1>
              {mode === 'login'
                ? '今天也练一点点'
                : mode === 'register'
                  ? '一起开启数学冒险'
                  : '找回家长账号'}
            </h1>
            <p className="auth-intro">
              {mode === 'login'
                ? '孩子用自己的账号开始，家长用家长账号查看进步。'
                : mode === 'register'
                  ? '先创建家长账号，再为孩子建立学习空间。'
                  : '使用已保存的恢复码重设密码。孩子的密码由家长在管理页重置。'}
            </p>
            <div className="topic-tabs auth-tabs">
              <button
                aria-pressed={mode === 'login'}
                onClick={() => switchMode('login')}
              >
                登录
              </button>
              <button
                aria-pressed={mode === 'register'}
                onClick={() => switchMode('register')}
              >
                家长注册
              </button>
            </div>
            {mode === 'login' && known.length > 0 && (
              <div className="known-users">
                <span>这台设备用过的账号</span>
                {known.map((name) => (
                  <button key={name} onClick={() => setUsername(name)}>
                    <span className="small-avatar">{name[0]}</span>
                    {name}
                  </button>
                ))}
                <button
                  className="text-button"
                  onClick={() => {
                    try {
                      localStorage.removeItem('planet-usernames');
                    } catch {
                      /* Optional local storage. */
                    }
                    setKnown([]);
                  }}
                >
                  清除
                </button>
              </div>
            )}
            <form onSubmit={submit} className="auth-form">
              <label className="field-label">
                用户名
                <input
                  autoComplete="username"
                  value={username}
                  maxLength={24}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="3–24 位中文、字母、数字或下划线"
                  required
                />
              </label>
              {mode === 'recover' && (
                <label className="field-label">
                  账号恢复码
                  <input
                    autoComplete="off"
                    value={code}
                    maxLength={100}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="输入或粘贴保存的恢复码"
                    required
                  />
                </label>
              )}
              <PasswordField
                label={
                  mode === 'login'
                    ? '密码'
                    : mode === 'recover'
                      ? '新密码（至少 10 位）'
                      : '设置密码（至少 10 位）'
                }
                value={password}
                onChange={setPassword}
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                minLength={mode === 'login' ? 1 : 10}
              />
              {mode !== 'login' && (
                <PasswordField
                  label="再次输入密码"
                  value={repeat}
                  onChange={setRepeat}
                  autoComplete="new-password"
                  minLength={10}
                />
              )}
              {mode === 'register' && (
                <details className="optional-profile">
                  <summary>补充家庭信息（也可以以后填写）</summary>
                  <label className="field-label">
                    家长称呼
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      maxLength={20}
                      placeholder="例如：小宇妈妈"
                    />
                  </label>
                  <label className="field-label">
                    家庭名称
                    <input
                      value={familyName}
                      onChange={(e) => setFamilyName(e.target.value)}
                      maxLength={30}
                      placeholder="例如：小宇的家"
                    />
                  </label>
                </details>
              )}
              {mode === 'login' && (
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  <span>在这台设备记住用户名</span>
                </label>
              )}
              <ErrorNotice message={error} />
              {notice && <output className="success-text">{notice}</output>}
              <button className="primary-button w-full" disabled={busy}>
                {busy
                  ? '请稍候…'
                  : mode === 'login'
                    ? '进入数学星球'
                    : mode === 'register'
                      ? '创建家长账号'
                      : '重设密码'}
                <ArrowRight />
              </button>
            </form>
            {mode === 'login' && (
              <button
                className="text-button forgot-link"
                onClick={() => switchMode('recover')}
              >
                忘记密码？
              </button>
            )}
            {mode === 'recover' && (
              <p className="muted recovery-help">
                还没有设置恢复码？仍能登录的家长可以在“账号与安全”生成；孩子账号请让家长重置。旧家长账号若既无法登录也没有恢复码，需要联系站点管理员。
              </p>
            )}
          </>
        )}
      </section>
      <p className="auth-footer">每天一点练习，让进步看得见</p>
    </main>
  );
}
export function ChangePassword({
  user,
  onDone,
  onLogout,
}: {
  user: User;
  onDone: () => void;
  onLogout: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const min = user.role === 'child' ? 6 : 10;
  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (next !== repeat) {
      setError('两次输入的新密码不一致');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiVoid('auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      onDone();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '修改失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <KeyRound />
        <h1>设置自己的新密码</h1>
        <p>这次使用的是临时密码，请先更换后再开始。</p>
        <form className="auth-form" onSubmit={submit}>
          <PasswordField
            label="当前临时密码"
            value={current}
            onChange={setCurrent}
          />
          <PasswordField
            label={`新密码（至少 ${min} 位）`}
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            minLength={min}
          />
          <PasswordField
            label="再输入一次新密码"
            value={repeat}
            onChange={setRepeat}
            autoComplete="new-password"
            minLength={min}
          />
          <ErrorNotice message={error} />
          <button disabled={busy} className="primary-button w-full">
            {busy ? '保存中…' : '保存新密码'}
          </button>
        </form>
        <button
          type="button"
          className="text-button w-full"
          disabled={busy}
          onClick={onLogout}
        >
          切换账号
        </button>
      </section>
    </main>
  );
}

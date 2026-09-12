'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  KeyRound,
  Plus,
  Settings2,
  UserRound,
} from 'lucide-react';
import type {
  ChildItem,
  LearningPreferences,
  LearningProgress,
  User,
} from '@/lib/types';
import { formatDate } from '@/lib/learning';
import { api } from '@/lib/client-api';
import {
  AppHeader,
  ErrorNotice,
  LoadingPanel,
  Modal,
  PasswordField,
} from './Shared';
import { QuestionPicker } from './QuestionPicker';
import { Progress } from './Progress';
import { RecoveryReceipt } from './Auth';
import { LegacyHistory } from './LegacyHistory';

type ChildDetail = {
  child: ChildItem;
  progress: LearningProgress;
  preferences: LearningPreferences;
};
export default function ParentDashboard({
  user,
  onLogout,
  onSwitch,
}: {
  user: User;
  onLogout: () => void;
  onSwitch: (user: User) => void;
}) {
  const [children, setChildren] = useState<ChildItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ChildDetail | null>(null);
  const [add, setAdd] = useState(false);
  const [reset, setReset] = useState<ChildItem | null>(null);
  const [status, setStatus] = useState<ChildItem | null>(null);
  const [enter, setEnter] = useState<ChildItem | null>(null);
  const [edit, setEdit] = useState(false);
  const [security, setSecurity] = useState(false);
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    password: '',
  });
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState('');
  const [profile, setProfile] = useState({
    displayName: user.displayName,
    familyName: '',
  });
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ children: ChildItem[] }>('parent/children');
      setChildren(data.children);
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
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  const show = (child: ChildItem) =>
    void action(async () => {
      const [progress, prefs] = await Promise.all([
        api<LearningProgress>(`parent/children/${child.id}/progress`),
        api<{ preferences: LearningPreferences }>(
          `parent/children/${child.id}/preferences`,
        ),
      ]);
      setDetail({ child, progress, preferences: prefs.preferences });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  return (
    <main className="learning-app parent-app">
      <AppHeader
        user={user}
        onLogout={onLogout}
        onHome={() => setDetail(null)}
      />
      <div className="app-content">
        <ErrorNotice
          message={error}
          onRetry={!detail ? () => void load() : undefined}
        />
        {notice && <output className="success-banner">{notice}</output>}
        {detail ? (
          <>
            <button className="text-button" onClick={() => setDetail(null)}>
              <ArrowLeft />
              所有孩子
            </button>
            <div className="page-heading">
              <div>
                <span className="eyebrow">学习详情</span>
                <h1>{detail.child.display_name}的每一点进步</h1>
                <p>看看练会了什么，再一起选好下一轮。</p>
              </div>
              <button className="soft-button" onClick={() => setEdit(true)}>
                <Settings2 />
                设置推荐练习
              </button>
            </div>
            <section className="panel content-panel">
              <Progress data={detail.progress} />
            </section>
          </>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">家长中心</span>
                <h1>陪孩子，走好每一步</h1>
                <p>查看进步、安排练习，账号设置随时可用。</p>
              </div>
              <button className="primary-button" onClick={() => setAdd(true)}>
                <Plus />
                添加孩子
              </button>
            </div>
            {loading ? (
              <LoadingPanel />
            ) : (
              <div className="children-grid">
                {children.map((child) => (
                  <article className="learner-card" key={child.id}>
                    <div className="learner-heading">
                      <span className="learner-avatar">
                        {child.display_name[0]}
                      </span>
                      <div>
                        <h2>{child.display_name}</h2>
                        <span className="muted">
                          {child.is_active ? '正在使用' : '账号已停用'}
                        </span>
                      </div>
                    </div>
                    <div className="learner-stats">
                      <div>
                        <strong>{child.round_count}</strong>
                        <span>已完成轮数</span>
                      </div>
                      <div>
                        <strong>
                          {child.round_count
                            ? `${child.average_score} 分`
                            : '尚未练习'}
                        </strong>
                        <span>平均得分</span>
                      </div>
                    </div>
                    <p className="muted">
                      最近练习：{formatDate(child.last_practiced_at)}
                    </p>
                    <button
                      className="primary-button w-full"
                      disabled={busy}
                      onClick={() => show(child)}
                    >
                      查看学习详情
                      <ArrowRight />
                    </button>
                    <details className="child-account">
                      <summary>账号与操作</summary>
                      <p className="break-words">用户名：{child.username}</p>
                      <div className="action-row">
                        <button
                          className="soft-button"
                          disabled={!child.is_active || busy}
                          onClick={() => setEnter(child)}
                        >
                          <UserRound />
                          进入孩子练习
                        </button>
                        <button
                          className="soft-button"
                          onClick={() => {
                            setPassword('');
                            setReset(child);
                          }}
                        >
                          <KeyRound />
                          重置密码
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setStatus(child)}
                        >
                          {child.is_active ? '停用账号' : '启用账号'}
                        </button>
                      </div>
                    </details>
                  </article>
                ))}
                {!children.length && !error && (
                  <section className="panel empty-learning">
                    <UserRound />
                    <h2>先为孩子创建一个账号</h2>
                    <p>每个孩子都有独立的练习与进步记录。</p>
                    <button
                      className="primary-button"
                      onClick={() => setAdd(true)}
                    >
                      添加第一个孩子
                      <Plus />
                    </button>
                  </section>
                )}
              </div>
            )}
            <button
              className="soft-button parent-security"
              onClick={() => {
                setPassword('');
                setSecurity(true);
              }}
            >
              <KeyRound />
              账号与安全
            </button>
            <LegacyHistory />
          </>
        )}
      </div>
      {add && (
        <Modal title="添加孩子账号" onClose={() => setAdd(false)}>
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api('parent/children', {
                  method: 'POST',
                  body: JSON.stringify(form),
                });
                setAdd(false);
                setForm({ username: '', displayName: '', password: '' });
                await load();
                setNotice('孩子账号已创建，可以开始练习了。');
              });
            }}
          >
            <label className="field-label">
              孩子昵称
              <input
                value={form.displayName}
                maxLength={20}
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
                minLength={3}
                maxLength={24}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                autoComplete="off"
                required
              />
            </label>
            <PasswordField
              label="初始密码（至少 6 位）"
              value={form.password}
              onChange={(password) => setForm({ ...form, password })}
              minLength={6}
              autoComplete="new-password"
            />
            <ErrorNotice message={error} />
            <button className="primary-button w-full" disabled={busy}>
              {busy ? '创建中…' : '创建孩子账号'}
            </button>
          </form>
        </Modal>
      )}
      {reset && (
        <Modal
          title={`为${reset.display_name}重置密码`}
          onClose={() => setReset(null)}
        >
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api(`parent/children/${reset.id}/reset-password`, {
                  method: 'POST',
                  body: JSON.stringify({ password }),
                });
                setReset(null);
                setPassword('');
                setNotice('密码已重置，孩子下次登录时需设置自己的新密码。');
              });
            }}
          >
            <p>孩子原有学习记录会保留，其他设备需要重新登录。</p>
            <PasswordField
              label="新的临时密码（至少 6 位）"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              minLength={6}
            />
            <ErrorNotice message={error} />
            <button className="primary-button" disabled={busy}>
              确认重置
            </button>
          </form>
        </Modal>
      )}
      {status && (
        <Modal
          title={`${status.is_active ? '停用' : '启用'}${status.display_name}的账号？`}
          onClose={() => setStatus(null)}
        >
          <p>
            {status.is_active
              ? '停用后孩子无法登录，学习记录会保留，之后可以再次启用。'
              : '启用后孩子可以继续使用原账号练习。'}
          </p>
          <ErrorNotice message={error} />
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await api(`parent/children/${status.id}/status`, {
                  method: 'POST',
                  body: JSON.stringify({ isActive: !status.is_active }),
                });
                setStatus(null);
                await load();
              })
            }
          >
            确认{status.is_active ? '停用' : '启用'}
          </button>
        </Modal>
      )}
      {enter && (
        <Modal
          title={`进入${enter.display_name}的练习空间？`}
          onClose={() => setEnter(null)}
        >
          <p>会切换到孩子账号。再次进入家长中心时，需要重新输入家长密码。</p>
          <ErrorNotice message={error} />
          <button
            disabled={busy}
            className="primary-button"
            onClick={() =>
              void action(async () => {
                const data = await api<{ user: User }>(
                  `parent/children/${enter.id}/enter`,
                  { method: 'POST' },
                );
                onSwitch(data.user);
              })
            }
          >
            进入孩子练习
            <ArrowRight />
          </button>
        </Modal>
      )}
      {edit && detail && (
        <Modal
          title={`为${detail.child.display_name}推荐下一轮`}
          onClose={() => setEdit(false)}
          wide
        >
          <QuestionPicker
            value={detail.preferences}
            onChange={(preferences) => setDetail({ ...detail, preferences })}
          />
          <ErrorNotice message={error} />
          <button
            className="primary-button w-full"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await api(`parent/children/${detail.child.id}/preferences`, {
                  method: 'PUT',
                  body: JSON.stringify(detail.preferences),
                });
                setEdit(false);
                setNotice('推荐练习已保存，孩子重新打开页面后即可使用。');
              })
            }
          >
            保存推荐练习
          </button>
        </Modal>
      )}
      {security && (
        <Modal
          title="账号与安全"
          onClose={() => {
            setSecurity(false);
            setRecovery('');
            setPassword('');
          }}
        >
          {recovery ? (
            <RecoveryReceipt
              code={recovery}
              username={user.username}
              onDone={() => {
                setRecovery('');
                setSecurity(false);
              }}
            />
          ) : (
            <>
              <p>生成新的恢复码后，旧恢复码会失效。需要验证家长密码。</p>
              <form
                className="auth-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    const data = await api<{ recoveryCode: string }>(
                      'auth/recovery-code',
                      { method: 'POST', body: JSON.stringify({ password }) },
                    );
                    setPassword('');
                    setRecovery(data.recoveryCode);
                  });
                }}
              >
                <PasswordField
                  label="家长密码"
                  value={password}
                  onChange={setPassword}
                />
                <ErrorNotice message={error} />
                <button className="primary-button" disabled={busy}>
                  生成账号恢复码
                </button>
              </form>
              <details className="optional-profile">
                <summary>修改家庭信息</summary>
                <form
                  className="auth-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      const data = await api<{ user: User }>('parent/profile', {
                        method: 'PUT',
                        body: JSON.stringify(profile),
                      });
                      onSwitch(data.user);
                      setNotice('家庭信息已更新');
                      setSecurity(false);
                    });
                  }}
                >
                  <label className="field-label">
                    家长称呼
                    <input
                      value={profile.displayName}
                      maxLength={20}
                      required
                      onChange={(e) =>
                        setProfile({ ...profile, displayName: e.target.value })
                      }
                    />
                  </label>
                  <label className="field-label">
                    家庭名称
                    <input
                      value={profile.familyName}
                      maxLength={30}
                      placeholder="留空保留当前名称"
                      onChange={(e) =>
                        setProfile({ ...profile, familyName: e.target.value })
                      }
                    />
                  </label>
                  <button className="soft-button" disabled={busy}>
                    保存家庭信息
                  </button>
                </form>
              </details>
            </>
          )}
        </Modal>
      )}
    </main>
  );
}

'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Eye, EyeOff, LogOut, Rocket, X, RefreshCw } from 'lucide-react';
import type { User } from '@/lib/types';

export function AppHeader({
  user,
  onLogout,
  onHome,
}: {
  user: User;
  onLogout: () => void;
  onHome?: () => void;
}) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <button className="brand" onClick={onHome} aria-label="口算星球首页">
          <span className="brand-symbol">
            <Rocket />
          </span>
          <span>
            口算星球
            <small>
              {user.role === 'child' ? '每天一点，慢慢变厉害' : '家长中心'}
            </small>
          </span>
        </button>
        <div className="account-area">
          <span className="account-name">{user.displayName}</span>
          <button
            className="icon-button"
            onClick={onLogout}
            aria-label="退出登录"
            title="退出登录"
          >
            <LogOut />
          </button>
        </div>
      </div>
    </header>
  );
}
export function ErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  if (!message) return null;
  return (
    <div role="alert" className="notice-error error-notice">
      <span>{message}</span>
      {onRetry && (
        <button className="soft-button" onClick={onRetry}>
          <RefreshCw />
          重试
        </button>
      )}
    </div>
  );
}
export function LoadingPanel() {
  return (
    <output className="loading-panel" aria-label="正在加载">
      <span className="loading-line" />
      <span className="loading-line short" />
      <span className="loading-block" />
      <p>正在准备你的学习空间…</p>
    </output>
  );
}
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  minLength = 1,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <div className="field-label">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          minLength={minLength}
          maxLength={128}
          onChange={(e) => onChange(e.target.value)}
          required
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => setShow(!show)}
          aria-label={show ? '隐藏密码' : '显示密码'}
          aria-pressed={show}
        >
          {show ? <EyeOff /> : <Eye />}
        </button>
      </div>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`app-modal ${wide ? 'wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={onClose}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}

'use client';
import { useState } from 'react';
import { Expand, Lightbulb, Undo2 } from 'lucide-react';
import { Abacus } from '@/components/Abacus';
import { Modal } from './Shared';
export function AbacusInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [demo, setDemo] = useState(0);
  const change = (next: number) => {
    setHistory((previous) => [...previous.slice(-19), value]);
    onChange(String(next));
  };
  const undo = () => {
    const previous = history.at(-1);
    if (previous !== undefined) {
      onChange(previous);
      setHistory((h) => h.slice(0, -1));
    }
  };
  const board = (
    <div className="abacus-input">
      <Abacus
        value={Number(value || 0)}
        interactive
        showValue
        label={label}
        onChange={change}
      />
      <div className="abacus-tools">
        <button
          type="button"
          className="soft-button"
          disabled={!history.length}
          onClick={undo}
        >
          <Undo2 />
          撤销
        </button>
        {value === '' && (
          <button
            className="soft-button"
            type="button"
            onClick={() => change(0)}
          >
            确认是 0
          </button>
        )}
      </div>
    </div>
  );
  return (
    <div className="abacus-input">
      <Abacus value={Number(value || 0)} showValue label={label} />
      <button
        className="primary-button"
        type="button"
        onClick={() => setExpanded(true)}
      >
        <Expand />
        打开算盘作答
      </button>
      <button
        type="button"
        className="text-button"
        onClick={() => setShowHelp(true)}
      >
        <Lightbulb />
        拨珠小示范
      </button>
      {expanded && (
        <Modal title="拨出你的答案" onClose={() => setExpanded(false)}>
          {board}
          <button
            type="button"
            className="primary-button w-full"
            onClick={() => {
              if (value === '') change(0);
              setExpanded(false);
            }}
          >
            完成拨珠
          </button>
        </Modal>
      )}
      {showHelp && (
        <Modal title="靠梁的珠子才计数" onClose={() => setShowHelp(false)}>
          <p>上珠每颗表示 5，下珠每颗表示 1；左边是十位，右边是个位。</p>
          <Abacus value={demo} label="示范算盘" showValue />
          <p className="demo-description" aria-live="polite">
            {demo === 0
              ? '现在是 0，珠子都离开横梁。'
              : demo === 5
                ? '点个位上珠靠梁，得到 5。'
                : '再让两颗下珠靠梁：5＋2，就是 7。'}
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={() => setDemo(demo === 0 ? 5 : demo === 5 ? 7 : 0)}
          >
            {demo === 7 ? '再看一遍' : '下一步'}
          </button>
        </Modal>
      )}
    </div>
  );
}

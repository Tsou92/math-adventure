'use client';

import {
  abacusToValue,
  selectLower,
  toggleUpper,
  valueToAbacus,
  type AbacusRodState,
  type AbacusState,
} from '@/lib/abacus';

type RodKey = keyof AbacusState;

function AbacusRod({
  label,
  rod,
  interactive,
  onChange,
}: {
  label: string;
  rod: AbacusRodState;
  interactive: boolean;
  onChange: (rod: AbacusRodState) => void;
}) {
  const digit = (rod.upperActive ? 5 : 0) + rod.lowerActiveCount;
  const upperTop = rod.upperActive
    ? interactive
      ? 59
      : 31
    : interactive
      ? 14
      : 7;
  return (
    <span className="abacus-rod" aria-label={`${label}，当前为 ${digit}`}>
      <span className="abacus-stick" />
      {interactive ? (
        <button
          type="button"
          className={`abacus-bead abacus-upper ${rod.upperActive ? 'active' : ''}`}
          style={{ top: upperTop }}
          aria-label={`${label}上珠，点击后${rod.upperActive ? '离梁' : '靠梁'}`}
          onClick={() => onChange(toggleUpper(rod))}
        />
      ) : (
        <span
          className={`abacus-bead abacus-upper ${rod.upperActive ? 'active' : ''}`}
          style={{ top: upperTop }}
          aria-hidden="true"
        />
      )}
      {([1, 2, 3, 4] as const).map((beadNumber) => {
        const active = beadNumber <= rod.lowerActiveCount;
        const top = active
          ? 70 + (beadNumber - 1) * 24
          : 102 + (beadNumber - 1) * 24;
        return interactive ? (
          <button
            type="button"
            className={`abacus-bead abacus-lower ${active ? 'active' : ''}`}
            style={{ top: interactive ? top * 2 : top }}
            key={beadNumber}
            aria-label={`${label}第 ${beadNumber} 颗下珠，点击后调整靠梁珠数`}
            onClick={() => onChange(selectLower(rod, beadNumber))}
          />
        ) : (
          <span
            className={`abacus-bead abacus-lower ${active ? 'active' : ''}`}
            style={{ top: interactive ? top * 2 : top }}
            key={beadNumber}
            aria-hidden="true"
          />
        );
      })}
      <span className="abacus-place-label">{label}</span>
    </span>
  );
}

export function Abacus({
  value,
  onChange,
  interactive = false,
  showValue = false,
  compact = false,
  label = '算盘',
}: {
  value: number;
  onChange?: (value: number) => void;
  interactive?: boolean;
  showValue?: boolean;
  compact?: boolean;
  label?: string;
}) {
  const state = valueToAbacus(value);
  const updateRod = (key: RodKey, rod: AbacusRodState) => {
    if (!interactive || !onChange) return;
    onChange(abacusToValue({ ...state, [key]: rod }));
  };
  return (
    <span
      className={`abacus-wrap ${compact ? 'compact' : ''} ${interactive ? 'interactive' : ''}`}
      aria-label={`${label}，当前表示 ${value}`}
    >
      <span className="abacus-frame">
        <span className="abacus-beam" />
        <AbacusRod
          label="十位"
          rod={state.tens}
          interactive={interactive}
          onChange={(rod) => updateRod('tens', rod)}
        />
        <AbacusRod
          label="个位"
          rod={state.ones}
          interactive={interactive}
          onChange={(rod) => updateRod('ones', rod)}
        />
      </span>
      {showValue && <strong className="abacus-value">当前：{value}</strong>}
    </span>
  );
}

import { describe, expect, it } from 'vitest';
import {
  abacusToValue,
  digitToRod,
  selectLower,
  toggleUpper,
  valueToAbacus,
} from './abacus';

describe('abacus helpers', () => {
  it('0 到 99 的珠形可以稳定往返', () => {
    for (let value = 0; value <= 99; value += 1)
      expect(abacusToValue(valueToAbacus(value))).toBe(value);
  });

  it('上珠在 0 与 5 之间切换', () => {
    const empty = digitToRod(0);
    expect(toggleUpper(empty).upperActive).toBe(true);
    expect(toggleUpper(toggleUpper(empty)).upperActive).toBe(false);
  });

  it('点击下珠时始终形成连续靠梁的合法状态', () => {
    let rod = digitToRod(0);
    rod = selectLower(rod, 3);
    expect(rod.lowerActiveCount).toBe(3);
    rod = selectLower(rod, 2);
    expect(rod.lowerActiveCount).toBe(1);
    rod = selectLower(rod, 4);
    expect(rod.lowerActiveCount).toBe(4);
    rod = selectLower(rod, 1);
    expect(rod.lowerActiveCount).toBe(0);
  });
});

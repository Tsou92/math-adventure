export type AbacusRodState = {
  upperActive: boolean;
  lowerActiveCount: 0 | 1 | 2 | 3 | 4;
};

export type AbacusState = {
  tens: AbacusRodState;
  ones: AbacusRodState;
};

export function digitToRod(digit: number): AbacusRodState {
  const normalized = Math.min(9, Math.max(0, Math.trunc(digit)));
  return {
    upperActive: normalized >= 5,
    lowerActiveCount: (normalized % 5) as AbacusRodState['lowerActiveCount'],
  };
}

export function rodToDigit(rod: AbacusRodState) {
  return (rod.upperActive ? 5 : 0) + rod.lowerActiveCount;
}

export function valueToAbacus(value: number): AbacusState {
  const normalized = Math.min(99, Math.max(0, Math.trunc(value)));
  return {
    tens: digitToRod(Math.floor(normalized / 10)),
    ones: digitToRod(normalized % 10),
  };
}

export function abacusToValue(state: AbacusState) {
  return rodToDigit(state.tens) * 10 + rodToDigit(state.ones);
}

export function toggleUpper(rod: AbacusRodState): AbacusRodState {
  return { ...rod, upperActive: !rod.upperActive };
}

export function selectLower(
  rod: AbacusRodState,
  beadNumber: 1 | 2 | 3 | 4,
): AbacusRodState {
  return {
    ...rod,
    lowerActiveCount: (beadNumber > rod.lowerActiveCount
      ? beadNumber
      : beadNumber - 1) as AbacusRodState['lowerActiveCount'],
  };
}

export type Level =
  | 'starter'
  | 'explorer'
  | 'challenger'
  | 'multiplyMeaning'
  | 'multiplyFacts'
  | 'multiplyMixed'
  | 'abacusMove'
  | 'abacusMatch'
  | 'abacusCalculation';

export type AbacusMovePrompt = {
  version: 1;
  startValue: number;
  operator: '+' | '−';
  operand: number;
};

export type AbacusMatchPrompt = {
  version: 1;
  groupId: string;
  optionValues: number[];
};

export type AbacusCalculationPrompt = {
  version: 1;
  startValue: number;
  operations: Array<{ operator: '+' | '−'; value: number }>;
};

export type QuestionPrompt =
  | AbacusMovePrompt
  | AbacusMatchPrompt
  | AbacusCalculationPrompt;

export type Question = {
  id: string;
  level: Level;
  expression: string;
  answer: number;
  promptData?: QuestionPrompt;
};

export type QuestionCounts = Record<Level, number>;

export type QuestionOptions = {
  challengerChain?: boolean;
};

export function totalQuestions(counts: QuestionCounts) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

export function normalizeQuestionCount(value: string | number) {
  if (value === '') return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(50, Math.max(0, Math.trunc(parsed)));
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function splitMatchGroups(count: number) {
  const groups: number[] = [];
  let remaining = count;
  while (remaining > 0) {
    if (remaining <= 4) {
      groups.push(remaining);
      break;
    }
    if (remaining === 5) {
      groups.push(3, 2);
      break;
    }
    groups.push(4);
    remaining -= 4;
  }
  return groups;
}

function weightedQuota(count: number) {
  if (count < 5) return null;
  const weights = [0.4, 0.4, 0.2];
  const quotas = weights.map((weight) => Math.floor(count * weight));
  let remaining = count - quotas.reduce((sum, value) => sum + value, 0);
  const ranked = weights
    .map((weight, index) => ({
      index,
      remainder: count * weight - Math.floor(count * weight),
    }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; remaining > 0; index += 1, remaining -= 1)
    quotas[ranked[index % ranked.length].index] += 1;
  return quotas as [number, number, number];
}

export function makeQuestionsForCounts(
  seed: number,
  counts: QuestionCounts,
  options: QuestionOptions = {},
): Question[] {
  if (counts.abacusMatch === 1) throw new Error('空拨连线至少需要 2 道题');
  const random = seededRandom(seed);
  const int = (min: number, max: number) =>
    Math.floor(random() * (max - min + 1)) + min;
  const questions: Question[] = [];
  let zeroOperandCount = 0;

  const makeSimple = (limit: number, level: Level, count: number) => {
    const used = new Set<string>();
    let zeroAnswerCount = 0;

    while (used.size < count) {
      const isAddition = random() > 0.5;
      let left: number;
      let right: number;
      let answer: number;

      if (isAddition) {
        left = int(0, limit);
        right = int(0, limit - left);
        answer = left + right;
      } else {
        left = int(0, limit);
        right = int(0, left);
        answer = left - right;
      }

      const expression = `${left} ${isAddition ? '+' : '−'} ${right}`;
      if (used.has(expression)) continue;
      // 零答案偶尔出现有练习价值，但不应在同一类题中扎堆。
      if (answer === 0 && (zeroAnswerCount >= 1 || random() > 0.2)) continue;
      // 含 0 的计算题只少量保留，避免 +0、−0 占据太多练习题。
      const hasZeroOperand = left === 0 || right === 0;
      if (hasZeroOperand && (zeroOperandCount >= 2 || random() > 0.08))
        continue;
      used.add(expression);
      if (answer === 0) zeroAnswerCount += 1;
      if (hasZeroOperand) zeroOperandCount += 1;
      questions.push({
        id: `${level}-${used.size}`,
        level,
        expression,
        answer,
      });
    }
  };

  makeSimple(10, 'starter', counts.starter);
  makeSimple(20, 'explorer', counts.explorer);

  const usedChallenger = new Set<string>();
  while (usedChallenger.size < counts.challenger) {
    if (!options.challengerChain) {
      const isAddition = random() > 0.5;
      let left: number;
      let right: number;
      let answer: number;

      if (isAddition) {
        left = int(10, 89);
        right = int(10, 100 - left);
        if ((left % 10) + (right % 10) < 10) continue;
        answer = left + right;
      } else {
        left = int(20, 99);
        right = int(10, left - 1);
        if (left % 10 >= right % 10) continue;
        answer = left - right;
      }

      const expression = `${left} ${isAddition ? '+' : '−'} ${right}`;
      if (usedChallenger.has(expression)) continue;
      usedChallenger.add(expression);
      questions.push({
        id: `challenger-${usedChallenger.size}`,
        level: 'challenger',
        expression,
        answer,
      });
      continue;
    }

    const subtractFirst = random() > 0.5;
    let expression = '';
    let answer = 0;

    if (subtractFirst) {
      const left = int(20, 99);
      const subtract = int(10, left);
      if (left % 10 >= subtract % 10) continue;
      const middle = left - subtract;
      const add = int(10, Math.max(10, 100 - middle));
      if (middle + add > 100 || (middle % 10) + (add % 10) < 10) continue;
      expression = `${left} − ${subtract} + ${add}`;
      answer = middle + add;
    } else {
      const left = int(10, 79);
      const add = int(10, 99 - left);
      const middle = left + add;
      if ((left % 10) + (add % 10) < 10) continue;
      const subtract = int(10, middle);
      if (middle % 10 >= subtract % 10) continue;
      expression = `${left} + ${add} − ${subtract}`;
      answer = middle - subtract;
    }

    if (usedChallenger.has(expression)) continue;
    usedChallenger.add(expression);
    questions.push({
      id: `challenger-${usedChallenger.size}`,
      level: 'challenger',
      expression,
      answer,
    });
  }

  const usedMeanings = new Set<string>();
  while (usedMeanings.size < counts.multiplyMeaning) {
    const groups = int(2, 6);
    const groupSize = int(2, 9);
    const product = groups * groupSize;
    const kind = usedMeanings.size % 6;
    let expression: string;
    let answer: number;

    if (kind === 0) {
      expression = `${Array.from({ length: groups }, () => groupSize).join(' + ')} 可以写成 ${groupSize} × □`;
      answer = groups;
    } else if (kind === 1) {
      expression = `${groups} 个 ${groupSize} 相加，和是 □`;
      answer = product;
    } else if (kind === 2) {
      expression = `每组 ${groupSize} 个，有 ${groups} 组，一共有 □ 个`;
      answer = product;
    } else if (kind === 3) {
      expression = `把 ${groups} × ${groupSize} 交换两个乘数，得到 ${groupSize} × □`;
      answer = groups;
    } else if (kind === 4) {
      expression = `${groups} × ${groupSize} = ${product}，一个乘数是 ${groups}，另一个乘数是 □`;
      answer = groupSize;
    } else {
      expression = `${groupSize} × ${groups} 可以看成 □ 个 ${groupSize} 相加`;
      answer = groups;
    }

    if (usedMeanings.has(expression)) continue;
    usedMeanings.add(expression);
    questions.push({
      id: `multiplyMeaning-${usedMeanings.size}`,
      level: 'multiplyMeaning',
      expression,
      answer,
    });
  }

  const usedFacts = new Set<string>();
  while (usedFacts.size < counts.multiplyFacts) {
    const left = int(2, 9);
    const right = int(2, 9);
    const expression = `${left} × ${right}`;
    if (usedFacts.has(expression)) continue;
    usedFacts.add(expression);
    questions.push({
      id: `multiplyFacts-${usedFacts.size}`,
      level: 'multiplyFacts',
      expression,
      answer: left * right,
    });
  }

  const usedMixed = new Set<string>();
  const mixedStartsWithAddition = counts.multiplyMixed > 0 && random() > 0.5;
  while (usedMixed.size < counts.multiplyMixed) {
    const left = int(2, 9);
    const right = int(2, 9);
    const product = left * right;
    const isAddition = (usedMixed.size % 2 === 0) === mixedStartsWithAddition;
    if (!isAddition && product <= 10) continue;
    const operand = int(10, isAddition ? 100 - product : product - 1);
    const crossesTen = isAddition
      ? (product % 10) + (operand % 10) >= 10
      : product % 10 < operand % 10;
    if (!crossesTen) continue;
    const expression = `${left} × ${right} ${isAddition ? '+' : '−'} ${operand}`;
    if (usedMixed.has(expression)) continue;
    usedMixed.add(expression);
    questions.push({
      id: `multiplyMixed-${usedMixed.size}`,
      level: 'multiplyMixed',
      expression,
      answer: isAddition ? product + operand : product - operand,
    });
  }

  const usedMoves = new Set<string>();
  const moveQuota = weightedQuota(counts.abacusMove);
  const moveKinds: Array<'crossFive' | 'crossTen' | 'regular'> = [];
  if (moveQuota) {
    moveKinds.push(
      ...Array.from({ length: moveQuota[0] }, () => 'crossFive' as const),
      ...Array.from({ length: moveQuota[1] }, () => 'crossTen' as const),
      ...Array.from({ length: moveQuota[2] }, () => 'regular' as const),
    );
  }
  const classifyMove = (start: number, answer: number) => {
    const startDigit = start % 10;
    const answerDigit = answer % 10;
    if (
      (answer > start && answerDigit < startDigit) ||
      (answer < start && answerDigit > startDigit)
    )
      return 'crossTen';
    if (
      (startDigit < 5 && answerDigit >= 5) ||
      (startDigit >= 5 && answerDigit < 5)
    )
      return 'crossFive';
    return 'regular';
  };
  while (usedMoves.size < counts.abacusMove) {
    const targetKind = moveQuota
      ? moveKinds[usedMoves.size]
      : (['crossFive', 'crossTen', 'regular'] as const)[
          random() < 0.4 ? 0 : random() < 2 / 3 ? 1 : 2
        ];
    const isAddition = random() > 0.5;
    const startValue = int(isAddition ? 0 : 2, isAddition ? 94 : 99);
    const operand = int(1, isAddition ? 99 - startValue : startValue);
    const answer = isAddition ? startValue + operand : startValue - operand;
    if (classifyMove(startValue, answer) !== targetKind) continue;
    const operator = isAddition ? '+' : '−';
    const expression = `${startValue} ${operator} ${operand}`;
    if (usedMoves.has(expression)) continue;
    usedMoves.add(expression);
    questions.push({
      id: `abacusMove-${usedMoves.size}`,
      level: 'abacusMove',
      expression,
      answer,
      promptData: { version: 1, startValue, operator, operand },
    });
  }

  let matchQuestionIndex = 0;
  for (const [groupIndex, groupSize] of splitMatchGroups(
    counts.abacusMatch,
  ).entries()) {
    const groupId = `abacus-match-${groupIndex + 1}`;
    const group: Array<{
      expression: string;
      answer: number;
    }> = [];
    const answers = new Set<number>();
    const expressions = new Set<string>();
    while (group.length < groupSize) {
      const isAddition = random() > 0.45;
      const left = int(isAddition ? 1 : 10, isAddition ? 98 : 99);
      const right = int(1, isAddition ? 99 - left : left);
      const answer = isAddition ? left + right : left - right;
      const expression = `${left} ${isAddition ? '+' : '−'} ${right}`;
      if (answers.has(answer) || expressions.has(expression)) continue;
      answers.add(answer);
      expressions.add(expression);
      group.push({ expression, answer });
    }
    const optionValues = [...answers];
    for (let index = optionValues.length - 1; index > 0; index -= 1) {
      const target = int(0, index);
      [optionValues[index], optionValues[target]] = [
        optionValues[target],
        optionValues[index],
      ];
    }
    for (const item of group) {
      matchQuestionIndex += 1;
      questions.push({
        id: `abacusMatch-${matchQuestionIndex}`,
        level: 'abacusMatch',
        expression: item.expression,
        answer: item.answer,
        promptData: { version: 1, groupId, optionValues },
      });
    }
  }

  const usedCalculations = new Set<string>();
  while (usedCalculations.size < counts.abacusCalculation) {
    const startValue = int(5, 89);
    let current = startValue;
    const operations: AbacusCalculationPrompt['operations'] = [];
    for (let step = 0; step < 2; step += 1) {
      const canAdd = current < 99;
      const canSubtract = current > 0;
      const add = !canSubtract || (canAdd && random() > 0.5);
      const value = int(1, add ? 99 - current : current);
      operations.push({ operator: add ? '+' : '−', value });
      current = add ? current + value : current - value;
    }
    const expression = `${startValue} ${operations
      .map((operation) => `${operation.operator} ${operation.value}`)
      .join(' ')}`;
    if (usedCalculations.has(expression)) continue;
    usedCalculations.add(expression);
    questions.push({
      id: `abacusCalculation-${usedCalculations.size}`,
      level: 'abacusCalculation',
      expression,
      answer: current,
      promptData: { version: 1, startValue, operations },
    });
  }

  return questions;
}

export function makeQuestions(seed: number): Question[] {
  return makeQuestionsForCounts(
    seed,
    {
      starter: 10,
      explorer: 10,
      challenger: 10,
      multiplyMeaning: 0,
      multiplyFacts: 0,
      multiplyMixed: 0,
      abacusMove: 0,
      abacusMatch: 0,
      abacusCalculation: 0,
    },
    { challengerChain: true },
  );
}

export function scoreMessage(score: number, total = 30) {
  if (score === 100)
    return {
      title: '满分！你是口算小冠军！',
      note: `${total} 道题全部答对，太厉害啦！`,
    };
  if (score >= 90)
    return {
      title: '太棒了，离满分只差一点！',
      note: '认真看看错题，下一轮一定更棒。',
    };
  if (score >= 70)
    return {
      title: '很不错，继续加油！',
      note: '每练一轮，计算速度都会进步。',
    };
  return {
    title: '勇敢完成就是进步！',
    note: '先看看正确答案，再挑战新一轮吧。',
  };
}

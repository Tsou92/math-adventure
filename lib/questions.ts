export type Level =
  | 'starter'
  | 'explorer'
  | 'challenger'
  | 'multiplyMeaning'
  | 'multiplyFacts';

export type Question = {
  id: string;
  level: Level;
  expression: string;
  answer: number;
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

export function makeQuestionsForCounts(
  seed: number,
  counts: QuestionCounts,
  options: QuestionOptions = {},
): Question[] {
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
      expression = `${Array.from({ length: groups }, () => groupSize).join(' + ')} 可以写成 ${groupSize} × 几`;
      answer = groups;
    } else if (kind === 1) {
      expression = `${groups} 个 ${groupSize} 相加，和是`;
      answer = product;
    } else if (kind === 2) {
      expression = `每组 ${groupSize} 个，有 ${groups} 组，一共有`;
      answer = product;
    } else if (kind === 3) {
      expression = `把 ${groups} × ${groupSize} 交换两个乘数，得到 ${groupSize} × 几`;
      answer = groups;
    } else if (kind === 4) {
      expression = `${groups} × ${groupSize} = ${product}，一个乘数是 ${groups}，另一个乘数是`;
      answer = groupSize;
    } else {
      expression = `${groupSize} × ${groups} 可以看成几个 ${groupSize} 相加`;
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

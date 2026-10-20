import type { Level, QuestionCounts } from './questions';

export const levelInfo: Record<
  Level,
  { title: string; subtitle: string; tone: string }
> = {
  starter: {
    title: '10 以内加减法',
    subtitle: '基础加减与数感练习',
    tone: 'coral',
  },
  explorer: {
    title: '20 以内加减法',
    subtitle: '进位、退位计算基础',
    tone: 'green',
  },
  challenger: {
    title: '100 以内进退位',
    subtitle: '可选择加入连加连减',
    tone: 'purple',
  },
  multiplyMeaning: {
    title: '乘法启蒙',
    subtitle: '同数连加、几个几、乘数与积',
    tone: 'orange',
  },
  multiplyFacts: {
    title: '表内乘法',
    subtitle: '2～9 的乘法计算',
    tone: 'blue',
  },
  multiplyMixed: {
    title: '乘法后加减',
    subtitle: '先算乘法，再进退位加减 · 如 6×9＋28',
    tone: 'purple',
  },
  divisionMeaning: {
    title: '除法启蒙',
    subtitle: '平均分、除法的意义',
    tone: 'cyan',
  },
  divisionFacts: {
    title: '表内除法',
    subtitle: '2～9 的除法计算',
    tone: 'indigo',
  },
  mixedWordProblem: {
    title: '乘除应用题',
    subtitle: '点条件 → 找隐藏条件 → 找问题 → 算答案',
    tone: 'emerald',
  },
  abacusMove: {
    title: '珠心算·空拨画珠',
    subtitle: '看起始珠形，拨出计算结果',
    tone: 'amber',
  },
  abacusMatch: {
    title: '珠心算·空拨连线',
    subtitle: '把算式和正确珠形配成一对',
    tone: 'rose',
  },
  abacusCalculation: {
    title: '珠心算·实拨计算',
    subtitle: '三项连续加减心算练习',
    tone: 'teal',
  },
};

export const emptyCounts: QuestionCounts = {
  starter: 0,
  explorer: 0,
  challenger: 0,
  multiplyMeaning: 0,
  multiplyFacts: 0,
  multiplyMixed: 0,
  divisionMeaning: 0,
  divisionFacts: 0,
  mixedWordProblem: 0,
  abacusMove: 0,
  abacusMatch: 0,
  abacusCalculation: 0,
};

export function formatDuration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatDate(value: string | null) {
  if (!value) return '还没有练习';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatTimestamp(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function expressionWithAnswerBlank(expression: string, level: Level) {
  if (
    (level !== 'multiplyMeaning' &&
      level !== 'divisionMeaning' &&
      level !== 'mixedWordProblem') ||
    expression.includes('□')
  )
    return expression;
  if (expression.endsWith(' × 几')) return expression.replace(/几$/, '□');
  if (expression.includes('可以看成几个 '))
    return expression.replace('可以看成几个 ', '可以看成 □ 个 ');
  if (expression.endsWith('和是')) return `${expression} □`;
  if (expression.endsWith('一共有')) return `${expression} □ 个`;
  if (expression.endsWith('另一个乘数是')) return `${expression} □`;
  if (level === 'divisionMeaning' || level === 'mixedWordProblem') {
    if (expression.includes('每人分到')) return expression;
    if (expression.includes('可以分成')) return expression;
    if (expression.includes('除数是')) return expression;
    if (expression.includes('可以放')) return expression;
    if (expression.includes('需要') && expression.includes('天')) return expression;
    if (expression.includes('还有') && expression.includes('个')) return expression;
  }
  return expression;
}

export function splitAnswerBlank(expression: string, level: Level) {
  const normalized = expressionWithAnswerBlank(expression, level);
  const blankIndex = normalized.indexOf('□');
  if (blankIndex < 0) return null;
  return {
    before: normalized.slice(0, blankIndex),
    after: normalized.slice(blankIndex + 1),
  };
}

export function formatAnsweredExpression(
  expression: string,
  answer: string | number,
  level: Level,
) {
  const normalized = expressionWithAnswerBlank(expression, level);
  return normalized.includes('□')
    ? normalized.replace('□', String(answer))
    : `${normalized} = ${answer}`;
}

export const defaultPreferences = {
  counts: { ...emptyCounts, starter: 10 },
  challengerChain: false,
  mode: 'practice' as const,
};

export function isAnswer(value: string) {
  return /^-?\d{1,4}$/.test(value);
}

export function isDue(
  item: { next_review_at: string | null; mastered_at: string | null },
  now = Date.now(),
) {
  return (
    !item.mastered_at &&
    (!item.next_review_at || Date.parse(item.next_review_at) <= now)
  );
}

export function getQuestionHints(question: {
  expression: string;
  level: Level;
}): string[] {
  const expression = question.expression.replaceAll('-', '−').trim();
  const mixed = expression.match(/^(\d+)\s*×\s*(\d+)\s*([+−])\s*(\d+)$/);
  if (mixed) {
    const left = Number(mixed[1]);
    const right = Number(mixed[2]);
    const product = left * right;
    const operand = Number(mixed[4]);
    const nextHint = getQuestionHints({
      expression: `${product} ${mixed[3]} ${operand}`,
      level: 'challenger',
    })[1];
    return [
      `先算乘法，再算加减。想一想 ${left}×${right} 的乘法口诀。`,
      `${left}×${right}＝${product}，接着算 ${product}${mixed[3]}${operand}。${nextHint}`,
    ];
  }
  const simple = expression.match(/^(\d+)\s*([+−×÷])\s*(\d+)$/);
  if (simple) {
    const a = Number(simple[1]),
      b = Number(simple[3]);
    if (simple[2] === '+') {
      const need = 10 - (a % 10);
      if (a % 10 && b >= need)
        return [
          `${a} 再加 ${need} 就到 ${a + need}。试着把 ${b} 分成两部分。`,
          `把 ${b} 分成 ${need} 和 ${b - need}：先算 ${a}＋${need}，再加 ${b - need}。`,
        ];
      return [
        '把两个数的十位和个位分别相加。',
        `从 ${a} 开始，再向前数 ${b}。也可以在纸上画点数一数。`,
      ];
    }
    if (simple[2] === '−') {
      const tens = Math.floor(b / 10) * 10,
        ones = b % 10;
      return [
        '减法表示拿走一部分，结果应该比原来的数小（减 0 除外）。',
        tens && ones
          ? `把 ${b} 分成 ${tens} 和 ${ones}：先算 ${a}−${tens}，再减 ${ones}。`
          : `从 ${a} 开始，往回数 ${b}。可以借助数轴检查。`,
      ];
    }
    if (simple[2] === '×') {
      return [
        `${a}×${b} 可以看成 ${a} 个 ${b} 相加。`,
        `想一想乘法口诀。也可以先算 ${Math.max(0, a - 1)}×${b}，再加一个 ${b}。`,
      ];
    }
    if (simple[2] === '÷') {
      return [
        `${a}÷${b} 表示把 ${a} 平均分成 ${b} 份，每份是多少。`,
        `想一想除法口诀：几乘${b}等于${a}？用乘法口诀反推。`,
      ];
    }
  }
  if (question.level === 'divisionMeaning')
    return [
      '除法表示平均分。先找总数，再找平均分成几份。',
      '除法和乘法互为逆运算。如果不会算除法，可以试着用乘法检验。',
    ];
  if (question.level === 'mixedWordProblem')
    return [
      '先读清楚题目，找出已知的数和要求的数。',
      '这道题需要分几步计算？先算什么，再算什么？把每一步写下来。',
    ];
  if (question.level === 'abacusMove' || question.level === 'abacusMatch')
    return [
      '先看靠梁的珠子：一颗上珠表示 5，一颗下珠表示 1。',
      '先算出十位和个位，再分别拨珠。减法时记得检查是否需要退位。',
    ];
  if (
    question.level === 'abacusCalculation' ||
    (expression.match(/[+−]/g)?.length ?? 0) > 1
  )
    return [
      '从左到右一步一步算，不要一次记住所有结果。',
      '先把前两项的结果记下来，再进行最后一次加减。',
    ];
  if (question.level === 'multiplyMeaning')
    return [
      '先找每组有几个，再找一共有几组。',
      '几个相同的数相加可以写成乘法。注意空格问的是每组数量、组数，还是总数。',
    ];
  return [
    '先读清楚题目，再把已知的数写下来。',
    '用画图、数轴或算盘试一遍，再检查一次。',
  ];
}

import type { Level, QuestionCounts } from '@/lib/questions';
import type { LegacyRecord } from '@/lib/learning-types';

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
  abacusMove: 0,
  abacusMatch: 0,
  abacusCalculation: 0,
};

export function formatDuration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(
    seconds % 60,
  ).padStart(2, '0')}`;
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
  if (level !== 'multiplyMeaning' || expression.includes('□'))
    return expression;
  if (expression.endsWith(' × 几')) return expression.replace(/几$/, '□');
  if (expression.includes('可以看成几个 '))
    return expression.replace('可以看成几个 ', '可以看成 □ 个 ');
  if (expression.endsWith('和是')) return `${expression} □`;
  if (expression.endsWith('一共有')) return `${expression} □ 个`;
  if (expression.endsWith('另一个乘数是')) return `${expression} □`;
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

/**
 * 旧版本记录只保存在本机 localStorage 中，读取时必须逐条校验，避免脏数据
 * 让家长面板直接崩溃。任何不合法的条目都会被丢弃，而不是抛出异常。
 */
export function parseLegacyRecords(
  raw: string | null | undefined,
): LegacyRecord[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const records: LegacyRecord[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as Record<string, unknown>;
    const { id, completedAt } = candidate;
    const durationSeconds = Number(candidate.durationSeconds);
    const score = Number(candidate.score);
    const correctCount = Number(candidate.correctCount);
    if (typeof id !== 'string' || typeof completedAt !== 'string') continue;
    if (
      !Number.isFinite(durationSeconds) ||
      !Number.isFinite(score) ||
      !Number.isFinite(correctCount)
    )
      continue;
    records.push({ id, completedAt, durationSeconds, score, correctCount });
  }
  return records;
}

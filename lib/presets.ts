import type { Level } from './questions.js';

export type QuestionCounts = Record<Level, number>;

export type PracticePreset = {
  key: string;
  version: number;
  name: string;
  description: string;
  emoji: string;
  color: string;
  recommended?: boolean;
  counts: QuestionCounts;
  challengerChain: boolean;
};

export const PRESETS: PracticePreset[] = [
  {
    key: 'sprout', version: 1, name: '星芽启航', emoji: '🌱', color: 'coral',
    description: '轻松热身，建立信心', counts: { starter: 10, explorer: 0, challenger: 0 }, challengerChain: false,
  },
  {
    key: 'forest', version: 1, name: '森林成长', emoji: '🌳', color: 'green',
    description: '从基础走向进阶', counts: { starter: 5, explorer: 10, challenger: 0 }, challengerChain: false,
  },
  {
    key: 'balanced', version: 1, name: '均衡冒险', emoji: '🚀', color: 'purple', recommended: true,
    description: '三种题型均衡练习', counts: { starter: 10, explorer: 10, challenger: 10 }, challengerChain: false,
  },
  {
    key: 'rocket', version: 1, name: '火箭进阶', emoji: '🔥', color: 'orange',
    description: '强化100以内连加连减', counts: { starter: 5, explorer: 10, challenger: 15 }, challengerChain: true,
  },
  {
    key: 'planet', version: 1, name: '星球挑战', emoji: '🪐', color: 'blue',
    description: '高手的连算耐力大挑战', counts: { starter: 0, explorer: 10, challenger: 30 }, challengerChain: true,
  },
];

export function getPreset(key: string, version: number) {
  return PRESETS.find((preset) => preset.key === key && preset.version === version);
}

export function totalQuestions(counts: QuestionCounts) {
  return counts.starter + counts.explorer + counts.challenger;
}

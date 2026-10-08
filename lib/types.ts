import type { Level, QuestionCounts, QuestionPrompt } from './questions';

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: 'parent' | 'site_owner' | 'child';
  mustChangePassword: boolean;
};
export type RoundQuestion = {
  id: string;
  position: number;
  level: Level;
  expression: string;
  answer: string;
  clientVersion: number;
  promptData?: QuestionPrompt;
  isCorrect?: boolean;
  correctAnswer?: number;
};
export type Round = {
  mode: 'practice' | 'challenge';
  id: string;
  status: 'generated' | 'started' | 'completed';
  source: string;
  packageName: string;
  counts: QuestionCounts;
  totalCount: number;
  startedAt: string | null;
  completedAt: string | null;
  challengerChain: boolean;
  questions: RoundQuestion[];
};
export type RecordItem = {
  mode?: 'practice' | 'challenge';
  id: string;
  package_name: string;
  starter_count: number;
  explorer_count: number;
  challenger_count: number;
  multiply_meaning_count: number;
  multiply_facts_count: number;
  multiply_mixed_count: number;
  division_meaning_count: number;
  division_facts_count: number;
  mixed_word_problem_count: number;
  abacus_move_count: number;
  abacus_match_count: number;
  abacus_calculation_count: number;
  total_count: number;
  score: number;
  correct_count: number;
  duration_seconds: number;
  started_at: string;
  completed_at: string;
  questions: RoundQuestion[];
};
export type WrongItem = {
  id: string;
  expression: string;
  correct_answer: number;
  level: Level;
  mistake_count: number;
  last_answer: string;
  last_seen_at: string;
  prompt_data?: QuestionPrompt;
  review_count: number;
  correct_streak: number;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  mastered_at: string | null;
};
export type ChildItem = {
  id: string;
  username: string;
  display_name: string;
  is_active: boolean;
  must_change_password: boolean;
  round_count: number;
  average_score: number;
  last_practiced_at: string | null;
};
export type LegacyRecord = {
  id: string;
  completedAt: string;
  durationSeconds: number;
  score: number;
  correctCount: number;
};
export type CreateRoundInput = {
  source: 'custom';
  counts: QuestionCounts;
  challengerChain: boolean;
  mode: 'practice' | 'challenge';
};

export type LearningPreferences = {
  counts: QuestionCounts;
  challengerChain: boolean;
  mode: 'practice' | 'challenge';
};

export type TopicProgress = {
  level: Level;
  attempted: number;
  correct: number;
  recent_accuracy: number | null;
  previous_accuracy: number | null;
};
export type LearningProgress = {
  topics: TopicProgress[];
  summary: {
    rounds: number;
    questions: number;
    correct: number;
    practice_days: number;
  };
  recent: Array<{
    completed_at: string;
    total_count: number;
    correct_count: number;
    mode: string;
  }>;
};

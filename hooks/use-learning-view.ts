'use client';
import { useEffect, useState } from 'react';
export type LearningView =
  | 'home'
  | 'practice'
  | 'review'
  | 'history'
  | 'result';
const allowed: LearningView[] = [
  'home',
  'practice',
  'review',
  'history',
  'result',
];
function readView(): LearningView {
  const value = location.hash.slice(1) as LearningView;
  return allowed.includes(value) ? value : 'home';
}
export function useLearningView() {
  const [view, setView] = useState<LearningView>(() =>
    typeof window === 'undefined' ? 'home' : readView(),
  );
  useEffect(() => {
    const update = () => setView(readView());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const navigate = (next: LearningView) => {
    if (location.hash !== `#${next}`) location.hash = next;
    setView(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  return [view, navigate] as const;
}

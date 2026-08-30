'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  History,
  PartyPopper,
  Play,
  RefreshCw,
  Rocket,
  Sparkles,
  Star,
  Target,
  Trophy,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { makeQuestions, scoreMessage, type Level } from '@/lib/questions';
import { cn } from '@/lib/utils';

const LEVELS: Array<{
  key: Level;
  title: string;
  subtitle: string;
  badge: string;
  accent: string;
  soft: string;
  border: string;
}> = [
  {
    key: 'starter',
    title: '热身小跑',
    subtitle: '10 以内加减法',
    badge: '第 1 关',
    accent: 'text-[#F15B45]',
    soft: 'bg-[#FFF1EC]',
    border: 'border-[#FFD9CD]',
  },
  {
    key: 'explorer',
    title: '森林探险',
    subtitle: '20 以内加减法',
    badge: '第 2 关',
    accent: 'text-[#0F8F72]',
    soft: 'bg-[#EAF8F2]',
    border: 'border-[#C9EBDD]',
  },
  {
    key: 'challenger',
    title: '星球挑战',
    subtitle: '100 以内进退位加减混合',
    badge: '第 3 关',
    accent: 'text-[#6755D9]',
    soft: 'bg-[#F0EDFF]',
    border: 'border-[#DAD3FF]',
  },
];

type RoundStatus = 'idle' | 'running' | 'finished';

type PracticeRecord = {
  id: string;
  completedAt: string;
  durationSeconds: number;
  score: number;
  correctCount: number;
};

type WrongQuestion = {
  expression: string;
  answer: number;
  lastAnswer: string;
  level: Level;
  mistakes: number;
  lastSeenAt: string;
};

const RECORDS_KEY = 'kousuan-planet-records-v1';
const WRONG_BOOK_KEY = 'kousuan-planet-wrong-book-v1';

function readStorage<T>(key: string, fallback: T): T {
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? JSON.parse(saved) as T : fallback;
  } catch {
    return fallback;
  }
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatRecordDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function Home() {
  const [roundSeed, setRoundSeed] = useState(438721);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [score, setScore] = useState<number | null>(null);
  const [roundStatus, setRoundStatus] = useState<RoundStatus>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [records, setRecords] = useState<PracticeRecord[]>([]);
  const [wrongBook, setWrongBook] = useState<WrongQuestion[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const startedAtRef = useRef<number | null>(null);
  const questions = useMemo(() => makeQuestions(roundSeed), [roundSeed]);

  useEffect(() => {
    const loadStorage = window.setTimeout(() => {
      setRecords(readStorage<PracticeRecord[]>(RECORDS_KEY, []));
      setWrongBook(readStorage<WrongQuestion[]>(WRONG_BOOK_KEY, []));
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(loadStorage);
  }, []);

  useEffect(() => {
    if (roundStatus !== 'running') return;

    const updateElapsed = () => {
      if (startedAtRef.current === null) return;
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    };

    updateElapsed();
    const interval = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(interval);
  }, [roundStatus]);

  const answeredCount = questions.filter(
    (question) => (answers[question.id] ?? '').trim() !== '',
  ).length;
  const allAnswered = answeredCount === questions.length;
  const correctAnswersCount = score === null
    ? 0
    : questions.filter((question) => Number(answers[question.id]) === question.answer).length;

  const startRound = () => {
    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setRoundStatus('running');
    window.setTimeout(() => inputRefs.current[0]?.focus(), 80);
  };

  const submitAnswers = () => {
    if (!allAnswered || roundStatus !== 'running') return;
    const correct = questions.filter(
      (question) => Number(answers[question.id]) === question.answer,
    ).length;
    const finalScore = Math.round((correct / questions.length) * 100);
    const finalDuration = startedAtRef.current === null
      ? elapsedSeconds
      : Math.floor((Date.now() - startedAtRef.current) / 1000);
    const completedAt = new Date().toISOString();
    const record: PracticeRecord = {
      id: `${Date.now()}-${roundSeed}`,
      completedAt,
      durationSeconds: finalDuration,
      score: finalScore,
      correctCount: correct,
    };
    const nextRecords = [record, ...records].slice(0, 50);
    const wrongAnswers = questions.filter(
      (question) => Number(answers[question.id]) !== question.answer,
    );
    const nextWrongBook = [...wrongBook];

    wrongAnswers.forEach((question) => {
      const existingIndex = nextWrongBook.findIndex(
        (item) => item.expression === question.expression && item.answer === question.answer,
      );
      const nextItem: WrongQuestion = {
        expression: question.expression,
        answer: question.answer,
        lastAnswer: answers[question.id] ?? '',
        level: question.level,
        mistakes: existingIndex >= 0 ? nextWrongBook[existingIndex].mistakes + 1 : 1,
        lastSeenAt: completedAt,
      };

      if (existingIndex >= 0) nextWrongBook.splice(existingIndex, 1);
      nextWrongBook.unshift(nextItem);
    });

    setElapsedSeconds(finalDuration);
    setRoundStatus('finished');
    setScore(finalScore);
    setRecords(nextRecords);
    setWrongBook(nextWrongBook);
    window.localStorage.setItem(RECORDS_KEY, JSON.stringify(nextRecords));
    window.localStorage.setItem(WRONG_BOOK_KEY, JSON.stringify(nextWrongBook));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startNextRound = () => {
    setRoundSeed(Math.floor(Math.random() * 2_000_000_000));
    setAnswers({});
    setScore(null);
    setRoundStatus('idle');
    setElapsedSeconds(0);
    startedAtRef.current = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const result = score === null ? null : scoreMessage(score);

  return (
    <main className="min-h-screen overflow-hidden pb-36 text-[#26334A]">
      <div className="sky-glow sky-glow-left" aria-hidden="true" />
      <div className="sky-glow sky-glow-right" aria-hidden="true" />

      <header className="relative z-10 border-b border-white/70 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="grid size-11 rotate-[-5deg] place-items-center rounded-[16px] bg-[#6755D9] text-white shadow-[0_7px_0_#4E3DC4]">
              <Rocket className="size-6" strokeWidth={2.6} />
            </span>
            <div>
              <p className="font-title text-xl font-black tracking-tight text-[#26334A] sm:text-2xl">
                口算星球
              </p>
              <p className="hidden text-xs font-semibold text-[#7B879E] sm:block">每天一小步，数学一大步</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-[#FFDF8D] bg-[#FFF7D9] px-4 py-2 text-sm font-extrabold text-[#A86600] shadow-sm">
            <Star className="size-4 fill-[#FFC740] text-[#E9A900]" />
            30 颗挑战星
          </div>
        </div>
      </header>

      <div className="relative z-[1] mx-auto max-w-6xl px-5 pt-8 sm:px-8 sm:pt-12">
        <section className="hero-panel relative overflow-hidden rounded-[32px] border border-white/80 px-6 py-7 shadow-[0_24px_70px_rgba(93,78,176,0.13)] sm:px-10 sm:py-9">
          <div className="absolute -right-4 -top-8 hidden text-[#8071E9]/10 md:block" aria-hidden="true">
            <Sparkles className="size-52" strokeWidth={1.4} />
          </div>

          {score === null ? (
            <div className="relative grid items-center gap-7 lg:grid-cols-[1fr_300px]">
              <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-1.5 text-xs font-extrabold text-[#6755D9] shadow-sm">
                  <Sparkles className="size-3.5" /> 今日口算大冒险
                </div>
                <h1 className="font-title max-w-2xl text-3xl font-black leading-tight tracking-tight text-[#26334A] sm:text-5xl">
                  准备好了吗？<br />
                  <span className="text-[#6755D9]">闯过 3 关</span>，收集智慧星！
                </h1>
                <p className="mt-4 max-w-xl text-sm font-semibold leading-7 text-[#6F7B91] sm:text-base">
                  一共 30 道题。点击开始后计时，全部完成就能自动批改，成绩和错题也会帮你保存好。
                </p>
                {roundStatus === 'idle' && (
                  <Button
                    onClick={startRound}
                    disabled={!storageReady}
                    size="lg"
                    className="mt-6 h-13 rounded-2xl bg-[#F15B45] px-7 text-base font-extrabold shadow-[0_6px_0_#C83F2D] hover:bg-[#FA6C55] active:translate-y-1 active:shadow-[0_2px_0_#C83F2D]"
                  >
                    <Play className="size-5 fill-current" /> 开始答题
                  </Button>
                )}
              </div>

              <div className="space-y-3">
                <img
                  src="/og.png"
                  alt="小火箭、星星和数字组成的口算星球插画"
                  className="hidden aspect-[1200/630] w-full rounded-[22px] border-4 border-white object-cover shadow-[0_10px_30px_rgba(79,62,160,0.14)] lg:block"
                />
                <div className="flex items-center gap-4 rounded-[24px] border border-white bg-white/75 p-4 shadow-[0_12px_35px_rgba(79,62,160,0.1)] sm:min-w-[260px]">
                  <div className="progress-orbit" style={{ '--progress': `${answeredCount * 12}deg` } as React.CSSProperties}>
                    <div>
                      <strong>{answeredCount}</strong>
                      <span>/ 30</span>
                    </div>
                  </div>
                  <div>
                    <p className="font-title text-lg font-black">答题进度</p>
                    <p className="mt-1 text-xs font-semibold text-[#8993A6]">
                      {allAnswered ? '全部完成，可以交卷啦！' : `还有 ${30 - answeredCount} 道题`}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <a href="#practice-records" className="mini-stat-card">
                    <History className="size-4 text-[#6755D9]" />
                    <strong>{records.length}</strong>
                    <span>答题记录</span>
                  </a>
                  <a href="#wrong-book" className="mini-stat-card">
                    <BookOpen className="size-4 text-[#F15B45]" />
                    <strong>{wrongBook.length}</strong>
                    <span>错题本</span>
                  </a>
                  <div className="mini-stat-card">
                    <Clock3 className="size-4 text-[#0F8F72]" />
                    <strong>{formatDuration(elapsedSeconds)}</strong>
                    <span>{roundStatus === 'running' ? '正在计时' : '本轮用时'}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative flex flex-col items-center py-2 text-center sm:py-5">
              <div className="mb-4 grid size-20 place-items-center rounded-[26px] bg-[#FFF3BE] text-[#E39B00] shadow-[0_8px_0_#F2D56A]">
                {score === 100 ? <Trophy className="size-11" strokeWidth={2.4} /> : <PartyPopper className="size-11" strokeWidth={2.4} />}
              </div>
              <p className="text-sm font-extrabold text-[#7565DD]">本轮得分</p>
              <p className="font-title mt-1 text-6xl font-black text-[#6755D9] sm:text-7xl">
                {score}<span className="ml-1 text-2xl">分</span>
              </p>
              <h1 className="font-title mt-4 text-2xl font-black sm:text-3xl">{result?.title}</h1>
              <p className="mt-2 font-semibold text-[#778298]">{result?.note}</p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm font-extrabold">
                <span className="rounded-full bg-white px-4 py-2 shadow-sm">
                  <Clock3 className="mr-1.5 inline size-4 text-[#0F8F72]" />用时 {formatDuration(elapsedSeconds)}
                </span>
                <span className="rounded-full bg-white px-4 py-2 shadow-sm">
                  <Target className="mr-1.5 inline size-4 text-[#6755D9]" />答对 {correctAnswersCount} / 30
                </span>
              </div>
              <Button
                onClick={startNextRound}
                size="lg"
                className="mt-6 h-12 rounded-2xl bg-[#6755D9] px-6 text-base font-extrabold shadow-[0_6px_0_#4D3CBE] hover:bg-[#7565DD] active:translate-y-1 active:shadow-[0_2px_0_#4D3CBE]"
              >
                <RefreshCw className="size-5" /> 再来一轮新题
              </Button>
            </div>
          )}
        </section>

        <div className="mt-8 space-y-7">
          {LEVELS.map((level, levelIndex) => {
            const levelQuestions = questions.filter((question) => question.level === level.key);
            const correctInLevel = score === null
              ? null
              : levelQuestions.filter((question) => Number(answers[question.id]) === question.answer).length;

            return (
              <section
                key={level.key}
                className={cn('overflow-hidden rounded-[28px] border bg-white/90 shadow-[0_16px_45px_rgba(53,64,91,0.08)]', level.border)}
              >
                <div className={cn('flex flex-wrap items-center justify-between gap-4 border-b px-5 py-5 sm:px-7', level.soft, level.border)}>
                  <div className="flex items-center gap-4">
                    <span className={cn('grid size-12 place-items-center rounded-2xl bg-white font-title text-xl font-black shadow-sm', level.accent)}>
                      {levelIndex + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={cn('text-xs font-extrabold', level.accent)}>{level.badge}</span>
                        <ChevronRight className={cn('size-3.5', level.accent)} />
                        <span className="text-xs font-bold text-[#8A94A7]">共 10 题</span>
                      </div>
                      <h2 className="font-title mt-1 text-xl font-black sm:text-2xl">{level.title}</h2>
                      <p className="mt-0.5 text-xs font-semibold text-[#778298] sm:text-sm">{level.subtitle}</p>
                    </div>
                  </div>

                  {correctInLevel !== null && (
                    <div className="rounded-full bg-white px-4 py-2 text-sm font-extrabold text-[#536078] shadow-sm">
                      答对 <span className={level.accent}>{correctInLevel}</span> / 10
                    </div>
                  )}
                </div>

                <div className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2 sm:p-7 lg:grid-cols-5">
                  {levelQuestions.map((question, questionIndex) => {
                    const globalIndex = levelIndex * 10 + questionIndex;
                    const value = answers[question.id] ?? '';
                    const isCorrect = score !== null && Number(value) === question.answer;
                    const isWrong = score !== null && !isCorrect;

                    return (
                      <div key={question.id} className="group">
                        <label
                          htmlFor={question.id}
                          className={cn(
                            'flex min-h-[76px] items-center gap-2 rounded-2xl border-2 bg-[#FBFCFE] px-3 transition-all focus-within:-translate-y-0.5 focus-within:border-[#8B7CEB] focus-within:bg-white focus-within:shadow-[0_8px_24px_rgba(103,85,217,0.12)]',
                            isCorrect && 'border-[#73D3B2] bg-[#F1FBF7]',
                            isWrong && 'border-[#FF9E8B] bg-[#FFF5F2]',
                            score === null && 'border-[#E8EBF2]',
                          )}
                        >
                          <span className="w-5 shrink-0 text-xs font-extrabold text-[#A2AABC]">{globalIndex + 1}.</span>
                          <span className="font-title whitespace-nowrap text-[17px] font-black tracking-tight text-[#334057]">
                            {question.expression} =
                          </span>
                          <Input
                            ref={(element) => { inputRefs.current[globalIndex] = element; }}
                            id={question.id}
                            type="number"
                            inputMode="numeric"
                            aria-label={`第 ${globalIndex + 1} 题答案`}
                            value={value}
                            disabled={roundStatus !== 'running'}
                            onChange={(event) => {
                              setAnswers((current) => ({ ...current, [question.id]: event.target.value }));
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && globalIndex < questions.length - 1) {
                                event.preventDefault();
                                inputRefs.current[globalIndex + 1]?.focus();
                              }
                            }}
                            className={cn(
                              'h-11 min-w-0 flex-1 rounded-xl border-0 bg-white px-2 text-center font-title text-lg font-black shadow-inner focus-visible:ring-2 focus-visible:ring-[#8B7CEB]/30 disabled:opacity-100',
                              isCorrect && 'text-[#08775E]',
                              isWrong && 'text-[#D14936]',
                            )}
                          />
                          {isCorrect && <Check className="size-5 shrink-0 text-[#16A57F]" strokeWidth={3} />}
                          {isWrong && <CircleAlert className="size-5 shrink-0 text-[#EF725E]" strokeWidth={2.5} />}
                        </label>
                        {isWrong && (
                          <p className="mt-1.5 pl-8 text-xs font-bold text-[#D45745]">
                            正确答案：{question.answer}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <section id="practice-records" className="mt-8 scroll-mt-6 rounded-[28px] border border-[#DAD3FF] bg-white/90 p-5 shadow-[0_16px_45px_rgba(53,64,91,0.08)] sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-[#F0EDFF] px-3 py-1.5 text-xs font-extrabold text-[#6755D9]">
                <History className="size-3.5" /> 成长足迹
              </div>
              <h2 className="font-title mt-3 text-2xl font-black">答题记录</h2>
              <p className="mt-1 text-sm font-semibold text-[#778298]">每一次认真完成，都值得被记住。记录保存在这台设备上。</p>
            </div>
            {records.length > 0 && (
              <div className="rounded-2xl bg-[#FFF7D9] px-4 py-2 text-sm font-extrabold text-[#A86600]">
                最高分 {Math.max(...records.map((item) => item.score))} 分
              </div>
            )}
          </div>

          {!storageReady ? (
            <p className="mt-5 text-sm font-semibold text-[#8993A6]">正在打开成长档案...</p>
          ) : records.length === 0 ? (
            <div className="empty-state mt-5">
              <Trophy className="size-8 text-[#D3A316]" />
              <div><strong>还没有答题记录</strong><span>完成第一轮挑战后，成绩会出现在这里。</span></div>
            </div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {records.map((record, index) => (
                <article key={record.id} className="record-card">
                  <div className="flex items-center justify-between gap-3">
                    <span className="grid size-9 place-items-center rounded-xl bg-[#F0EDFF] font-title text-sm font-black text-[#6755D9]">{index + 1}</span>
                    <time className="text-xs font-bold text-[#929BAD]">{formatRecordDate(record.completedAt)}</time>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <p className="font-title text-3xl font-black text-[#6755D9]">{record.score}<span className="ml-1 text-sm">分</span></p>
                    <p className="text-right text-xs font-bold leading-5 text-[#778298]">答对 {record.correctCount} 题<br />用时 {formatDuration(record.durationSeconds)}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section id="wrong-book" className="mt-7 scroll-mt-6 rounded-[28px] border border-[#FFD9CD] bg-white/90 p-5 shadow-[0_16px_45px_rgba(53,64,91,0.08)] sm:p-7">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#FFF1EC] px-3 py-1.5 text-xs font-extrabold text-[#E24C38]">
              <BookOpen className="size-3.5" /> 查漏补缺
            </div>
            <h2 className="font-title mt-3 text-2xl font-black">我的错题本</h2>
            <p className="mt-1 text-sm font-semibold text-[#778298]">错题不是小怪兽，是帮我们进步的藏宝图。</p>
          </div>

          {!storageReady ? (
            <p className="mt-5 text-sm font-semibold text-[#8993A6]">正在整理错题...</p>
          ) : wrongBook.length === 0 ? (
            <div className="empty-state mt-5">
              <Star className="size-8 fill-[#FFC740] text-[#E9A900]" />
              <div><strong>错题本还是空的</strong><span>答错的题会自动收进来，相同题目会累计次数。</span></div>
            </div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {wrongBook.map((item) => (
                <article key={`${item.expression}-${item.answer}`} className="wrong-card">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-title text-xl font-black text-[#334057]">{item.expression} = <span className="text-[#0F8F72]">{item.answer}</span></p>
                    <span className="shrink-0 rounded-full bg-[#FFF1EC] px-2.5 py-1 text-[11px] font-extrabold text-[#E24C38]">错过 {item.mistakes} 次</span>
                  </div>
                  <p className="mt-3 text-xs font-bold text-[#8A94A7]">上次答案：<span className="text-[#D45745]">{item.lastAnswer || '未填写'}</span></p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/80 bg-white/85 px-5 py-4 shadow-[0_-12px_40px_rgba(42,52,77,0.1)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="hidden sm:block">
            <p className="font-title font-black">
              {roundStatus === 'idle' ? '准备好就开始挑战' : score === null ? `已完成 ${answeredCount} / 30` : '本轮已经批改完成'}
            </p>
            <p className="mt-0.5 text-xs font-semibold text-[#8993A6]">
              {roundStatus === 'idle' ? '点击开始答题后才会计时' : score === null ? (allAnswered ? '太棒了，现在可以交卷！' : `计时 ${formatDuration(elapsedSeconds)} · 做完全部题目后即可交卷`) : `本轮用时 ${formatDuration(elapsedSeconds)} · 看看错题，再开启新挑战`}
            </p>
          </div>

          <div className="flex w-full items-center gap-3 sm:w-auto">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#E9E6FA] sm:hidden">
              <div className="h-full rounded-full bg-[#7565DD] transition-all" style={{ width: `${(answeredCount / 30) * 100}%` }} />
            </div>
            {roundStatus === 'idle' ? (
              <Button
                onClick={startRound}
                disabled={!storageReady}
                size="lg"
                className="h-12 min-w-[148px] rounded-2xl bg-[#F15B45] px-6 text-base font-extrabold shadow-[0_6px_0_#C83F2D] hover:bg-[#FA6C55] active:translate-y-1 active:shadow-[0_2px_0_#C83F2D]"
              >
                <Play className="size-5 fill-current" /> 开始答题
              </Button>
            ) : score === null ? (
              <Button
                onClick={submitAnswers}
                disabled={!allAnswered}
                size="lg"
                className="h-12 min-w-[148px] rounded-2xl bg-[#6755D9] px-6 text-base font-extrabold shadow-[0_6px_0_#4D3CBE] hover:bg-[#7565DD] disabled:shadow-none active:translate-y-1 active:shadow-[0_2px_0_#4D3CBE]"
              >
                <Check className="size-5" /> 检查答案
              </Button>
            ) : (
              <Button
                onClick={startNextRound}
                size="lg"
                className="h-12 min-w-[148px] rounded-2xl bg-[#6755D9] px-6 text-base font-extrabold shadow-[0_6px_0_#4D3CBE] hover:bg-[#7565DD] active:translate-y-1 active:shadow-[0_2px_0_#4D3CBE]"
              >
                <RefreshCw className="size-5" /> 下一轮
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

'use client';

/**
 * 乘除应用题开发预览页（仅 DEV 使用，无登录、无数据库、不发任何请求）。
 *
 * 复用正式题目生成器（makeQuestionsForCounts）与正式答题组件
 * （WordProblemQuestion），同时展示三道固定示例与一组随机新题，
 * 方便人工核对题干、条件/问题点选、隐藏条件校验与最终答案。
 */
import { useMemo, useState } from 'react';

import { emptyCounts } from '@/lib/learning';
import { makeQuestionsForCounts, type Question } from '@/lib/questions';
import type { RoundQuestion } from '@/lib/types';
import {
  asWordProblemV2Prompt,
  clearWordProblemStepDraft,
  wordProblemExamples,
  type FixedWordProblem,
  type WordProblemKind,
  type WordProblemV2Prompt,
} from '@/lib/word-problems';

import { WordProblemQuestion } from './WordProblemQuestion';

const INITIAL_SEED = 20261020;
const RANDOM_QUESTION_COUNT = 9;

const KIND_LABELS: Record<WordProblemKind, string> = {
  multiplyTotal: '乘法求总数',
  divisionShare: '除法·平均分',
  divisionGroup: '除法·按份分组',
  weekTotal: '隐藏条件·一个星期',
};

type PreviewItem = {
  question: RoundQuestion;
  prompt: WordProblemV2Prompt;
  /** 参考答案（数字），与 prompt.answerUnit 拼成最终答案。 */
  expected: number;
  /** e2e 使用的稳定外层卡片标记。 */
  testId: string;
  label: string;
};

function exampleToQuestion(
  example: FixedWordProblem,
  position: number,
): RoundQuestion {
  return {
    id: example.id,
    position,
    level: 'mixedWordProblem',
    expression: example.prompt.story,
    answer: '',
    clientVersion: 1,
    promptData: example.prompt,
  };
}

function generatedToQuestion(
  question: Question,
  position: number,
): RoundQuestion {
  return {
    id: question.id,
    position,
    level: question.level,
    expression: question.expression,
    answer: '',
    clientVersion: 1,
    promptData: question.promptData,
  };
}

/** 三道固定示例与种子无关，模块加载时转换一次即可。 */
const EXAMPLE_ITEMS: PreviewItem[] = wordProblemExamples.map(
  (example, index) => ({
    question: exampleToQuestion(example, index + 1),
    prompt: example.prompt,
    expected: example.answer,
    testId: `preview-card-${example.id}`,
    label: example.label,
  }),
);

function ReferenceAnswer({
  prompt,
  expected,
}: {
  prompt: WordProblemV2Prompt;
  expected: number;
}) {
  const conditions = prompt.conditionIds.map(
    (id) =>
      prompt.parts.find((part) => part.type !== 'text' && part.id === id)
        ?.text ?? id,
  );
  const questionText =
    prompt.parts.find(
      (part) => part.type === 'question' && part.id === prompt.questionId,
    )?.text ?? prompt.story;
  return (
    <details
      data-testid="preview-reference"
      className="mt-3 min-w-0 rounded-xl border border-[#e2e5ee] bg-[#f7f8fc] px-3 py-2 text-sm text-[#4b5568]"
    >
      <summary className="cursor-pointer text-xs font-bold text-[#6250cf]">
        家长核对参考答案
      </summary>
      <div className="mt-2 grid gap-1">
        <p className="min-w-0 break-words">
          <strong className="font-bold">已知条件：</strong>
          {conditions.join('、')}
        </p>
        {prompt.hiddenCondition ? (
          <p className="min-w-0 break-words">
            <strong className="font-bold">隐藏条件：</strong>
            一个星期有 7 天
          </p>
        ) : null}
        <p className="min-w-0 break-words">
          <strong className="font-bold">所求问题：</strong>
          {questionText}
        </p>
        <p className="min-w-0 break-words">
          <strong className="font-bold">最终答案：</strong>
          <span className="font-black text-[#18724f]">
            {expected}
            {prompt.answerUnit}
          </span>
        </p>
      </div>
    </details>
  );
}

function PreviewCard({
  item,
  answer,
  onAnswer,
  checkAnswer,
}: {
  item: PreviewItem;
  answer: string;
  onAnswer: (id: string, value: string) => void;
  checkAnswer: (question: RoundQuestion, value: string) => boolean;
}) {
  return (
    <article
      data-testid={item.testId}
      data-kind={item.prompt.kind}
      className="panel min-w-0 p-4 sm:p-5"
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-title min-w-0 text-base font-black break-words text-[#29364d]">
          {item.label}
        </h3>
        <span className="shrink-0 rounded-full bg-[#f0edff] px-2.5 py-1 text-[11px] font-bold text-[#4a3bab]">
          {KIND_LABELS[item.prompt.kind]}
        </span>
      </header>
      <WordProblemQuestion
        question={item.question}
        answer={answer}
        onAnswer={onAnswer}
        checkAnswer={checkAnswer}
      />
      <ReferenceAnswer prompt={item.prompt} expected={item.expected} />
    </article>
  );
}

export function WordProblemPreview() {
  const [seed, setSeed] = useState(INITIAL_SEED);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remountKey, setRemountKey] = useState(0);

  // 随机题由 seed 决定，属于同一次生成的结果；用 useMemo 避免每次输入
  // 重渲染都重新跑一遍生成器（题目 id 与内容对同一个 seed 恒定）。
  const randomItems = useMemo<PreviewItem[]>(() => {
    const generated = makeQuestionsForCounts(seed, {
      ...emptyCounts,
      mixedWordProblem: RANDOM_QUESTION_COUNT,
    });
    return generated.flatMap<PreviewItem>((question, index): PreviewItem[] => {
      const prompt = asWordProblemV2Prompt(question.promptData);
      if (!prompt) return [];
      return [
        {
          question: generatedToQuestion(question, index + 1),
          prompt,
          expected: question.answer,
          testId: `preview-card-random-${index}`,
          label: `随机题 ${index + 1} · ${KIND_LABELS[prompt.kind]}`,
        },
      ];
    });
  }, [seed]);

  const expectedAnswers = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of EXAMPLE_ITEMS) map[item.question.id] = item.expected;
    for (const item of randomItems) map[item.question.id] = item.expected;
    return map;
  }, [randomItems]);

  const handleAnswer = (id: string, value: string) => {
    setAnswers((previous) => ({ ...previous, [id]: value }));
  };

  // 只在最后一步点「检查答案」时由 WordProblemQuestion 调用。
  const checkAnswer = (question: RoundQuestion, value: string) =>
    Number(value) === expectedAnswers[question.id];

  const clearDrafts = () => {
    for (const item of [...EXAMPLE_ITEMS, ...randomItems])
      clearWordProblemStepDraft(item.question.id);
  };

  const restart = () => {
    clearDrafts();
    setAnswers({});
    setRemountKey((key) => key + 1);
  };

  const nextGroup = () => {
    clearDrafts();
    setSeed((value) => value + 1);
    setAnswers({});
    setRemountKey((key) => key + 1);
  };

  const renderSection = (
    id: string,
    title: string,
    hint: string,
    items: PreviewItem[],
  ) => (
    <section aria-labelledby={id} className="min-w-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2
          id={id}
          className="font-title text-lg font-black text-[#29364d] sm:text-xl"
        >
          {title}
        </h2>
        <span className="text-xs font-bold text-[#66728a]">{hint}</span>
      </div>
      <div className="grid gap-4">
        {items.map((item) => (
          <PreviewCard
            key={`${remountKey}-${item.question.id}`}
            item={item}
            answer={answers[item.question.id] ?? ''}
            onAnswer={handleAnswer}
            checkAnswer={checkAnswer}
          />
        ))}
      </div>
    </section>
  );

  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 pt-6 pb-16 sm:px-6 lg:px-8">
      <header className="panel mb-6 p-5 sm:p-7">
        <span className="eyebrow">开发预览 · 仅 DEV 可用</span>
        <h1 className="font-title mt-3 text-2xl leading-tight font-black text-[#29364d] sm:text-3xl">
          应用题分步答题预览
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#66728a] sm:text-base">
          这是本地开发预览页（仅 DEV 可用）：复用正式题目生成器与同一个答题组件，
          方便检查三道原始示例和随机新题。普通题按「条件 → 问题 → 答案」3
          步作答；隐藏条件题在条件与问题之间多一步「找隐藏条件」，共 4 步。
        </p>
        <p className="mt-3 rounded-xl border border-[#ffd8a8] bg-[#fff8ec] px-3 py-2 text-sm font-bold text-[#9a5b12]">
          仅开发环境 · 不连接数据库与账号 · 生产构建不暴露此入口
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="primary-button" onClick={restart}>
            重新开始
          </button>
          <button type="button" className="soft-button" onClick={nextGroup}>
            换一组
          </button>
          <button
            type="button"
            className="soft-button"
            onClick={() => window.location.assign('/')}
          >
            返回首页
          </button>
          <span className="text-xs font-bold text-[#66728a]">
            当前随机种子：{seed}
          </span>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[#8a93a6]">
          每张卡片下方可展开「家长核对参考答案」：已知条件、隐藏条件、所求问题与最终答案。
          重新开始 / 换一组会清空本地答案与分步草稿，并把卡片重置回第一步。
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {renderSection(
          'preview-fixed-heading',
          '三道固定示例',
          `共 ${EXAMPLE_ITEMS.length} 题 · 顺序与原始例子一致`,
          EXAMPLE_ITEMS,
        )}
        {renderSection(
          'preview-random-heading',
          '随机新题',
          `共 ${randomItems.length} 题 · 换一组换种子`,
          randomItems,
        )}
      </div>
    </main>
  );
}

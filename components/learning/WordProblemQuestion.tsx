'use client';
/**
 * 乘除应用题答题组件。
 *
 * - v2（lib/word-problems.ts 的 WordProblemV2Prompt）：顺序分步流程
 *   1) 在题干里点选已知条件；
 *   2) 有隐藏条件时，进入单独的隐藏条件步骤自由输入并验证（普通题没有这一步）；
 *   3) 点选题目要求的问题；
 *   4) 填写最终的数字答案。
 *   普通题共 3 步，隐藏条件题共 4 步。分步状态写入 sessionStorage 草稿，
 *   刷新页面或单题/整页切换后可以恢复；最终答案始终由父级 answer 控制，
 *   流程草稿里不保存答案。
 * - v1（旧版 steps）：保留原来的分步作答界面，历史轮次仍能继续作答。
 * - 没有 promptData / steps：回退到简单数字输入框。
 *
 * 答案统一通过 onAnswer(question.id, value) 交给外层保存；正式练习由服务端
 * 检查对错，只有开发预览页会传入 checkAnswer 做即时检查。
 */
import { useEffect, useState } from 'react';
import type { WordProblemPrompt } from '@/lib/questions';
import type { RoundQuestion } from '@/lib/types';
import {
  asWordProblemV2Prompt,
  checkConditionSelection,
  checkHiddenCondition,
  checkHiddenConditionStep,
  checkQuestionSelection,
  readWordProblemStepDraft,
  writeWordProblemStepDraft,
  type ConditionCheckCode,
  type WordProblemPart,
  type WordProblemStage,
  type WordProblemV2Prompt,
} from '@/lib/word-problems';

type WordProblemQuestionProps = {
  question: RoundQuestion;
  answer: string;
  onAnswer: (id: string, value: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  locked?: boolean;
  /** 仅开发预览页传入：返回孩子最终答案是否正确；正式练习不传，交给外层服务端检查 */
  checkAnswer?: (question: RoundQuestion, value: string) => boolean;
};

type FeedbackTone = 'error' | 'success' | 'progress';

type Feedback = {
  tone: FeedbackTone;
  text: string;
};

/** v2 流程的整块状态；从 sessionStorage 草稿初始化，避免散落的互相依赖的 effect。 */
type FlowState = {
  stage: WordProblemStage;
  conditionsVerified: boolean;
  questionVerified: boolean;
  selectedConditions: string[];
  selectedQuestions: string[];
  hiddenInput: string;
  clueOpen: boolean;
  /** 最近一次检查所用的答案，配合当前父级 answer 决定检查反馈是否仍然有效。 */
  checked: { answer: string; correct: boolean } | null;
  feedback: Feedback | null;
};

const STAGE_TITLES: Record<WordProblemStage, string> = {
  conditions: '找已知条件',
  hidden: '找隐藏条件',
  question: '找问题',
  answer: '算答案',
};

const STAGE_INSTRUCTIONS: Record<WordProblemStage, string> = {
  conditions: '点选题目里的已知条件（有几个选几个）。',
  hidden:
    '题目里藏着一个已知条件。想一想它表示多少，把它的意思写进下面的输入框。',
  question: '点选题目问的是什么。',
  answer: '把算出来的结果填在下面的答案框里。',
};

const CONDITION_ERRORS: Record<ConditionCheckCode, string> = {
  questionAsCondition:
    '你把问题当条件了，再点一下那个问题片段取消它，然后找真正的已知条件。',
  missing: '还有已知条件没选上，再读一遍题目，把有用的信息都点一点。',
  extra: '选到了不是解题需要的条件，再检查一下哪些信息真的有用。',
  hiddenMissing: '题目里藏着一个条件，先把它写进下面的输入框再继续。',
  hiddenInvalid:
    '隐藏条件还写得不对，再想一想它表示多少，用数字和「天」写清楚。',
};

/** v2 的步骤顺序：隐藏条件题在条件与问题之间多一步。 */
function stageSequence(hasHiddenCondition: boolean): WordProblemStage[] {
  return hasHiddenCondition
    ? ['conditions', 'hidden', 'question', 'answer']
    : ['conditions', 'question', 'answer'];
}

function stageLabel(
  stage: WordProblemStage,
  hasHiddenCondition: boolean,
): string {
  const steps = stageSequence(hasHiddenCondition);
  const index = steps.indexOf(stage);
  return `第 ${index + 1} 步 / 共 ${steps.length} 步：${STAGE_TITLES[stage]}`;
}

function nextButtonLabel(
  stage: WordProblemStage,
  hasHiddenCondition: boolean,
): string {
  if (stage === 'conditions')
    return hasHiddenCondition ? '下一步：找隐藏条件' : '下一步：找问题';
  if (stage === 'hidden') return '下一步：找问题';
  return '下一步：填答案';
}

/** 可被选为条件/问题的片段 id（text 与 clue 片段不参与选择）。 */
function selectablePartIds(prompt: WordProblemV2Prompt): Set<string> {
  const ids = new Set<string>();
  for (const part of prompt.parts) {
    if (part.type === 'condition' || part.type === 'question') ids.add(part.id);
  }
  return ids;
}

function clueText(prompt: WordProblemV2Prompt): string {
  return prompt.parts
    .filter(
      (part): part is Extract<WordProblemPart, { type: 'clue' }> =>
        part.type === 'clue',
    )
    .map((part) => part.text)
    .join('、');
}

function clueHint(
  prompt: WordProblemV2Prompt,
  stage: WordProblemStage,
): string {
  const text = clueText(prompt);
  if (!text) return '再读一遍题目，看看有没有藏起来的已知条件。';
  if (!prompt.hiddenCondition)
    return `提示：「${text}」里可能藏着重要的信息，再仔细读一读。`;
  if (stage === 'hidden')
    return `提示：「${text}」里藏着一个已知条件。想一想它表示多少，把想到的写进下面的「隐藏条件」里。`;
  return `提示：「${text}」里藏着一个已知条件。先把已知条件都选对，下一步再把它写出来。`;
}

/** 隐藏条件题在条件步骤通过、且输入意思正确时，才算找到了隐藏条件。 */
function isHiddenVerified(
  prompt: WordProblemV2Prompt,
  conditionsVerified: boolean,
  hiddenInput: string,
): boolean {
  const hidden = prompt.hiddenCondition;
  if (!hidden) return true;
  return (
    conditionsVerified &&
    checkHiddenCondition(hidden.kind, hiddenInput)
  );
}

/** 收敛草稿里的阶段：每一步都需要上一步已通过，否则回退到最近的合法步骤。 */
function createFlowState(
  questionId: string,
  prompt: WordProblemV2Prompt,
): FlowState {
  const draft = readWordProblemStepDraft(questionId, prompt.story);
  const selectable = selectablePartIds(prompt);
  const selectedConditions = (draft?.selectedConditions ?? []).filter((id) =>
    selectable.has(id),
  );
  const selectedQuestions = (draft?.selectedQuestions ?? []).filter((id) =>
    selectable.has(id),
  );
  const conditionsVerified =
    Boolean(draft?.conditionsVerified) && selectedConditions.length > 0;
  const questionVerified =
    Boolean(draft?.questionVerified) && selectedQuestions.length > 0;
  const hiddenInput = draft?.hiddenInput ?? '';
  const hiddenVerified = isHiddenVerified(
    prompt,
    conditionsVerified,
    hiddenInput,
  );
  let stage = draft?.stage ?? 'conditions';
  // 普通题没有隐藏条件步骤：即使草稿异常也不会停在一个空步骤上。
  if (stage === 'hidden' && !prompt.hiddenCondition)
    stage = conditionsVerified ? 'question' : 'conditions';
  const allowedStage = (target: WordProblemStage) => {
    if (target === 'conditions') return true;
    if (target === 'hidden') return conditionsVerified;
    if (target === 'question') return conditionsVerified && hiddenVerified;
    return conditionsVerified && hiddenVerified && questionVerified;
  };
  if (!allowedStage(stage)) {
    if (conditionsVerified && hiddenVerified && questionVerified) stage = 'answer';
    else if (conditionsVerified && hiddenVerified) stage = 'question';
    else if (conditionsVerified && prompt.hiddenCondition) stage = 'hidden';
    else stage = 'conditions';
  }
  return {
    stage,
    conditionsVerified,
    questionVerified,
    selectedConditions,
    selectedQuestions,
    hiddenInput,
    clueOpen: Boolean(draft?.clueOpen),
    checked: null,
    feedback: null,
  };
}

export function WordProblemQuestion({
  question,
  answer,
  onAnswer,
  onKeyDown,
  locked = false,
  checkAnswer,
}: WordProblemQuestionProps) {
  const prompt = asWordProblemV2Prompt(question.promptData);
  if (prompt)
    return (
      <WordProblemV2Flow
        question={question}
        answer={answer}
        onAnswer={onAnswer}
        onKeyDown={onKeyDown}
        locked={locked}
        checkAnswer={checkAnswer}
        prompt={prompt}
      />
    );
  const legacy = asLegacyWordProblemPrompt(question.promptData);
  if (legacy)
    return (
      <WordProblemLegacyFlow
        question={question}
        answer={answer}
        onAnswer={onAnswer}
        onKeyDown={onKeyDown}
        locked={locked}
        prompt={legacy}
      />
    );
  return (
    <WordProblemFallback
      question={question}
      answer={answer}
      onAnswer={onAnswer}
      onKeyDown={onKeyDown}
      locked={locked}
    />
  );
}

function WordProblemV2Flow({
  question,
  answer,
  onAnswer,
  onKeyDown,
  locked,
  checkAnswer,
  prompt,
}: WordProblemQuestionProps & { prompt: WordProblemV2Prompt }) {
  const [state, setState] = useState<FlowState>(() =>
    createFlowState(question.id, prompt),
  );
  const {
    stage,
    conditionsVerified,
    selectedConditions,
    selectedQuestions,
    hiddenInput,
    clueOpen,
    feedback,
    checked,
  } = state;
  const hasHiddenCondition = Boolean(prompt.hiddenCondition);
  const steps = stageSequence(hasHiddenCondition);
  const hiddenVerified = isHiddenVerified(
    prompt,
    conditionsVerified,
    hiddenInput,
  );

  // 唯一的分步状态落盘 effect：草稿失败已在 lib 内部 try/catch，不影响作答；
  // 草稿只有流程进度，不含最终答案（答案始终由父级 answer 保存）。
  useEffect(() => {
    writeWordProblemStepDraft(question.id, prompt.story, {
      stage,
      conditionsVerified,
      questionVerified: state.questionVerified,
      selectedConditions,
      selectedQuestions,
      hiddenInput,
      clueOpen,
    });
  }, [
    question.id,
    prompt.story,
    stage,
    conditionsVerified,
    state.questionVerified,
    selectedConditions,
    selectedQuestions,
    hiddenInput,
    clueOpen,
  ]);

  /** 上游一旦修改，就让下游验证与已填最终答案失效；仅返回上一步不调用。 */
  const clearSavedFinalAnswer = () => {
    if (locked) return;
    if (answer !== '') onAnswer(question.id, '');
  };

  const toggleCondition = (id: string) => {
    if (locked) return;
    clearSavedFinalAnswer();
    setState((prev) => {
      const next = prev.selectedConditions.includes(id)
        ? prev.selectedConditions.filter((item) => item !== id)
        : [...prev.selectedConditions, id];
      const feedbackUpdate: Feedback | null = next.includes(prompt.questionId)
        ? {
            tone: 'error',
            text: '这是题目要问的问题，不能把问题当条件；再点它一下可以取消。',
          }
        : next.length > 0
          ? {
              tone: 'progress',
              text: `已经点了 ${next.length} 个片段，找齐了就点「${nextButtonLabel('conditions', hasHiddenCondition)}」。`,
            }
          : null;
      return {
        ...prev,
        selectedConditions: next,
        conditionsVerified: false,
        questionVerified: false,
        selectedQuestions: [],
        checked: null,
        feedback: feedbackUpdate,
      };
    });
  };

  const changeHiddenInput = (value: string) => {
    if (locked) return;
    clearSavedFinalAnswer();
    setState((prev) => ({
      ...prev,
      hiddenInput: value,
      questionVerified: false,
      selectedQuestions: [],
      checked: null,
      feedback: null,
    }));
  };

  const toggleQuestionCandidate = (id: string) => {
    if (locked) return;
    clearSavedFinalAnswer();
    setState((prev) => ({
      ...prev,
      // 问题只选一个：再点一下取消，点另一个就换成它。
      selectedQuestions: prev.selectedQuestions.includes(id) ? [] : [id],
      questionVerified: false,
      checked: null,
      feedback:
        id === prompt.questionId
          ? {
              tone: 'progress',
              text: '问题选好了，点「下一步：填答案」继续。',
            }
          : {
              tone: 'error',
              text: '这还不是题目问的问题，再找找题目最后问的那一句。',
            },
    }));
  };

  const toggleClue = () => {
    if (locked) return;
    setState((prev) => ({ ...prev, clueOpen: !prev.clueOpen }));
  };

  const goNext = () => {
    if (locked) return;
    if (stage === 'conditions') {
      // 第 1 步只校验点选；隐藏条件留到下一步单独询问。
      const code = checkConditionSelection(prompt, selectedConditions);
      if (code) {
        setState((prev) => ({
          ...prev,
          feedback: { tone: 'error', text: CONDITION_ERRORS[code] },
        }));
        return;
      }
      setState((prev) => ({
        ...prev,
        stage: hasHiddenCondition ? 'hidden' : 'question',
        conditionsVerified: true,
        feedback: {
          tone: 'success',
          text: hasHiddenCondition
            ? '已知条件都找对了！题目里还藏着一个条件，下一步把它写出来。'
            : '已知条件都找对了！接下来点选题目问的是什么。',
        },
      }));
      return;
    }
    if (stage === 'hidden') {
      const code = checkHiddenConditionStep(prompt, hiddenInput);
      if (code) {
        setState((prev) => ({
          ...prev,
          feedback: { tone: 'error', text: CONDITION_ERRORS[code] },
        }));
        return;
      }
      setState((prev) => ({
        ...prev,
        stage: 'question',
        feedback: {
          tone: 'success',
          text: '隐藏条件也找到了！接下来点选题目问的是什么。',
        },
      }));
      return;
    }
    if (stage === 'question') {
      const code = checkQuestionSelection(prompt, selectedQuestions);
      if (code !== null) {
        setState((prev) => ({
          ...prev,
          feedback: {
            tone: 'error',
            text:
              code === 'none'
                ? '还没有选问题，点一点题目里问的那句话。'
                : '这还不是题目问的问题，再找找题目最后问的那一句。',
          },
        }));
        return;
      }
      setState((prev) => ({
        ...prev,
        stage: 'answer',
        questionVerified: true,
        feedback: {
          tone: 'success',
          text: '问题也找对了！现在把算出来的答案填进去吧。',
        },
      }));
    }
  };

  const goBack = () => {
    if (locked) return;
    if (stage === 'answer')
      setState((prev) => ({ ...prev, stage: 'question', feedback: null }));
    else if (stage === 'question')
      setState((prev) => ({
        ...prev,
        stage: hasHiddenCondition ? 'hidden' : 'conditions',
        feedback: null,
      }));
    else if (stage === 'hidden')
      setState((prev) => ({ ...prev, stage: 'conditions', feedback: null }));
  };

  const changeFinalAnswer = (raw: string) => {
    if (locked) return;
    // 不在组件里再存一份答案：输入框直接由父级 answer 控制，
    // 服务器冲突选择云端答案、外部清空等变化都会立刻反映在输入框。
    const value = raw.replace(/\D/g, '').slice(0, 3);
    if (value !== answer) onAnswer(question.id, value);
  };

  const checkFinalAnswer = () => {
    if (locked || !checkAnswer) return;
    const isCorrect = checkAnswer(question, answer);
    // 反馈记录检查时的答案；渲染时与当前 answer 比对，答案一变就自动失效。
    setState((prev) => ({ ...prev, checked: { answer, correct: isCorrect } }));
  };

  const hiddenInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    goNext();
  };

  const answerInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== 'Enter') return;
    if (checkAnswer) {
      event.preventDefault();
      checkFinalAnswer();
    } else {
      // 正式练习保留父级 Enter 切题导航。
      onKeyDown?.(event);
    }
  };

  const renderPart = (part: WordProblemPart, index: number) => {
    if (part.type === 'text')
      return (
        <span key={`wp-text-${index}`} className="wp-text">
          {part.text}
        </span>
      );
    if (part.type === 'clue') {
      if (stage === 'answer')
        return (
          <span
            key={part.id}
            data-testid={`wp-part-${part.id}`}
            data-kind={part.type}
            className="wp-part wp-part-static"
          >
            {part.text}
          </span>
        );
      return (
        <button
          key={part.id}
          type="button"
          data-testid={`wp-part-${part.id}`}
          data-kind={part.type}
          aria-expanded={clueOpen}
          aria-pressed={clueOpen}
          aria-label={`提示：${part.text}`}
          className="wp-part wp-clue-toggle"
          onClick={toggleClue}
        >
          {part.text}
        </button>
      );
    }
    // 条件阶段按条件选择；问题阶段仍保留已确认条件的选中态，同时反映问题候选；
    // 隐藏条件阶段题干固定显示已确认的条件，孩子专心写隐藏条件。
    const pressed =
      stage === 'conditions'
        ? selectedConditions.includes(part.id)
        : stage === 'question'
          ? selectedQuestions.includes(part.id) ||
            selectedConditions.includes(part.id)
          : false;
    const confirmed =
      stage === 'answer'
        ? prompt.conditionIds.includes(part.id) ||
          part.id === prompt.questionId
        : stage === 'question' || stage === 'hidden'
          ? selectedConditions.includes(part.id)
          : false;
    if (stage === 'answer' || stage === 'hidden')
      return (
        <span
          key={part.id}
          data-testid={`wp-part-${part.id}`}
          data-kind={part.type}
          className={`wp-part wp-part-static${confirmed ? ' wp-part-confirmed' : ''}${stage === 'answer' && part.id === prompt.questionId ? ' wp-part-question' : ''}`}
        >
          {part.text}
        </span>
      );
    return (
      <button
        key={part.id}
        type="button"
        data-testid={`wp-part-${part.id}`}
        data-kind={part.type}
        aria-pressed={pressed}
        className={`wp-part${pressed ? ' wp-part-pressed' : ''}${confirmed ? ' wp-part-confirmed' : ''}`}
        onClick={() =>
          stage === 'conditions'
            ? toggleCondition(part.id)
            : toggleQuestionCandidate(part.id)
        }
      >
        {part.text}
      </button>
    );
  };

  return (
    <article
      className="word-problem-card wp-card wp-flow"
      data-testid="word-problem"
      data-question-id={question.id}
      data-stage={stage}
      data-step-count={steps.length}
    >
      <fieldset className="wp-fieldset" disabled={locked}>
        <div className="wp-head">
          <span className="question-number">{question.position}</span>
          <span className="wp-stage-label" data-testid="wp-stage-label">
            {stageLabel(stage, hasHiddenCondition)}
          </span>
        </div>
        <p className="wp-instruction">{STAGE_INSTRUCTIONS[stage]}</p>
        <div className="wp-story" data-testid="wp-story">
          {prompt.parts.map(renderPart)}
        </div>
        {stage === 'hidden' && prompt.hiddenCondition && (
          <label className="wp-hidden">
            <span>{prompt.hiddenCondition.label}</span>
            <input
              type="text"
              data-testid="wp-hidden-input"
              aria-label="隐藏条件"
              autoComplete="off"
              placeholder={prompt.hiddenCondition.placeholder}
              value={hiddenInput}
              onChange={(event) => changeHiddenInput(event.target.value)}
              onKeyDown={hiddenInputKeyDown}
            />
          </label>
        )}
        {hasHiddenCondition &&
          hiddenVerified &&
          (stage === 'question' || stage === 'answer') && (
            <p
              className="wp-hidden-confirmed"
              data-testid="wp-hidden-confirmed"
            >
              已找到的隐藏条件：<strong>{hiddenInput.trim()}</strong>
            </p>
          )}
        {stage !== 'answer' && clueOpen && (
          <p className="wp-clue-hint" data-testid="wp-clue-hint">
            {clueHint(prompt, stage)}
          </p>
        )}
        {feedback && (
          <p
            data-testid="wp-feedback"
            role={feedback.tone === 'error' ? 'alert' : 'status'}
            className={`wp-feedback wp-feedback-${feedback.tone}`}
          >
            {feedback.text}
          </p>
        )}
        {stage === 'answer' && (
          <div className="wp-answer">
            <label className="wp-answer-field">
              <span className="wp-answer-label">最终答案</span>
              <span className="wp-answer-row">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="next"
                  maxLength={3}
                  className="wp-answer-input"
                  data-testid="wp-answer-input"
                  aria-label={`第 ${question.position} 题最终答案`}
                  value={answer}
                  onChange={(event) => changeFinalAnswer(event.target.value)}
                  onKeyDown={answerInputKeyDown}
                />
                <span className="wp-answer-unit" data-testid="wp-answer-unit">
                  {prompt.answerUnit}
                </span>
              </span>
            </label>
            {checkAnswer ? (
              <div className="wp-check-row">
                <button
                  type="button"
                  className="wp-button wp-button-check"
                  data-testid="wp-check"
                  onClick={checkFinalAnswer}
                >
                  检查答案
                </button>
                {checked !== null && checked.answer === answer && (
                  <p
                    data-testid="wp-check-feedback"
                    role={checked.correct ? 'status' : 'alert'}
                    className={`wp-check-feedback wp-check-feedback-${checked.correct ? 'success' : 'error'}`}
                  >
                    {checked.correct ? '答对了！' : '答案还不对，再检查一下。'}
                  </p>
                )}
              </div>
            ) : (
              <p className="wp-answer-tip">填好后点下面的「检查答案」。</p>
            )}
          </div>
        )}
        <div className="wp-actions">
          <button
            type="button"
            className="wp-button wp-button-back"
            data-testid="wp-back"
            onClick={goBack}
            disabled={stage === 'conditions'}
          >
            上一步
          </button>
          {stage !== 'answer' && (
            <button
              type="button"
              className="wp-button wp-button-next"
              data-testid="wp-next"
              onClick={goNext}
            >
              {nextButtonLabel(stage, hasHiddenCondition)}
            </button>
          )}
        </div>
      </fieldset>
    </article>
  );
}

type LegacyWordProblemPrompt = WordProblemPrompt;

/** 识别旧版 { version: 1, story, steps } promptData，兼容历史轮次。 */
function asLegacyWordProblemPrompt(
  value: RoundQuestion['promptData'],
): LegacyWordProblemPrompt | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<LegacyWordProblemPrompt>;
  if (candidate.version !== 1) return null;
  if (typeof candidate.story !== 'string') return null;
  if (!Array.isArray(candidate.steps) || candidate.steps.length === 0)
    return null;
  return candidate as LegacyWordProblemPrompt;
}

/** 旧版分步作答：界面与行为保持原样，只补上 locked 与已保存答案恢复。 */
function WordProblemLegacyFlow({
  question,
  answer,
  onAnswer,
  locked,
  prompt,
}: WordProblemQuestionProps & { prompt: LegacyWordProblemPrompt }) {
  const steps = prompt.steps;
  const [currentStep, setCurrentStep] = useState(0);
  // 最后一步用已保存答案初始化：刷新或回来时可以恢复并继续编辑。
  const [stepAnswers, setStepAnswers] = useState<string[]>(() => {
    const initial = Array.from({ length: steps.length }, () => '');
    initial[steps.length - 1] = answer;
    return initial;
  });
  const currentStepData = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;
  const currentStepAnswer = stepAnswers[currentStep] ?? '';
  const canProceed = currentStepAnswer.trim() !== '';

  const handleStepAnswer = (value: string) => {
    if (locked) return;
    setStepAnswers((prev) => {
      const next = [...prev];
      next[currentStep] = value;
      return next;
    });
  };

  const handleNext = () => {
    if (locked || !canProceed) return;
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
      return;
    }
    // 最后一步提交：父级只接受纯数字串（最多 4 位）。
    onAnswer(
      question.id,
      currentStepAnswer.replace(/\D/g, '').slice(0, 4),
    );
  };

  const handleBack = () => {
    if (locked) return;
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  return (
    <article
      className="word-problem-card wp-card p-6 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl shadow-sm"
      data-testid="word-problem"
      data-question-id={question.id}
      data-stage="legacy"
    >
      <fieldset className="wp-fieldset" disabled={locked}>
        <div className="flex items-center justify-between mb-4">
          <span className="question-number">{question.position}</span>
          <span className="text-sm font-medium text-indigo-600">
            第 {currentStep + 1} 步 / 共 {steps.length} 步
          </span>
        </div>

        <div className="mb-6 p-4 bg-white rounded-xl shadow-sm">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">题目</h3>
          <p className="text-base leading-relaxed text-gray-800">
            {prompt.story}
          </p>
        </div>

        {currentStep > 0 && (
          <div className="mb-4 p-3 bg-green-50 rounded-lg border border-green-200">
            <h4 className="text-xs font-semibold text-green-700 mb-2">
              已完成的步骤：
            </h4>
            {stepAnswers.slice(0, currentStep).map((ans, idx) => (
              <div key={idx} className="text-sm text-green-800 mb-1">
                {steps[idx].prompt}：<strong>{ans}</strong>
              </div>
            ))}
          </div>
        )}

        <div className="mb-6 p-4 bg-white rounded-xl shadow-sm">
          <h3 className="text-base font-semibold text-indigo-700 mb-4">
            {currentStepData.prompt}
          </h3>

          {currentStepData.type === 'meaning' && currentStepData.options ? (
            <div className="space-y-3">
              {currentStepData.options.map((option, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => handleStepAnswer(option)}
                  className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                    currentStepAnswer === option
                      ? 'border-indigo-500 bg-indigo-50 shadow-md'
                      : 'border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm'
                  }`}
                >
                  <span className="text-sm leading-relaxed">{option}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <input
                type="text"
                inputMode={
                  currentStepData.type === 'calculate' ? 'numeric' : 'text'
                }
                value={currentStepAnswer}
                onChange={(e) => handleStepAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canProceed) handleNext();
                }}
                className="flex-1 px-4 py-3 border-2 border-indigo-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder={
                  currentStepData.type === 'expression'
                    ? '例如：20÷4'
                    : '输入答案'
                }
              />
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-between">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentStep === 0}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              currentStep === 0
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            上一步
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={!canProceed}
            className={`px-6 py-2 rounded-lg font-medium transition-all ${
              canProceed
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {isLastStep ? '提交答案' : '下一步'}
          </button>
        </div>
      </fieldset>
    </article>
  );
}

/** 无 promptData / 无 steps 的旧题：保留简单数字输入框回退。 */
function WordProblemFallback({
  question,
  answer,
  onAnswer,
  onKeyDown,
  locked,
}: WordProblemQuestionProps) {
  return (
    <article
      className="word-problem-card wp-card wp-fallback"
      data-testid="word-problem"
      data-question-id={question.id}
      data-stage="fallback"
    >
      <fieldset className="wp-fieldset" disabled={locked}>
        <div className="wp-head">
          <span className="question-number">{question.position}</span>
        </div>
        <p className="wp-fallback-story">{question.expression}</p>
        <input
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="next"
          onKeyDown={onKeyDown}
          aria-label={`第 ${question.position} 题答案`}
          value={answer}
          onChange={(event) => {
            if (locked) return;
            onAnswer(
              question.id,
              event.target.value.replace(/\D/g, '').slice(0, 4),
            );
          }}
          className="wp-fallback-input"
        />
      </fieldset>
    </article>
  );
}

import { describe, expect, it } from 'vitest';
import {
  asWordProblemV2Prompt,
  checkConditionSelection,
  checkHiddenCondition,
  checkHiddenConditionStep,
  checkQuestionSelection,
  clearWordProblemStepDraft,
  makeWordProblemSpecs,
  readWordProblemStepDraft,
  wordProblemDraftKey,
  wordProblemExamples,
  wordProblemFingerprint,
  writeWordProblemStepDraft,
  type WordProblemPart,
  type WordProblemStepDraftData,
  type WordProblemV2Prompt,
} from './word-problems';
import { makeQuestionsForCounts } from './questions';
import { emptyCounts } from './learning';

/** 与出题器同构的种子随机，用来直接验证 makeWordProblemSpecs 的确定性。 */
function seededInt(seed: number) {
  let value = seed >>> 0;
  return (min: number, max: number) => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    const random = ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    return Math.floor(random * (max - min + 1)) + min;
  };
}

function intFor(seed: number) {
  const int = seededInt(seed);
  return (min: number, max: number) => int(min, max);
}

function part(prompt: WordProblemV2Prompt, id: string): WordProblemPart {
  const found = prompt.parts.find((item) => 'id' in item && item.id === id);
  if (!found) throw new Error(`缺少片段 ${id}`);
  return found;
}

function partTexts(prompt: WordProblemV2Prompt): string[] {
  return prompt.parts.map((item) => item.text);
}

function firstNumber(text: string): number {
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : Number.NaN;
}

function requiredTexts(prompt: WordProblemV2Prompt): string[] {
  return prompt.conditionIds.map((id) => part(prompt, id).text);
}

function questionText(prompt: WordProblemV2Prompt): string {
  return part(prompt, prompt.questionId).text;
}

const WEEK_ACCEPTED = [
  '一周七天',
  '每周有七天',
  '7天',
  '一星期有7日',
  '一个星期有7天',
  '每个星期都有 7 天',
  '７天',
  '每周有７天',
  '1个星期有7天',
  '一个礼拜有7天',
  '一周有七日',
];

const WEEK_REJECTED = [
  '5天',
  '7节',
  '不知道',
  '不是7天',
  '一周7天或5天',
  '一个星期有5天',
  '七个星期',
  '七天半',
  '70天',
  '7',
  '',
  '一周有几天',
  // 一个月/一年不可能有 7 天，复数个星期也不等于 7 天。
  '一个月有7天',
  '一个月有七日',
  '一年有7天',
  '两个星期有7天',
  '2个星期有7天',
  '两周有7天',
  '二周有7天',
  '一周7天，两周7天',
];

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const draftData: WordProblemStepDraftData = {
  stage: 'question',
  conditionsVerified: true,
  questionVerified: false,
  selectedConditions: ['c1', 'c2'],
  selectedQuestions: [],
  hiddenInput: '',
};

describe('makeWordProblemSpecs', () => {
  it('多种 seed 每轮 50 题稳定生成、题干不重复且三类齐全', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const specs = makeWordProblemSpecs(50, intFor(seed));
      expect(specs).toHaveLength(50);
      expect(new Set(specs.map((spec) => spec.story)).size).toBe(50);
      const kinds = specs.map((spec) => spec.kind);
      expect(kinds).toContain('multiplyTotal');
      expect(kinds).toContain('weekTotal');
      expect(kinds).toContain('divisionShare');
      expect(kinds).toContain('divisionGroup');
    }
  });

  it('3 题起一定覆盖乘法、除法、一个星期隐藏条件三类', () => {
    for (const count of [3, 4, 5, 7]) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const kinds = new Set(
          makeWordProblemSpecs(count, intFor(seed)).map((spec) => spec.kind),
        );
        const classes = new Set(
          [...kinds].map((kind) =>
            kind === 'weekTotal'
              ? 'week'
              : kind === 'multiplyTotal'
                ? 'multiply'
                : 'division',
          ),
        );
        expect(classes).toEqual(new Set(['multiply', 'division', 'week']));
      }
    }
  });

  it('相同 seed 生成结果确定；0 题返回空数组', () => {
    expect(makeWordProblemSpecs(50, intFor(42))).toEqual(
      makeWordProblemSpecs(50, intFor(42)),
    );
    expect(makeWordProblemSpecs(0, intFor(42))).toEqual([]);
  });

  it('数值、整除、单位与问题一致，且不会出现小数', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 50; seed += 1) {
      for (const spec of makeWordProblemSpecs(50, intFor(seed))) {
        const prompt = spec.prompt;
        if (prompt.version !== 2) bad.push(`版本：${spec.story}`);
        if (prompt.story !== spec.story || prompt.kind !== spec.kind)
          bad.push(`题干不一致：${spec.story}`);
        if (!Number.isInteger(spec.answer) || spec.answer <= 0)
          bad.push(`答案非正整数：${spec.story} → ${spec.answer}`);
        const texts = [
          ...partTexts(prompt),
          prompt.story,
          String(spec.answer),
        ].join('\n');
        if (/\d\.\d/.test(texts)) bad.push(`小数：${spec.story}`);
        const ids = prompt.parts
          .filter((item): item is Exclude<WordProblemPart, { type: 'text' }> => item.type !== 'text')
          .map((item) => item.id);
        if (new Set(ids).size !== ids.length) bad.push(`片段 id 重复：${spec.story}`);
        const question = prompt.parts.find(
          (item) => item.type === 'question' && item.id === prompt.questionId,
        );
        if (!question) bad.push(`缺少问题片段：${spec.story}`);
        if (!questionText(prompt).includes(prompt.answerUnit))
          bad.push(`问题单位不一致：${spec.story} / ${prompt.answerUnit}`);
        if (!prompt.conditionIds.length)
          bad.push(`没有已知条件：${spec.story}`);
        for (const id of prompt.conditionIds) {
          const item = part(prompt, id);
          if (item.type !== 'condition') bad.push(`条件 id 无效：${spec.story}`);
        }

        if (spec.kind === 'multiplyTotal') {
          const numbers = requiredTexts(prompt).map(firstNumber);
          if (numbers.length !== 2) bad.push(`乘法条件数量：${spec.story}`);
          if (!numbers.every((value) => value >= 2 && value <= 9))
            bad.push(`乘法因数不在 2～9：${spec.story}`);
          if (spec.answer !== numbers[0] * numbers[1])
            bad.push(`乘法答案不一致：${spec.story}`);
        } else if (spec.kind === 'divisionShare') {
          const [totalText, peopleText] = requiredTexts(prompt);
          const total = firstNumber(totalText);
          const people = firstNumber(peopleText);
          if (!(people >= 2 && people <= 9) || total % people !== 0)
            bad.push(`平均分不整除或除数越界：${spec.story}`);
          if (!(spec.answer >= 2 && spec.answer <= 9))
            bad.push(`平均分商不在 2～9：${spec.story}`);
          if (total / people !== spec.answer)
            bad.push(`平均分答案不一致：${spec.story}`);
        } else if (spec.kind === 'divisionGroup') {
          const [totalText, perGroupText] = requiredTexts(prompt);
          const total = firstNumber(totalText);
          const perGroup = firstNumber(perGroupText);
          if (!(perGroup >= 2 && perGroup <= 9) || total % perGroup !== 0)
            bad.push(`按份分组不整除或除数越界：${spec.story}`);
          if (!(spec.answer >= 2 && spec.answer <= 9))
            bad.push(`按份分组商不在 2～9：${spec.story}`);
          if (total / perGroup !== spec.answer)
            bad.push(`按份分组答案不一致：${spec.story}`);
        } else {
          const perDay = firstNumber(requiredTexts(prompt)[0]);
          if (!(perDay >= 2 && perDay <= 9))
            bad.push(`星期题每天数量越界：${spec.story}`);
          if (spec.answer !== perDay * 7)
            bad.push(`星期题答案不是 7 倍：${spec.story}`);
          if (prompt.hiddenCondition?.kind !== 'weekDays')
            bad.push(`星期题缺少隐藏条件：${spec.story}`);
          if (!prompt.parts.some((item) => item.type === 'clue' && item.text.includes('一个星期')))
            bad.push(`星期题缺少「一个星期」线索：${spec.story}`);
          if (!spec.story.includes('周末也'))
            bad.push(`星期题缺少周末说明：${spec.story}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('部分乘法题带干扰条件，便于练习漏选/多选判断', () => {
    const specs = makeWordProblemSpecs(50, intFor(7));
    expect(
      specs.some(
        (spec) =>
          spec.prompt.parts.filter((item) => item.type === 'condition')
            .length > spec.prompt.conditionIds.length,
      ),
    ).toBe(true);
  });
});

describe('新版应用题 promptData', () => {
  it('三道原始示例与产品给的题干、条件、问题、答案完全对应', () => {
    const [snacks, apples, week] = wordProblemExamples;
    expect(snacks.prompt.story).toBe(
      '一箱薯片里有6包薯片，一共有8箱，那么一共有多少包？',
    );
    expect(snacks.prompt.conditionIds).toEqual(['c1', 'c2']);
    expect(requiredTexts(snacks.prompt)).toEqual(['6包薯片', '8箱']);
    expect(questionText(snacks.prompt)).toBe('一共有多少包');
    expect(snacks.prompt.answerUnit).toBe('包');
    expect(snacks.answer).toBe(48);

    expect(apples.prompt.story).toBe(
      '妈妈总共买了18个苹果，家里有3个孩子，把苹果平均分给孩子，每个孩子分几个苹果？',
    );
    expect(requiredTexts(apples.prompt)).toEqual(['18个苹果', '3个孩子']);
    expect(questionText(apples.prompt)).toBe('每个孩子分几个苹果');
    expect(apples.answer).toBe(6);

    expect(week.prompt.story).toBe(
      '每天有2节体育课，周末也上课，一个星期有几节体育课？',
    );
    expect(requiredTexts(week.prompt)).toEqual(['2节体育课']);
    expect(week.prompt.hiddenCondition?.kind).toBe('weekDays');
    expect(questionText(week.prompt)).toBe('有几节体育课');
    expect(week.answer).toBe(14);
  });

  it('隐藏条件的儿童向说明保持中性，不提示答案方向', () => {
    const hidden = wordProblemExamples[2].prompt.hiddenCondition;
    expect(hidden?.kind).toBe('weekDays');
    expect(hidden?.label).not.toMatch(/[0-9０-９]|星期|周|天|几/);
    expect(hidden?.placeholder).not.toMatch(/[0-9０-９]|星期|周|天|几/);
  });

  it('找已知条件步骤只校验点选，隐藏条件在独立的隐藏条件步骤校验', () => {
    const [snacks, apples, week] = wordProblemExamples;
    expect(checkConditionSelection(snacks.prompt, ['c1', 'c2'])).toBeNull();
    expect(checkConditionSelection(snacks.prompt, ['c1'])).toBe('missing');
    expect(checkConditionSelection(snacks.prompt, ['c1', 'c2', 'q'])).toBe(
      'questionAsCondition',
    );
    expect(checkConditionSelection(apples.prompt, ['c1', 'c2'])).toBeNull();
    // 隐藏条件题的第 1 步同样只校验点选：条件选对了就能进入隐藏条件步骤。
    expect(checkConditionSelection(week.prompt, ['c1'])).toBeNull();
    expect(checkConditionSelection(week.prompt, ['c1', 'q'])).toBe(
      'questionAsCondition',
    );
    expect(checkConditionSelection(week.prompt, [])).toBe('missing');
    // 隐藏条件步骤再单独校验输入。
    expect(checkHiddenConditionStep(week.prompt, '')).toBe('hiddenMissing');
    expect(checkHiddenConditionStep(week.prompt, '5天')).toBe('hiddenInvalid');
    expect(checkHiddenConditionStep(week.prompt, '一星期有7天')).toBeNull();
    expect(checkHiddenConditionStep(snacks.prompt, '')).toBeNull();
    const distractored = makeWordProblemSpecs(50, intFor(7)).find(
      (spec) =>
        spec.prompt.parts.filter((item) => item.type === 'condition').length >
        spec.prompt.conditionIds.length,
    )!;
    const distractor = distractored.prompt.parts.find(
      (item): item is WordProblemPart & { type: 'condition' } =>
        item.type === 'condition' &&
        !distractored.prompt.conditionIds.includes(item.id),
    )!;
    expect(
      checkConditionSelection(distractored.prompt, [
        ...distractored.prompt.conditionIds,
        distractor.id,
      ]),
    ).toBe('extra');
  });

  it('问题阶段必须选中所求问题', () => {
    const [snacks] = wordProblemExamples;
    expect(checkQuestionSelection(snacks.prompt, [])).toBe('none');
    expect(checkQuestionSelection(snacks.prompt, ['c1'])).toBe('notQuestion');
    expect(checkQuestionSelection(snacks.prompt, ['q'])).toBeNull();
  });

  it('隐藏条件接受宽容表达、拒绝错误与自相矛盾', () => {
    for (const input of WEEK_ACCEPTED)
      expect(checkHiddenCondition('weekDays', input), input).toBe(true);
    for (const input of WEEK_REJECTED)
      expect(checkHiddenCondition('weekDays', input), input).toBe(false);
  });

  it('asWordProblemV2Prompt 只认新版，不把旧版 steps 混淆进来', () => {
    expect(asWordProblemV2Prompt(wordProblemExamples[0].prompt)).not.toBeNull();
    expect(
      asWordProblemV2Prompt({
        version: 1,
        story: '旧版应用题',
        steps: [{ type: 'calculate', prompt: '计算', correctAnswer: 3 }],
      }),
    ).toBeNull();
    expect(asWordProblemV2Prompt(undefined)).toBeNull();
  });
});

describe('分步草稿 sessionStorage', () => {
  it('按 question.id 与题干指纹隔离保存、恢复和清除', () => {
    const storage = new MemoryStorage();
    expect(wordProblemDraftKey('q1')).toContain('q1');
    writeWordProblemStepDraft('q1', '题干甲', draftData, storage);
    expect(readWordProblemStepDraft('q1', '题干甲', storage)).toEqual({
      ...draftData,
      version: 1,
      fingerprint: wordProblemFingerprint('题干甲'),
    });
    // 同一 question.id 换了题干（换一组/新一轮）不得恢复旧步骤
    expect(readWordProblemStepDraft('q1', '题干乙', storage)).toBeNull();
    // 不同题目互不串草稿
    expect(readWordProblemStepDraft('q2', '题干甲', storage)).toBeNull();
    clearWordProblemStepDraft('q1', storage);
    expect(readWordProblemStepDraft('q1', '题干甲', storage)).toBeNull();
  });

  it('隐藏条件步骤的草稿（stage=hidden）可以恢复', () => {
    const storage = new MemoryStorage();
    writeWordProblemStepDraft(
      'q-week',
      '题干丙',
      { ...draftData, stage: 'hidden', hiddenInput: '7天' },
      storage,
    );
    const restored = readWordProblemStepDraft('q-week', '题干丙', storage);
    expect(restored?.stage).toBe('hidden');
    expect(restored?.conditionsVerified).toBe(true);
    expect(restored?.hiddenInput).toBe('7天');
  });

  it('旧草稿里的 clueOpen 提示状态被忽略，不会恢复任何提示开关', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      wordProblemDraftKey('q-old'),
      JSON.stringify({
        version: 1,
        fingerprint: wordProblemFingerprint('题干丁'),
        stage: 'conditions',
        conditionsVerified: false,
        questionVerified: false,
        selectedConditions: ['c1'],
        selectedQuestions: [],
        hiddenInput: '',
        clueOpen: true,
      }),
    );
    const restored = readWordProblemStepDraft('q-old', '题干丁', storage);
    expect(restored).not.toBeNull();
    expect(restored && 'clueOpen' in restored).toBe(false);
    expect(restored?.selectedConditions).toEqual(['c1']);
  });

  it('坏数据或存储不可用时不影响作答', () => {
    const storage = new MemoryStorage();
    storage.setItem(wordProblemDraftKey('q1'), '{oops');
    expect(readWordProblemStepDraft('q1', '题干', storage)).toBeNull();
    storage.setItem(
      wordProblemDraftKey('q1'),
      JSON.stringify({ version: 99, fingerprint: wordProblemFingerprint('题干') }),
    );
    expect(readWordProblemStepDraft('q1', '题干', storage)).toBeNull();
    const broken = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(() =>
      writeWordProblemStepDraft('q1', '题干', draftData, broken),
    ).not.toThrow();
    expect(() => clearWordProblemStepDraft('q1', broken)).not.toThrow();
    expect(readWordProblemStepDraft('q1', '题干', broken)).toBeNull();
  });
});

describe('题目生成器接入新版应用题', () => {
  it('mixedWordProblem 全部是新版 promptData，不与旧版表达式/含义步骤混用', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const questions = makeQuestionsForCounts(seed, {
        ...emptyCounts,
        mixedWordProblem: 50,
      });
      expect(questions).toHaveLength(50);
      const stories = new Set(questions.map((question) => question.expression));
      expect(stories.size).toBe(50);
      for (const question of questions) {
        const prompt = asWordProblemV2Prompt(question.promptData);
        expect(prompt).not.toBeNull();
        expect(prompt!.version).toBe(2);
        expect(prompt!.story).toBe(question.expression);
        expect(
          (prompt as unknown as { steps?: unknown }).steps,
        ).toBeUndefined();
        expect(Number.isInteger(question.answer)).toBe(true);
        expect(question.answer).toBeGreaterThan(0);
        expect(question.answer).toBeLessThanOrEqual(81);
      }
    }
  });
});

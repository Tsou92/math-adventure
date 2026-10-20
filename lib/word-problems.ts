/**
 * 乘除应用题（mixedWordProblem）新版题库与判题辅助。
 *
 * v2 promptData 把题干拆成有意义的文本片段：
 * - 已知条件（condition）：孩子直接在题干里点选，数量必须恰好选对；
 * - 隐藏条件线索（clue）：如「一个星期」，点一点提示这里藏着一个条件；
 * - 所求问题（question）：条件阶段选到问题本身会提示「把问题当条件」。
 * 有隐藏条件时（目前是「一个星期有 7 天」），孩子要先点选完已知条件，再单独
 * 写隐藏条件并做确定性语义校验，然后才点选所求问题，最后填写数字答案；
 * 普通题只有「条件 → 问题 → 答案」三步。
 *
 * 本文件保持纯 TypeScript（生成器在服务端与浏览器共用，存储工具只依赖可选
 * sessionStorage），不引用 React，也不调用外部模型判分。
 */
export const WORD_PROBLEM_PROMPT_VERSION = 2 as const;

export type WordProblemKind =
  | 'multiplyTotal'
  | 'divisionShare'
  | 'divisionGroup'
  | 'weekTotal';

export type WordProblemPart =
  | { type: 'text'; text: string }
  | { type: 'condition'; id: string; text: string }
  | { type: 'clue'; id: string; text: string }
  | { type: 'question'; id: string; text: string };

export type WordProblemHiddenKind = 'weekDays';

export type WordProblemHiddenCondition = {
  kind: WordProblemHiddenKind;
  /** 输入框上方的儿童向说明，不包含正确答案。 */
  label: string;
  placeholder: string;
};

export type WordProblemV2Prompt = {
  version: typeof WORD_PROBLEM_PROMPT_VERSION;
  kind: WordProblemKind;
  story: string;
  parts: WordProblemPart[];
  /** 必须恰好选中的已知条件 id（干扰条件不在其中）。 */
  conditionIds: string[];
  /** 所求问题片段的 id。 */
  questionId: string;
  hiddenCondition?: WordProblemHiddenCondition;
  /** 最终答案的单位，与问题片段里的问法保持一致。 */
  answerUnit: string;
};

export type GeneratedWordProblem = {
  kind: WordProblemKind;
  story: string;
  answer: number;
  prompt: WordProblemV2Prompt;
};

export type FixedWordProblem = {
  id: string;
  label: string;
  prompt: WordProblemV2Prompt;
  answer: number;
};

type ConditionInput = {
  condition: string;
  /** 默认 true；干扰条件显式传 false。 */
  required?: boolean;
};

type PartInput = string | ConditionInput | { clue: string } | { question: string };

type ScenarioNumbers = { x: number; y: number; z: number };

type Scenario = (numbers: ScenarioNumbers) => GeneratedWordProblem;

function buildPrompt(
  kind: WordProblemKind,
  inputs: PartInput[],
  answerUnit: string,
  hiddenCondition?: WordProblemHiddenCondition,
): WordProblemV2Prompt {
  let conditionIndex = 0;
  let clueIndex = 0;
  const conditionIds: string[] = [];
  let questionId = '';
  const parts = inputs.map((input): WordProblemPart => {
    if (typeof input === 'string') return { type: 'text', text: input };
    if ('condition' in input) {
      conditionIndex += 1;
      const id = `c${conditionIndex}`;
      if (input.required !== false) conditionIds.push(id);
      return { type: 'condition', id, text: input.condition };
    }
    if ('clue' in input) {
      clueIndex += 1;
      return { type: 'clue', id: `clue-${clueIndex}`, text: input.clue };
    }
    questionId = 'q';
    return { type: 'question', id: questionId, text: input.question };
  });
  if (!questionId)
    throw new Error('应用题缺少所求问题片段');
  return {
    version: WORD_PROBLEM_PROMPT_VERSION,
    kind,
    story: parts.map((part) => part.text).join(''),
    parts,
    conditionIds,
    questionId,
    hiddenCondition,
    answerUnit,
  };
}

function generate(
  kind: WordProblemKind,
  inputs: PartInput[],
  answer: number,
  answerUnit: string,
  hiddenCondition?: WordProblemHiddenCondition,
): GeneratedWordProblem {
  const prompt = buildPrompt(kind, inputs, answerUnit, hiddenCondition);
  return { kind, story: prompt.story, answer, prompt };
}

const WEEK_HIDDEN: WordProblemHiddenCondition = {
  kind: 'weekDays',
  label: '题目里没有直接说一个星期有几天，请把你想到的隐藏条件写下来：',
  placeholder: '把你的发现写下来',
};

/** 乘法求总数：每份数(箱/盒/盘…) × 份数，答案为总数。x=每份数，y=份数，z=干扰数量。 */
const MULTIPLY_SCENARIOS: Scenario[] = [
  ({ x, y }) =>
    generate(
      'multiplyTotal',
      [
        '一箱薯片里有',
        { condition: `${x}包薯片` },
        '，一共有',
        { condition: `${y}箱` },
        '，那么',
        { question: '一共有多少包' },
        '？',
      ],
      x * y,
      '包',
    ),
  ({ x, y, z }) =>
    generate(
      'multiplyTotal',
      [
        '一盒彩笔有',
        { condition: `${x}支彩笔` },
        '，妈妈买了',
        { condition: `${y}盒` },
        '，每盒',
        { condition: `${z}元`, required: false },
        '，',
        { question: '一共有多少支彩笔' },
        '？',
      ],
      x * y,
      '支',
    ),
  ({ x, y }) =>
    generate(
      'multiplyTotal',
      [
        '每个果盘放',
        { condition: `${x}个苹果` },
        '，',
        { condition: `${y}个果盘` },
        '，',
        { question: '一共放了多少个苹果' },
        '？',
      ],
      x * y,
      '个',
    ),
  ({ x, y }) =>
    generate(
      'multiplyTotal',
      [
        '每个书架放',
        { condition: `${x}本书` },
        '，',
        { condition: `${y}个书架` },
        '，',
        { question: '一共放了多少本书' },
        '？',
      ],
      x * y,
      '本',
    ),
  ({ x, y }) =>
    generate(
      'multiplyTotal',
      [
        '每个花瓶插',
        { condition: `${x}枝花` },
        '，',
        { condition: `${y}个花瓶` },
        '，',
        { question: '一共插了多少枝花' },
        '？',
      ],
      x * y,
      '枝',
    ),
  ({ x, y }) =>
    generate(
      'multiplyTotal',
      [
        '每排坐',
        { condition: `${x}人` },
        '，',
        { condition: `${y}排` },
        '，',
        { question: '一共坐了多少人' },
        '？',
      ],
      x * y,
      '人',
    ),
  ({ x, y }) =>
    generate(
      'multiplyTotal',
      [
        '每个盒子装',
        { condition: `${x}个鸡蛋` },
        '，',
        { condition: `${y}个盒子` },
        '，',
        { question: '一共装了多少个鸡蛋' },
        '？',
      ],
      x * y,
      '个',
    ),
  ({ x, y, z }) =>
    generate(
      'multiplyTotal',
      [
        '每袋有',
        { condition: `${x}块糖` },
        '，',
        { condition: `${y}袋` },
        '，',
        { condition: `${z}种口味`, required: false },
        '，',
        { question: '一共有多少块糖' },
        '？',
      ],
      x * y,
      '块',
    ),
  ({ x, y, z }) =>
    generate(
      'multiplyTotal',
      [
        '每盒铅笔有',
        { condition: `${x}支` },
        '，',
        { condition: `${y}盒` },
        '，',
        { condition: `每盒${z}元`, required: false },
        '，',
        { question: '一共有多少支铅笔' },
        '？',
      ],
      x * y,
      '支',
    ),
];

/** 除法·平均分：总数 ÷ 人数 = 每人几个。x=人数，y=每人几个，总数为 x*y。 */
const DIVISION_SHARE_SCENARIOS: Scenario[] = [
  ({ x, y }) =>
    generate(
      'divisionShare',
      [
        '妈妈总共买了',
        { condition: `${x * y}个苹果` },
        '，家里有',
        { condition: `${x}个孩子` },
        '，把苹果平均分给孩子，',
        { question: '每个孩子分几个苹果' },
        '？',
      ],
      y,
      '个',
    ),
  ({ x, y }) =>
    generate(
      'divisionShare',
      [
        '有',
        { condition: `${x * y}本故事书` },
        '，平均分给',
        { condition: `${x}个小朋友` },
        '，',
        { question: '每人分得多少本' },
        '？',
      ],
      y,
      '本',
    ),
  ({ x, y }) =>
    generate(
      'divisionShare',
      [
        '有',
        { condition: `${x * y}块糖` },
        '，平均分给',
        { condition: `${x}个小朋友` },
        '，',
        { question: '每人分到多少块' },
        '？',
      ],
      y,
      '块',
    ),
  ({ x, y }) =>
    generate(
      'divisionShare',
      [
        '有',
        { condition: `${x * y}支铅笔` },
        '，平均放进',
        { condition: `${x}个笔筒` },
        '，',
        { question: '每个笔筒放多少支' },
        '？',
      ],
      y,
      '支',
    ),
  ({ x, y }) =>
    generate(
      'divisionShare',
      [
        '有',
        { condition: `${x * y}个气球` },
        '，平均分给',
        { condition: `${x}个小朋友` },
        '，',
        { question: '每人分到多少个' },
        '？',
      ],
      y,
      '个',
    ),
  ({ x, y }) =>
    generate(
      'divisionShare',
      [
        '有',
        { condition: `${x * y}张贴纸` },
        '，平均分给',
        { condition: `${x}个小朋友` },
        '，',
        { question: '每人分到多少张' },
        '？',
      ],
      y,
      '张',
    ),
  ({ x, y }) =>
    generate(
      'divisionShare',
      [
        '有',
        { condition: `${x * y}块饼干` },
        '，平均放在',
        { condition: `${x}个盘子里` },
        '，',
        { question: '每个盘子放多少块' },
        '？',
      ],
      y,
      '块',
    ),
  ({ x, y }) =>
    generate(
      'divisionShare',
      [
        '有',
        { condition: `${x * y}本书` },
        '，平均分给',
        { condition: `${x}个班` },
        '，',
        { question: '每班分得多少本' },
        '？',
      ],
      y,
      '本',
    ),
];

/** 除法·按份分组：总数 ÷ 每份几个 = 份数。x=每份几个，y=份数，总数为 x*y。 */
const DIVISION_GROUP_SCENARIOS: Scenario[] = [
  ({ x, y }) =>
    generate(
      'divisionGroup',
      [
        '有',
        { condition: `${x * y}只穿山甲` },
        '，',
        { condition: `${x}只穿山甲住一个洞穴` },
        '，',
        { question: '一共住了多少个洞穴' },
        '？',
      ],
      y,
      '个',
    ),
  ({ x, y }) =>
    generate(
      'divisionGroup',
      [
        '有',
        { condition: `${x * y}个鸡蛋` },
        '，每',
        { condition: `${x}个装一盒` },
        '，',
        { question: '可以装多少盒' },
        '？',
      ],
      y,
      '盒',
    ),
  ({ x, y }) =>
    generate(
      'divisionGroup',
      [
        '有',
        { condition: `${x * y}本书` },
        '，每',
        { condition: `${x}本捆一捆` },
        '，',
        { question: '可以捆多少捆' },
        '？',
      ],
      y,
      '捆',
    ),
  ({ x, y }) =>
    generate(
      'divisionGroup',
      [
        '有',
        { condition: `${x * y}个气球` },
        '，每',
        { condition: `${x}个扎成一束` },
        '，',
        { question: '可以扎成多少束' },
        '？',
      ],
      y,
      '束',
    ),
  ({ x, y }) =>
    generate(
      'divisionGroup',
      [
        '有',
        { condition: `${x * y}块积木` },
        '，每',
        { condition: `${x}块搭一座塔` },
        '，',
        { question: '可以搭多少座' },
        '？',
      ],
      y,
      '座',
    ),
  ({ x, y }) =>
    generate(
      'divisionGroup',
      [
        '有',
        { condition: `${x * y}个桃子` },
        '，每',
        { condition: `${x}个装一盘` },
        '，',
        { question: '可以装多少盘' },
        '？',
      ],
      y,
      '盘',
    ),
  ({ x, y }) =>
    generate(
      'divisionGroup',
      [
        '有',
        { condition: `${x * y}枝花` },
        '，每',
        { condition: `${x}枝插一瓶` },
        '，',
        { question: '可以插多少瓶' },
        '？',
      ],
      y,
      '瓶',
    ),
  ({ x, y }) =>
    generate(
      'divisionGroup',
      [
        '有',
        { condition: `${x * y}把椅子` },
        '，每',
        { condition: `${x}把放一排` },
        '，',
        { question: '可以放多少排' },
        '？',
      ],
      y,
      '排',
    ),
];

/**
 * 隐藏条件·一个星期 7 天：每天 x 个/节/页 × 7 天。
 * 「周末也……，一个星期……」的补充说明用来排除「上学 5 天」的歧义。
 */
const WEEK_SCENARIOS: Scenario[] = [
  ({ x }) =>
    generate(
      'weekTotal',
      [
        '每天有',
        { condition: `${x}节体育课` },
        '，周末也上课，',
        { clue: '一个星期' },
        { question: '有几节体育课' },
        '？',
      ],
      x * 7,
      '节',
      WEEK_HIDDEN,
    ),
  ({ x }) =>
    generate(
      'weekTotal',
      [
        '每天读',
        { condition: `${x}页课外书` },
        '，周末也读，',
        { clue: '一个星期' },
        { question: '能读多少页' },
        '？',
      ],
      x * 7,
      '页',
      WEEK_HIDDEN,
    ),
  ({ x }) =>
    generate(
      'weekTotal',
      [
        '每天做',
        { condition: `${x}道口算题` },
        '，周末也做，',
        { clue: '一个星期' },
        { question: '能做多少道' },
        '？',
      ],
      x * 7,
      '道',
      WEEK_HIDDEN,
    ),
  ({ x }) =>
    generate(
      'weekTotal',
      [
        '每天跳绳',
        { condition: `${x}分钟` },
        '，周末也跳，',
        { clue: '一个星期' },
        { question: '能跳多少分钟' },
        '？',
      ],
      x * 7,
      '分钟',
      WEEK_HIDDEN,
    ),
  ({ x }) =>
    generate(
      'weekTotal',
      [
        '每天背',
        { condition: `${x}首古诗` },
        '，周末也背，',
        { clue: '一个星期' },
        { question: '能背多少首' },
        '？',
      ],
      x * 7,
      '首',
      WEEK_HIDDEN,
    ),
  ({ x }) =>
    generate(
      'weekTotal',
      [
        '每天写',
        { condition: `${x}个毛笔字` },
        '，周末也写，',
        { clue: '一个星期' },
        { question: '能写多少个' },
        '？',
      ],
      x * 7,
      '个',
      WEEK_HIDDEN,
    ),
  ({ x }) =>
    generate(
      'weekTotal',
      [
        '每天存',
        { condition: `${x}元` },
        '，周末也存，',
        { clue: '一个星期' },
        { question: '能存多少元' },
        '？',
      ],
      x * 7,
      '元',
      WEEK_HIDDEN,
    ),
];

const SCENARIOS: Record<WordProblemKind, Scenario[]> = {
  multiplyTotal: MULTIPLY_SCENARIOS,
  divisionShare: DIVISION_SHARE_SCENARIOS,
  divisionGroup: DIVISION_GROUP_SCENARIOS,
  weekTotal: WEEK_SCENARIOS,
};

const RANDOM_FALLBACK_LIMIT = 300;
const CANDIDATE_CACHE = new Map<WordProblemKind, GeneratedWordProblem[]>();

/** 随机失败太多次时，按固定顺序枚举全部候选组合，保证每轮一定能够结束。 */
function fallbackCandidate(
  kind: WordProblemKind,
  seen: Set<string>,
): GeneratedWordProblem | null {
  let candidates = CANDIDATE_CACHE.get(kind);
  if (!candidates) {
    candidates = [];
    for (const scenario of SCENARIOS[kind])
      for (let x = 2; x <= 9; x += 1)
        for (let y = 2; y <= 9; y += 1)
          for (let z = 2; z <= 9; z += 1)
            candidates.push(scenario({ x, y, z }));
    CANDIDATE_CACHE.set(kind, candidates);
  }
  return candidates.find((candidate) => !seen.has(candidate.story)) ?? null;
}

function randomCandidate(
  kind: WordProblemKind,
  int: (min: number, max: number) => number,
): GeneratedWordProblem {
  const scenarios = SCENARIOS[kind];
  const scenario = scenarios[int(0, scenarios.length - 1)];
  return scenario({ x: int(2, 9), y: int(2, 9), z: int(2, 9) });
}

/**
 * 生成 count 道互不重复的应用题：乘法求总数、除法（平均分/按份分组）、
 * 一个星期 7 天的隐藏条件三类轮流出现，题量 >= 3 时一定覆盖三类。
 *
 * 题目答案规则：乘法两个乘数 2～9；除法都整除且除数、商 2～9；
 * 星期题每天数量 2～9（答案 14～63）。
 */
export function makeWordProblemSpecs(
  count: number,
  int: (min: number, max: number) => number,
): GeneratedWordProblem[] {
  const specs: GeneratedWordProblem[] = [];
  if (count <= 0) return specs;
  const seen = new Set<string>();
  const classOffset = int(0, 2);
  let divisionCount = 0;
  let randomAttempts = 0;
  while (specs.length < count) {
    const classIndex = (specs.length + classOffset) % 3;
    let kind: WordProblemKind;
    if (classIndex === 0) kind = 'multiplyTotal';
    else if (classIndex === 2) kind = 'weekTotal';
    else {
      kind = divisionCount % 2 === 0 ? 'divisionShare' : 'divisionGroup';
      divisionCount += 1;
    }
    let candidate: GeneratedWordProblem | null;
    if (randomAttempts < RANDOM_FALLBACK_LIMIT) {
      randomAttempts += 1;
      candidate = randomCandidate(kind, int);
    } else {
      candidate = fallbackCandidate(kind, seen);
    }
    if (!candidate) throw new Error(`无法生成足够的${kind}应用题`);
    if (seen.has(candidate.story)) continue;
    seen.add(candidate.story);
    specs.push(candidate);
  }
  return specs;
}

/** 三道固定示例：与产品给出的原始例子逐字对应，供预览页与测试核对。 */
export const wordProblemExamples: FixedWordProblem[] = [
  {
    id: 'example-snacks',
    label: '示例 1 · 一共有多少包（乘法求总数）',
    prompt: MULTIPLY_SCENARIOS[0]({ x: 6, y: 8, z: 5 }).prompt,
    answer: 48,
  },
  {
    id: 'example-apples',
    label: '示例 2 · 每个孩子分几个（平均分）',
    prompt: DIVISION_SHARE_SCENARIOS[0]({ x: 3, y: 6, z: 5 }).prompt,
    answer: 6,
  },
  {
    id: 'example-week',
    label: '示例 3 · 一个星期几节课（隐藏条件）',
    prompt: WEEK_SCENARIOS[0]({ x: 2, y: 2, z: 2 }).prompt,
    answer: 14,
  },
];

/** 判断未知 promptData 是否为新版应用题，兼容旧版 steps 数据。 */
export function asWordProblemV2Prompt(
  value: unknown,
): WordProblemV2Prompt | null {
  if (!value || typeof value !== 'object') return null;
  const prompt = value as Partial<WordProblemV2Prompt>;
  if (prompt.version !== WORD_PROBLEM_PROMPT_VERSION) return null;
  if (typeof prompt.story !== 'string' || !Array.isArray(prompt.parts))
    return null;
  if (!Array.isArray(prompt.conditionIds)) return null;
  if (typeof prompt.questionId !== 'string') return null;
  return prompt as WordProblemV2Prompt;
}

/** 找已知条件步骤的校验结果：null 表示恰好选对。 */
export type ConditionCheckCode =
  | 'questionAsCondition'
  | 'missing'
  | 'extra'
  | 'hiddenMissing'
  | 'hiddenInvalid';

/**
 * 第 1 步（找已知条件）只校验题干里的点选：漏选、多选（含干扰条件）、
 * 把问题当条件都不能继续。隐藏条件在单独的隐藏条件步骤再校验，
 * 因此这里不接收隐藏条件的输入。
 */
export function checkConditionSelection(
  prompt: WordProblemV2Prompt,
  selectedIds: string[],
): ConditionCheckCode | null {
  if (selectedIds.includes(prompt.questionId)) return 'questionAsCondition';
  const required = new Set(prompt.conditionIds);
  if (prompt.conditionIds.some((id) => !selectedIds.includes(id)))
    return 'missing';
  if (selectedIds.some((id) => !required.has(id))) return 'extra';
  return null;
}

/**
 * 隐藏条件步骤的校验结果：没有隐藏条件的题目直接通过；隐藏条件没写或
 * 语义不对（例如把「一个星期」写成 5 天）返回对应错误码。
 */
export function checkHiddenConditionStep(
  prompt: WordProblemV2Prompt,
  hiddenInput: string,
): 'hiddenMissing' | 'hiddenInvalid' | null {
  if (!prompt.hiddenCondition) return null;
  if (!hiddenInput.trim()) return 'hiddenMissing';
  if (!checkHiddenCondition(prompt.hiddenCondition.kind, hiddenInput))
    return 'hiddenInvalid';
  return null;
}

/** 问题阶段校验结果：null 表示恰好选中了所求问题。 */
export function checkQuestionSelection(
  prompt: WordProblemV2Prompt,
  selectedIds: string[],
): 'none' | 'notQuestion' | null {
  if (selectedIds.length === 0) return 'none';
  if (selectedIds.length !== 1 || selectedIds[0] !== prompt.questionId)
    return 'notQuestion';
  return null;
}

const HIDDEN_REJECT = /[不没无非错半或大概可能左右几多少]/;

function parseChineseNumber(text: string): number | null {
  const digits = '零一二三四五六七八九';
  if (text === '十') return 10;
  if (text.includes('十')) {
    const [tensText, onesText = ''] = text.split('十');
    const tens = tensText === '' ? 1 : digits.indexOf(tensText);
    const ones = onesText === '' ? 0 : digits.indexOf(onesText);
    if (tens < 1 || ones < 0) return null;
    return tens * 10 + ones;
  }
  const normalized = text.replaceAll('两', '二');
  if (normalized.length === 1) {
    const index = digits.indexOf(normalized);
    return index < 0 ? null : index;
  }
  return null;
}

/** 数量短语里的数字：阿拉伯数字或中文数字。 */
function parseNumberToken(text: string): number | null {
  return /^\d+$/.test(text) ? Number(text) : parseChineseNumber(text);
}

/**
 * 隐藏条件的宽容语义校验：接受「一周七天」「每个星期有 7 天」「7 天」
 * 「一星期有 7 日」「全角７天」等意思是 7 天的说法；拒绝 5 天、7 节、
 * 不知道、否定或自相矛盾（如「不是 7 天」「一周 7 天或 5 天」），以及
 * 把 7 天说成月份/年份或复数个星期（如「一个月有 7 天」「两个星期有
 * 7 天」），它们与「一个星期有 7 天」冲突。
 */
export function checkHiddenCondition(
  kind: WordProblemHiddenKind,
  input: string,
): boolean {
  if (kind !== 'weekDays') return false;
  const text = input.normalize('NFKC').replace(/\s+/g, '');
  if (!text || HIDDEN_REJECT.test(text) || /[?？]/.test(text)) return false;
  // 一个月/一年都不可能只有 7 天，提到月份或年份就不可能是这个隐藏条件。
  if (/[月年]/.test(text)) return false;
  // 「一个星期」才等于 7 天；「两个星期」「2 周」「半个星期」等复数/残缺
  // 周数即使后面跟着 7 天，语义也和「一个星期有 7 天」矛盾。
  for (const match of text.matchAll(
    /(\d+|[零一二两三四五六七八九十百半]+)(?:个)?(?:星期|周|礼拜)/g,
  )) {
    if (parseNumberToken(match[1]) !== 1) return false;
  }
  const claims: number[] = [];
  for (const match of text.matchAll(
    /(\d+|[零一二两三四五六七八九十]+)(?:天|日)/g,
  )) {
    const value = parseNumberToken(match[1]);
    if (value === null) return false;
    claims.push(value);
  }
  return claims.length > 0 && claims.every((value) => value === 7);
}

export const WORD_PROBLEM_DRAFT_VERSION = 1;

/**
 * v2 答题流程的步骤：普通题为 条件 → 问题 → 答案（3 步）；
 * 有隐藏条件的题目多一步：条件 → 隐藏条件 → 问题 → 答案（4 步）。
 */
export type WordProblemStage =
  | 'conditions'
  | 'hidden'
  | 'question'
  | 'answer';

/** 分步草稿只保存在当前浏览器 sessionStorage，失败时不影响做题。 */
export type WordProblemStepDraft = {
  version: typeof WORD_PROBLEM_DRAFT_VERSION;
  fingerprint: string;
  stage: WordProblemStage;
  conditionsVerified: boolean;
  questionVerified: boolean;
  selectedConditions: string[];
  selectedQuestions: string[];
  hiddenInput: string;
  clueOpen: boolean;
};

export type WordProblemStepDraftData = Omit<
  WordProblemStepDraft,
  'version' | 'fingerprint'
>;

const DRAFT_PREFIX = 'word-problem-step:';

/** 用题干指纹隔离同一 question.id 在不同轮次/换一组后的草稿。 */
export function wordProblemFingerprint(story: string): string {
  let hash = 2166136261;
  for (let index = 0; index < story.length; index += 1) {
    hash ^= story.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

export function wordProblemDraftKey(questionId: string): string {
  return `${DRAFT_PREFIX}${questionId}`;
}

function defaultStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readWordProblemStepDraft(
  questionId: string,
  story: string,
  storage: Storage | null = defaultStorage(),
): WordProblemStepDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(wordProblemDraftKey(questionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WordProblemStepDraft> | null;
    if (!parsed || parsed.version !== WORD_PROBLEM_DRAFT_VERSION) return null;
    if (parsed.fingerprint !== wordProblemFingerprint(story)) return null;
    const { stage } = parsed;
    if (
      stage !== 'conditions' &&
      stage !== 'hidden' &&
      stage !== 'question' &&
      stage !== 'answer'
    )
      return null;
    const strings = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
    return {
      version: WORD_PROBLEM_DRAFT_VERSION,
      fingerprint: parsed.fingerprint,
      stage,
      conditionsVerified: Boolean(parsed.conditionsVerified),
      questionVerified: Boolean(parsed.questionVerified),
      selectedConditions: strings(parsed.selectedConditions),
      selectedQuestions: strings(parsed.selectedQuestions),
      hiddenInput:
        typeof parsed.hiddenInput === 'string' ? parsed.hiddenInput : '',
      clueOpen: Boolean(parsed.clueOpen),
    };
  } catch {
    return null;
  }
}

export function writeWordProblemStepDraft(
  questionId: string,
  story: string,
  data: WordProblemStepDraftData,
  storage: Storage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      wordProblemDraftKey(questionId),
      JSON.stringify({
        version: WORD_PROBLEM_DRAFT_VERSION,
        fingerprint: wordProblemFingerprint(story),
        ...data,
      } satisfies WordProblemStepDraft),
    );
  } catch {
    /* 隐私模式或存储配额不足时忽略，答题和云端保存仍然可用。 */
  }
}

export function clearWordProblemStepDraft(
  questionId: string,
  storage: Storage | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(wordProblemDraftKey(questionId));
  } catch {
    /* 本地存储不可用时无需清理。 */
  }
}

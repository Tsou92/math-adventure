export type Rng = () => number;

export type MistakeTypeId =
  | 'addMultiply'
  | 'sumDiffProduct'
  | 'compareGroups'
  | 'countGroups'
  | 'shareEqually'
  | 'maxFill'
  | 'shapeEquation'
  | 'numberPattern';

export type MistakeExample = {
  question: string;
  answer: string;
};

export type MistakePractice = {
  id: string;
  prompt: string;
  answer: number;
};

export type MistakeType = {
  id: MistakeTypeId;
  title: string;
  summary: string;
  method: string[];
  examples: MistakeExample[];
  generate: (rng: Rng) => { prompt: string; answer: number };
};

/** mulberry32：可复现的伪随机数，便于测试。 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: Rng, min: number, max: number) {
  return min + Math.floor(rng() * (max - min + 1));
}

export const mistakeTypes: MistakeType[] = [
  {
    id: 'addMultiply',
    title: '几个几与两数相加、相乘',
    summary: '分清「相加」和「相乘」：几个相同的数相加，就是几乘这个数。',
    method: [
      '几个相同的数相加，可以写成乘法：2 个 8 相加就是 8 + 8 = 2 × 8。',
      '两个数「相加」用加法，「相乘」用乘法，先看清关键字再算。',
    ],
    examples: [
      { question: '2 个 8 相加是多少？', answer: '16' },
      { question: '2 和 8 相加是多少？', answer: '10' },
      { question: '2 个 8 相乘是多少？', answer: '64' },
      { question: '2 和 8 相乘是多少？', answer: '16' },
      { question: '6 和 6 相乘的积是多少？', answer: '36' },
    ],
    generate: (rng) => {
      const a = randInt(rng, 2, 9);
      const b = randInt(rng, 2, 9);
      const kind = randInt(rng, 0, 2);
      if (kind === 0)
        return { prompt: `${a} 和 ${b} 相加是多少？`, answer: a + b };
      if (kind === 1)
        return { prompt: `${a} 和 ${b} 相乘是多少？`, answer: a * b };
      return { prompt: `${a} 个 ${b} 相加是多少？`, answer: a * b };
    },
  },
  {
    id: 'sumDiffProduct',
    title: '已知和（差）与积，求两个数',
    summary: '知道两数的差或和，再结合它们的积，就能推出两个数。',
    method: [
      '先想哪两个数相乘得到这个积，再检查它们的差或和是否符合题目。',
      '可以从乘法口诀入手：56 = 7 × 8，8 − 7 = 1。',
    ],
    examples: [
      {
        question: '两个数相差 1，积是 56，这两个数是几和几？',
        answer: '7 和 8',
      },
      {
        question: '两个数的和是 13，积是 36，这两个数是几和几？',
        answer: '4 和 9',
      },
    ],
    generate: (rng) => {
      const a = randInt(rng, 1, 8);
      const b = randInt(rng, a + 1, 9);
      if (rng() < 0.5)
        return {
          prompt: `两个数相差 ${b - a}，积是 ${a * b}，较大的数是几？`,
          answer: b,
        };
      return {
        prompt: `两个数的和是 ${a + b}，积是 ${a * b}，较小的数是几？`,
        answer: a,
      };
    },
  },
  {
    id: 'compareGroups',
    title: '几个几的多少比较',
    summary: '比较两组同样大小的数量，先求出相差几份，再乘每份的数。',
    method: [
      '先看两边各有几个，相差几个；再把相差的个数乘每个的数。',
      '7 个 9 比 8 个 9 少 9，因为少 1 个 9，就是 9。',
    ],
    examples: [
      { question: '7 个 9 比 8 个 9 少几？', answer: '9' },
      { question: '7 个 9 比 54 多几？（7 个 9 = 63）', answer: '9' },
    ],
    generate: (rng) => {
      const big = randInt(rng, 3, 9);
      const small = randInt(rng, 1, big - 1);
      const unit = randInt(rng, 2, 9);
      return rng() < 0.5
        ? {
            prompt: `${small} 个 ${unit} 比 ${big} 个 ${unit} 少几？`,
            answer: (big - small) * unit,
          }
        : {
            prompt: `${big} 个 ${unit} 比 ${small} 个 ${unit} 多几？`,
            answer: (big - small) * unit,
          };
    },
  },
  {
    id: 'countGroups',
    title: '数一数与分一分',
    summary: '按几个几数，或把东西装成几盘，要注意剩下的数。',
    method: [
      '每次数几个，数了几次，再加上剩下的数：总数 = 每次个数 × 次数 + 剩余。',
      '分盘时用总数除以每盘的个数，整盘有几盘就是几，剩下的单独说明。',
    ],
    examples: [
      {
        question: '5 个 5 个地数，数 38 次，还剩 2 个，一共包了几个饺子？',
        answer: '192',
      },
      {
        question: '每 7 个饺子一盘，192 个饺子可以分成几盘？（整盘）',
        answer: '27',
      },
    ],
    generate: (rng) => {
      if (rng() < 0.5) {
        const m = randInt(rng, 2, 9);
        const times = randInt(rng, 10, 30);
        const rest = randInt(rng, 1, m - 1);
        return {
          prompt: `${m} 个 ${m} 个地数，数了 ${times} 次，还剩 ${rest} 个，一共有多少个？`,
          answer: m * times + rest,
        };
      }
      const per = randInt(rng, 3, 9);
      const total = randInt(rng, 10, 60);
      return {
        prompt: `${total} 个饺子，每 ${per} 个一盘，最多能装满几盘？`,
        answer: Math.floor(total / per),
      };
    },
  },
  {
    id: 'shareEqually',
    title: '平均分与逆向思考',
    summary: '把错算的乘法还原成正确的除法，先找回原来的数。',
    method: [
      '看错的运算符：原本是除，错算成了乘。先用错的结果除以这个数，找回原来的数。',
      '平均分：总数 ÷ 份数 = 每份的数，用乘法口诀检验。',
    ],
    examples: [
      {
        question:
          '乐乐在计算一个数除以 8，不小心把 ÷ 看成了 ×，这样算出的结果是 64，正确的结果是多少？',
        answer: '1',
      },
    ],
    generate: (rng) => {
      if (rng() < 0.5) {
        const d = randInt(rng, 2, 9);
        const k = randInt(rng, 2, 9);
        const n = d * k;
        return {
          prompt: `一个数除以 ${d}，不小心把 ÷ 看成了 ×，算出的结果是 ${n * d}，正确的结果是多少？`,
          answer: k,
        };
      }
      const parts = randInt(rng, 2, 9);
      const each = randInt(rng, 2, 9);
      return {
        prompt: `把 ${parts * each} 颗糖平均分给 ${parts} 个小朋友，每人分几颗？`,
        answer: each,
      };
    },
  },
  {
    id: 'maxFill',
    title: '最大能填几',
    summary: '算式里的空格要比较大小，先算出能填的范围，再取最大值。',
    method: [
      '先把已知的积或数减 1（因为要求「小于」），再除以已知的数。',
      '例如 9 × □ < 81：80 ÷ 9 约等于 8.9，所以最大填 8。',
    ],
    examples: [
      { question: '81 > 9 × □，□ 里最大填几？', answer: '8' },
      { question: '5 × □ < 27，□ 里最大填几？', answer: '5' },
    ],
    generate: (rng) => {
      const a = randInt(rng, 2, 9);
      const p = randInt(rng, 20, 81);
      const answer = Math.floor((p - 1) / a);
      return rng() < 0.5
        ? { prompt: `${a} × □ < ${p}，□ 里最大填几？`, answer }
        : { prompt: `${p} > ${a} × □，□ 里最大填几？`, answer };
    },
  },
  {
    id: 'shapeEquation',
    title: '图形代表的数',
    summary: '同样的图形代表同样的数，先找出一个图形，再求另一个。',
    method: [
      '三个 ○ 相加等于总数：总数 ÷ 3 就是 ○ 的值。',
      '△ × 已知数 = 积：积 ÷ 已知数 就是 △ 的值。',
    ],
    examples: [
      { question: '○ + ○ + ○ = 18，○ 是几？', answer: '6' },
      { question: '△ × ○ = 30（○ 为 6），△ 是几？', answer: '5' },
    ],
    generate: (rng) => {
      if (rng() < 0.5) {
        const k = randInt(rng, 2, 9);
        return { prompt: `○ + ○ + ○ = ${3 * k}，○ 是几？`, answer: k };
      }
      const x = randInt(rng, 2, 9);
      const y = randInt(rng, 2, 9);
      return { prompt: `△ × ${x} = ${x * y}，△ 是几？`, answer: y };
    },
  },
  {
    id: 'numberPattern',
    title: '找规律填数',
    summary: '看前几项怎么变化，有两组交替变化的，要分开看奇数位和偶数位。',
    method: [
      '先看相邻两个数的差，如果差不一样，就分成两列各自找规律。',
      '平方数的规律：1、4、9、16、25……是 1×1、2×2、3×3……',
    ],
    examples: [
      {
        question: '2、5、4、10、6、15、（ ）、（ ）、（ ）、（ ）',
        answer: '8、20、10、25',
      },
      {
        question: '1、4、9、（ ）、（ ）、（ ）、（ ）、（ ）',
        answer: '16、25、36、49、64',
      },
    ],
    generate: (rng) => {
      if (rng() < 0.5) {
        const start = randInt(rng, 1, 4);
        const shown = [0, 1, 2, 3].map((i) => (start + i) ** 2);
        return {
          prompt: `${shown.join('、')}、（ ），括号里填几？`,
          answer: (start + 4) ** 2,
        };
      }
      const a = randInt(rng, 1, 6);
      const s = randInt(rng, 1, 4);
      const b = randInt(rng, 2, 9);
      const t = randInt(rng, 2, 6);
      const shown: number[] = [];
      for (let i = 0; i < 6; i++)
        shown.push(i % 2 === 0 ? a + (i / 2) * s : b + ((i - 1) / 2) * t);
      return {
        prompt: `${shown.join('、')}、（ ），括号里填几？`,
        answer: a + 3 * s,
      };
    },
  },
];

export function getMistakeType(id: MistakeTypeId) {
  const type = mistakeTypes.find((item) => item.id === id);
  if (!type) throw new Error(`未知题型：${id}`);
  return type;
}

export function buildMistakePractice(
  id: MistakeTypeId,
  count: number,
  rng: Rng = Math.random,
): MistakePractice[] {
  const type = getMistakeType(id);
  return Array.from({ length: count }, (_, index) => {
    const item = type.generate(rng);
    return { id: `${id}-${index}`, ...item };
  });
}

/** 判断孩子输入的答案是否正确；空白或非整数视为不正确。 */
export function isMistakeAnswerCorrect(input: string, answer: number) {
  const value = input.trim();
  return /^-?\d+$/.test(value) && Number(value) === answer;
}

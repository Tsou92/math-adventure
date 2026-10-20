import {
  test,
  expect,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';
import { makeQuestionsForCounts } from '../lib/questions';
import { emptyCounts } from '../lib/learning';
import type {
  Level,
  QuestionPrompt,
  WordProblemPrompt,
} from '../lib/questions';
import { asWordProblemV2Prompt } from '../lib/word-problems';
import type { Round, RoundQuestion, User } from '../lib/types';

type SaveItem = { questionId: string; answer: string; clientVersion: number };

type AnswerRouteHandler = (
  route: Route,
  body: { answers: SaveItem[] },
) => Promise<void>;

function previewFlow(page: Page, cardId: string): Locator {
  return page.getByTestId(cardId).getByTestId('word-problem');
}

function toRoundQuestion(
  question: {
    id: string;
    level: Level;
    expression: string;
    answer: number;
    promptData?: QuestionPrompt;
  },
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

async function mockChildApi(
  page: Page,
  round: Round,
  saves: SaveItem[],
  onAnswers?: AnswerRouteHandler,
) {
  const user: User = {
    id: 'child-1',
    username: 'kid',
    displayName: '小朋友',
    role: 'child',
    mustChangePassword: false,
  };
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { user } }),
  );
  await page.route('**/api/rounds/active', (route) =>
    route.fulfill({ json: { round } }),
  );
  await page.route('**/api/records', (route) =>
    route.fulfill({ json: { records: [] } }),
  );
  await page.route('**/api/wrong-book', (route) =>
    route.fulfill({ json: { wrongQuestions: [] } }),
  );
  await page.route('**/api/learning/preferences', (route) =>
    route.fulfill({
      json: {
        preferences: {
          counts: round.counts,
          challengerChain: false,
          mode: round.mode,
        },
      },
    }),
  );
  await page.route('**/api/learning/progress', (route) =>
    route.fulfill({
      json: {
        topics: [],
        summary: {
          rounds: 0,
          questions: 0,
          correct: 0,
          practice_days: 0,
        },
        recent: [],
      },
    }),
  );
  await page.route(/\/api\/rounds\/[^/]+\/answers$/, async (route) => {
    const body = route.request().postDataJSON() as { answers: SaveItem[] };
    saves.push(...body.answers);
    if (onAnswers) {
      await onAnswers(route, body);
      return;
    }
    await route.fulfill({
      json: {
        ok: true,
        saved: body.answers.map((item) => ({
          questionId: item.questionId,
          answerText: item.answer,
          clientVersion: item.clientVersion,
        })),
      },
    });
  });
}


/** 挑一个前两题都是「无隐藏条件、无干扰条件」的种子，方便端到端点选。 */
function pickSimpleSeed(): number {
  for (let seed = 1; seed < 500; seed += 1) {
    const questions = makeQuestionsForCounts(seed, {
      ...emptyCounts,
      mixedWordProblem: 2,
    });
    const simple = questions.every((question) => {
      const prompt = asWordProblemV2Prompt(question.promptData);
      if (!prompt || prompt.hiddenCondition) return false;
      return (
        prompt.parts.filter((part) => part.type === 'condition').length ===
        prompt.conditionIds.length
      );
    });
    if (simple) return seed;
  }
  throw new Error('找不到适合端到端点选的种子');
}

/** 找一道带干扰条件的随机乘法题；当前这组没有就点「换一组」。 */
async function findDistractorCard(page: Page): Promise<Locator | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const cards = page.locator('[data-testid^="preview-card-random-"]');
    const count = await cards.count();
    for (let index = 0; index < count; index += 1) {
      const card = cards.nth(index);
      if ((await card.getAttribute('data-kind')) !== 'multiplyTotal') continue;
      const conditions = card.locator(
        '[data-testid="word-problem"] [data-kind="condition"]',
      );
      if ((await conditions.count()) >= 3) return card;
    }
    await page.getByRole('button', { name: '换一组' }).click();
    await expect(
      page.locator('[data-testid^="preview-card-random-"]').first(),
    ).toBeVisible();
  }
  return null;
}

test.describe('乘除应用题 · 开发预览页', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/word-problems');
    await expect(page.getByTestId('preview-card-example-snacks')).toBeVisible();
  });

  test('三道原始示例按真实步骤作答：普通题 3 步，隐藏条件题先条件再隐藏条件最后答案', async ({
    page,
  }) => {
    // 示例 1：一箱薯片（普通题 3 步：条件 → 问题 → 答案）
    const snacks = previewFlow(page, 'preview-card-example-snacks');
    await expect(snacks).toHaveAttribute('data-stage', 'conditions');
    await expect(snacks).toHaveAttribute('data-step-count', '3');
    await expect(snacks.getByTestId('wp-stage-label')).toHaveText(
      '第 1 步 / 共 3 步：找已知条件',
    );
    await expect(snacks.getByTestId('wp-answer-input')).toHaveCount(0);
    await expect(snacks.getByTestId('wp-hidden-input')).toHaveCount(0);
    await snacks.getByTestId('wp-part-c1').click();
    await snacks.getByTestId('wp-part-c2').click();
    await snacks.getByTestId('wp-next').click();
    await expect(snacks).toHaveAttribute('data-stage', 'question');
    await expect(snacks.getByTestId('wp-answer-input')).toHaveCount(0);
    await snacks.getByTestId('wp-part-q').click();
    await snacks.getByTestId('wp-next').click();
    await expect(snacks).toHaveAttribute('data-stage', 'answer');
    await snacks.getByTestId('wp-answer-input').fill('48');
    await snacks.getByTestId('wp-check').click();
    await expect(snacks.getByTestId('wp-check-feedback')).toContainText(
      '答对了',
    );
    // 检查反馈只对检查时的答案有效：答案一改，旧反馈立即失效。
    await snacks.getByTestId('wp-answer-input').fill('47');
    await expect(snacks.getByTestId('wp-check-feedback')).toHaveCount(0);
    await snacks.getByTestId('wp-check').click();
    await expect(snacks.getByTestId('wp-check-feedback')).toHaveAttribute(
      'role',
      'alert',
    );
    await snacks.getByTestId('wp-answer-input').fill('48');
    await snacks.getByTestId('wp-check').click();
    await expect(snacks.getByTestId('wp-check-feedback')).toContainText(
      '答对了',
    );

    // 示例 2：分苹果（先错后对，确认反馈不泄露答案）
    const apples = previewFlow(page, 'preview-card-example-apples');
    await expect(apples).toHaveAttribute('data-step-count', '3');
    await apples.getByTestId('wp-part-c1').click();
    await apples.getByTestId('wp-part-c2').click();
    await apples.getByTestId('wp-next').click();
    await apples.getByTestId('wp-part-q').click();
    await apples.getByTestId('wp-next').click();
    await apples.getByTestId('wp-answer-input').fill('5');
    await apples.getByTestId('wp-check').click();
    await expect(apples.getByTestId('wp-check-feedback')).toHaveAttribute(
      'role',
      'alert',
    );
    await apples.getByTestId('wp-answer-input').fill('6');
    await apples.getByTestId('wp-check').click();
    await expect(apples.getByTestId('wp-check-feedback')).toContainText(
      '答对了',
    );

    // 示例 3：隐藏条件「一个星期 7 天」（4 步：条件 → 隐藏条件 → 问题 → 答案）
    const week = previewFlow(page, 'preview-card-example-week');
    await expect(week).toHaveAttribute('data-stage', 'conditions');
    await expect(week).toHaveAttribute('data-step-count', '4');
    // 第 1 步只点选已知条件，不能提前看到隐藏条件输入框
    await expect(week.getByTestId('wp-hidden-input')).toHaveCount(0);
    await week.getByTestId('wp-part-c1').click();
    await week.getByTestId('wp-next').click();
    await expect(week).toHaveAttribute('data-stage', 'hidden');
    await expect(week.getByTestId('wp-stage-label')).toHaveText(
      '第 2 步 / 共 4 步：找隐藏条件',
    );
    await expect(week.getByTestId('wp-hidden-input')).toBeVisible();
    // 隐藏条件写错不能进入问题阶段
    await week.getByTestId('wp-hidden-input').fill('5天');
    await week.getByTestId('wp-next').click();
    await expect(week).toHaveAttribute('data-stage', 'hidden');
    await expect(week.getByTestId('wp-feedback')).toHaveText('再想一想。');
    // 宽容写法通过后进入问题阶段
    await week.getByTestId('wp-hidden-input').fill('一星期有7天');
    await week.getByTestId('wp-next').click();
    await expect(week).toHaveAttribute('data-stage', 'question');
    await expect(week.getByTestId('wp-hidden-input')).toHaveCount(0);
    await expect(week.getByTestId('wp-hidden-confirmed')).toContainText(
      '一星期有7天',
    );
    await week.getByTestId('wp-part-q').click();
    await week.getByTestId('wp-next').click();
    await expect(week).toHaveAttribute('data-stage', 'answer');
    await expect(week.getByTestId('wp-stage-label')).toHaveText(
      '第 4 步 / 共 4 步：算答案',
    );
    await week.getByTestId('wp-answer-input').fill('14');
    await week.getByTestId('wp-check').click();
    await expect(week.getByTestId('wp-check-feedback')).toContainText(
      '答对了',
    );
  });

  test('条件阶段漏选、把问题当条件、多选都不能继续，选中可以取消', async ({
    page,
  }) => {
    const snacks = previewFlow(page, 'preview-card-example-snacks');
    // 漏选
    await snacks.getByTestId('wp-next').click();
    await expect(snacks).toHaveAttribute('data-stage', 'conditions');
    await expect(snacks.getByTestId('wp-feedback')).toHaveText('再想一想。');
    // 取消选择
    await snacks.getByTestId('wp-part-c1').click();
    await expect(snacks.getByTestId('wp-part-c1')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await snacks.getByTestId('wp-part-c1').click();
    await expect(snacks.getByTestId('wp-part-c1')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // 把问题当条件
    await snacks.getByTestId('wp-part-c1').click();
    await snacks.getByTestId('wp-part-c2').click();
    await snacks.getByTestId('wp-part-q').click();
    await snacks.getByTestId('wp-next').click();
    await expect(snacks).toHaveAttribute('data-stage', 'conditions');
    await expect(snacks.getByTestId('wp-feedback')).toHaveText('再想一想。');
    await snacks.getByTestId('wp-part-q').click();
    await snacks.getByTestId('wp-next').click();
    await expect(snacks).toHaveAttribute('data-stage', 'question');
    // 问题阶段选错（点成已知条件）也不能继续
    await snacks.getByTestId('wp-part-c1').click();
    await snacks.getByTestId('wp-next').click();
    await expect(snacks).toHaveAttribute('data-stage', 'question');
    await expect(snacks.getByTestId('wp-feedback')).toHaveText('再想一想。');
    await snacks.getByTestId('wp-part-c1').click();
    await snacks.getByTestId('wp-part-q').click();
    await snacks.getByTestId('wp-next').click();
    await expect(snacks).toHaveAttribute('data-stage', 'answer');

    // 多选：随机乘法题里选上干扰条件
    const distractorCard = await findDistractorCard(page);
    expect(distractorCard, '随机题中应包含带干扰条件的乘法题').not.toBeNull();
    const flow = distractorCard!.getByTestId('word-problem');
    const conditions = flow.locator('[data-kind="condition"]');
    const count = await conditions.count();
    for (let index = 0; index < count; index += 1)
      await conditions.nth(index).click();
    await flow.getByTestId('wp-next').click();
    await expect(flow).toHaveAttribute('data-stage', 'conditions');
    await expect(flow.getByTestId('wp-feedback')).toHaveText('再想一想。');
    await conditions.nth(count - 1).click();
    await flow.getByTestId('wp-next').click();
    await expect(flow).toHaveAttribute('data-stage', 'question');
  });

  test('隐藏条件宽容校验，刷新后隐藏条件步骤与问题步骤的草稿都能恢复', async ({
    page,
  }) => {
    const week = previewFlow(page, 'preview-card-example-week');
    await week.getByTestId('wp-part-c1').click();
    await week.getByTestId('wp-next').click();
    await expect(week).toHaveAttribute('data-stage', 'hidden');
    // 不正确的隐藏条件停留在隐藏条件步骤
    await week.getByTestId('wp-hidden-input').fill('不是7天');
    await week.getByTestId('wp-next').click();
    await expect(week).toHaveAttribute('data-stage', 'hidden');
    await expect(week.getByTestId('wp-feedback')).toHaveText('再想一想。');
    // 只输入、不推进时刷新，恢复到隐藏条件步骤并保留输入
    await week.getByTestId('wp-hidden-input').fill('７天');
    await page.reload();
    const hiddenRestored = previewFlow(page, 'preview-card-example-week');
    await expect(hiddenRestored).toHaveAttribute('data-stage', 'hidden');
    await expect(hiddenRestored.getByTestId('wp-hidden-input')).toHaveValue(
      '７天',
    );
    await hiddenRestored.getByTestId('wp-next').click();
    await expect(hiddenRestored).toHaveAttribute('data-stage', 'question');
    await expect(
      hiddenRestored.getByTestId('wp-hidden-confirmed'),
    ).toContainText('７天');

    // 通过隐藏条件后刷新，恢复到问题步骤
    await page.reload();
    const restored = previewFlow(page, 'preview-card-example-week');
    await expect(restored).toHaveAttribute('data-stage', 'question');
    await expect(restored.getByTestId('wp-hidden-input')).toHaveCount(0);
    await expect(restored.getByTestId('wp-part-c1')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await restored.getByTestId('wp-part-q').click();
    await restored.getByTestId('wp-next').click();
    await expect(restored).toHaveAttribute('data-stage', 'answer');
    await restored.getByTestId('wp-answer-input').fill('14');
    await restored.getByTestId('wp-check').click();
    await expect(restored.getByTestId('wp-check-feedback')).toContainText(
      '答对了',
    );
  });

  test('换一组与重新开始会清掉答题进度，旧草稿不会串到新题', async ({
    page,
  }) => {
    const before = await previewFlow(
      page,
      'preview-card-random-0',
    ).getByTestId('wp-story').textContent();
    const snacks = previewFlow(page, 'preview-card-example-snacks');
    await snacks.getByTestId('wp-part-c1').click();
    await snacks.getByTestId('wp-part-c2').click();
    await snacks.getByTestId('wp-next').click();
    await expect(snacks).toHaveAttribute('data-stage', 'question');

    await page.getByRole('button', { name: '换一组' }).click();
    const after = await previewFlow(page, 'preview-card-random-0')
      .getByTestId('wp-story')
      .textContent();
    expect(after).not.toBe(before);
    await expect(previewFlow(page, 'preview-card-random-0')).toHaveAttribute(
      'data-stage',
      'conditions',
    );

    await page.getByRole('button', { name: '重新开始' }).click();
    const reset = previewFlow(page, 'preview-card-example-snacks');
    await expect(reset).toHaveAttribute('data-stage', 'conditions');
    await expect(reset.getByTestId('wp-part-c1')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

test.describe('正式答题页 · 分步草稿与保存协议', () => {
  test('单题/整页切换与刷新都恢复步骤，上游改动清空已填最终答案', async ({
    page,
  }) => {
    const generated = makeQuestionsForCounts(pickSimpleSeed(), {
      ...emptyCounts,
      mixedWordProblem: 2,
    });
    const questions = generated.map((question, index) =>
      toRoundQuestion(question, index + 1),
    );
    const round: Round = {
      id: '11111111-1111-1111-1111-111111111111',
      mode: 'practice',
      status: 'started',
      source: 'custom',
      packageName: '测试',
      counts: { ...emptyCounts, mixedWordProblem: 2 },
      totalCount: 2,
      startedAt: new Date().toISOString(),
      completedAt: null,
      challengerChain: false,
      questions,
    };
    const expected = generated.map((question) => String(question.answer));
    const saves: SaveItem[] = [];
    await mockChildApi(page, round, saves);

    await page.goto('/#practice');
    const firstUnit = page.locator('[data-unit="0"]');
    const first = firstUnit.getByTestId('word-problem');
    await expect(first).toBeVisible();
    await expect(first).toHaveAttribute('data-stage', 'conditions');
    const firstConditions = first.locator('[data-kind="condition"]');
    const firstConditionCount = await firstConditions.count();
    expect(firstConditionCount).toBeGreaterThan(0);
    for (let index = 0; index < firstConditionCount; index += 1)
      await firstConditions.nth(index).click();
    await first.getByTestId('wp-next').click();
    await first.getByTestId('wp-part-q').click();
    await first.getByTestId('wp-next').click();
    await expect(first).toHaveAttribute('data-stage', 'answer');
    await first.getByTestId('wp-answer-input').fill(expected[0]);
    await expect
      .poll(() =>
        saves.some(
          (item) =>
            item.questionId === questions[0].id &&
            item.answer === expected[0],
        ),
      )
      .toBe(true);
    // 保存协议不变：仍是纯数字答案 + 递增 clientVersion
    const saved = saves.find(
      (item) => item.questionId === questions[0].id && item.answer === expected[0],
    )!;
    expect(typeof saved.clientVersion).toBe('number');
    expect(saved.clientVersion).toBeGreaterThanOrEqual(1);

    // 切换到单题模式：组件重挂载后从 sessionStorage 恢复阶段
    await page.getByRole('button', { name: '切换单题答题' }).click();
    await expect(page.getByTestId('word-problem')).toHaveCount(1);
    const single = page.getByTestId('word-problem').first();
    await expect(single).toHaveAttribute('data-stage', 'answer');
    await expect(single.getByTestId('wp-answer-input')).toHaveValue(
      expected[0],
    );

    // 单题模式下切换题目再回来，草稿仍然按题目隔离
    await page.getByRole('button', { name: /下一题|先跳过/ }).click();
    const second = page.getByTestId('word-problem').first();
    await expect(second).toHaveAttribute('data-stage', 'conditions');
    await page.getByRole('button', { name: '上一题' }).click();
    const back = page.getByTestId('word-problem').first();
    await expect(back).toHaveAttribute('data-stage', 'answer');
    await expect(back.getByTestId('wp-answer-input')).toHaveValue(expected[0]);

    // 刷新整页后仍恢复
    await page.reload();
    const reloaded = page
      .locator('[data-unit="0"]')
      .getByTestId('word-problem');
    await expect(reloaded).toHaveAttribute('data-stage', 'answer');
    await expect(reloaded.getByTestId('wp-answer-input')).toHaveValue(
      expected[0],
    );

    // 上游修改问题选择后，已填最终答案必须失效并清空
    await reloaded.getByTestId('wp-back').click();
    await expect(reloaded).toHaveAttribute('data-stage', 'question');
    await reloaded.getByTestId('wp-part-q').click();
    await expect
      .poll(
        () =>
          saves.filter((item) => item.questionId === questions[0].id).at(-1)
            ?.answer,
      )
      .toBe('');
    await reloaded.getByTestId('wp-part-q').click();
    await reloaded.getByTestId('wp-next').click();
    await expect(reloaded).toHaveAttribute('data-stage', 'answer');
    await expect(reloaded.getByTestId('wp-answer-input')).toHaveValue('');

    // 回到条件阶段修改条件，同样使已填最终答案失效
    await reloaded.getByTestId('wp-answer-input').fill(expected[0]);
    await expect
      .poll(
        () =>
          saves.filter((item) => item.questionId === questions[0].id).at(-1)
            ?.answer,
      )
      .toBe(expected[0]);
    await reloaded.getByTestId('wp-back').click();
    await reloaded.getByTestId('wp-back').click();
    await expect(reloaded).toHaveAttribute('data-stage', 'conditions');
    await reloaded.getByTestId('wp-part-c1').click();
    await expect
      .poll(
        () =>
          saves.filter((item) => item.questionId === questions[0].id).at(-1)
            ?.answer,
      )
      .toBe('');
  });

  test('父级 answer 被云端答案外部更新或清空时，末步输入框跟随变化', async ({
    page,
  }) => {
    const generated = makeQuestionsForCounts(pickSimpleSeed(), {
      ...emptyCounts,
      mixedWordProblem: 1,
    });
    const question = toRoundQuestion(generated[0], 1);
    const round: Round = {
      id: '33333333-3333-3333-3333-333333333333',
      mode: 'practice',
      status: 'started',
      source: 'custom',
      packageName: '答案同步',
      counts: { ...emptyCounts, mixedWordProblem: 1 },
      totalCount: 1,
      startedAt: new Date().toISOString(),
      completedAt: null,
      challengerChain: false,
      questions: [question],
    };
    const saves: SaveItem[] = [];
    // 第一次冲突：云端答案 123；第二次冲突：云端答案被清空。
    const serverAnswers = [
      { answerText: '123', clientVersion: 7 },
      { answerText: '', clientVersion: 8 },
    ];
    await mockChildApi(page, round, saves, async (route, body) => {
      const next = serverAnswers.shift() ?? {
        answerText: '',
        clientVersion: body.answers[0].clientVersion + 1,
      };
      await route.fulfill({
        status: 409,
        json: {
          error: '答案已在其他设备更新',
          code: 'ANSWER_VERSION_STALE',
          questionId: body.answers[0].questionId,
          answerText: next.answerText,
          clientVersion: next.clientVersion,
        },
      });
    });

    await page.goto('/#practice');
    const flow = page.locator('[data-unit="0"]').getByTestId('word-problem');
    await expect(flow).toHaveAttribute('data-stage', 'conditions');
    const conditions = flow.locator('[data-kind="condition"]');
    const conditionCount = await conditions.count();
    for (let index = 0; index < conditionCount; index += 1)
      await conditions.nth(index).click();
    await flow.getByTestId('wp-next').click();
    await flow.getByTestId('wp-part-q').click();
    await flow.getByTestId('wp-next').click();
    await expect(flow).toHaveAttribute('data-stage', 'answer');

    // 本地先填一个答案，保存时触发版本冲突。
    await flow.getByTestId('wp-answer-input').fill('48');
    const useServerAnswer = page.getByRole('button', { name: '使用已保存答案' });
    await expect(useServerAnswer).toBeVisible();
    await useServerAnswer.click();
    // 接受云端答案后，输入框直接跟随父级 answer 更新为 123。
    await expect(flow.getByTestId('wp-answer-input')).toHaveValue('123');

    // 再编辑触发第二次冲突，云端答案为空：输入框同步清空，而不是保留本地值。
    await flow.getByTestId('wp-answer-input').fill('45');
    await expect(useServerAnswer).toBeVisible();
    await useServerAnswer.click();
    await expect(flow.getByTestId('wp-answer-input')).toHaveValue('');
  });

  test('旧版 steps 与无 promptData 的旧题仍可正常作答', async ({ page }) => {
    const legacyPrompt: WordProblemPrompt = {
      version: 1,
      story: '旧版应用题：有 12 个苹果，平均分给 3 个孩子，每个孩子分几个？',
      steps: [
        {
          type: 'calculate',
          prompt: '计算：12 ÷ 3 = ?',
          correctAnswer: 4,
        },
      ],
    };
    const questions: RoundQuestion[] = [
      {
        id: 'legacy-1',
        position: 1,
        level: 'mixedWordProblem',
        expression: legacyPrompt.story,
        answer: '',
        clientVersion: 1,
        promptData: legacyPrompt,
      },
      {
        id: 'fallback-1',
        position: 2,
        level: 'mixedWordProblem',
        expression: '没有 promptData 的旧应用题：18 块糖分给 6 个小朋友，每人几块？',
        answer: '',
        clientVersion: 1,
      },
    ];
    const round: Round = {
      id: '22222222-2222-2222-2222-222222222222',
      mode: 'practice',
      status: 'started',
      source: 'custom',
      packageName: '旧题兼容',
      counts: { ...emptyCounts, mixedWordProblem: 2 },
      totalCount: 2,
      startedAt: new Date().toISOString(),
      completedAt: null,
      challengerChain: false,
      questions,
    };
    const saves: SaveItem[] = [];
    await mockChildApi(page, round, saves);

    await page.goto('/#practice');
    const legacy = page.locator('[data-unit="0"]').getByTestId('word-problem');
    await expect(legacy).toHaveAttribute('data-stage', 'legacy');
    await expect(legacy).toContainText('旧版应用题');
    await legacy.locator('input').fill('4');
    await legacy.getByRole('button', { name: '提交答案' }).click();
    await expect
      .poll(() => saves.some((item) => item.questionId === 'legacy-1' && item.answer === '4'))
      .toBe(true);

    const fallback = page.locator('[data-unit="1"]').getByTestId('word-problem');
    await expect(fallback).toHaveAttribute('data-stage', 'fallback');
    await fallback.locator('input').fill('7');
    await expect
      .poll(
        () =>
          saves.some(
            (item) => item.questionId === 'fallback-1' && item.answer === '7',
          ),
      )
      .toBe(true);
  });
});

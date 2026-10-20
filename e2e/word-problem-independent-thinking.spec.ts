import { test, expect, type Locator, type Page } from '@playwright/test';
import { emptyCounts } from '../lib/learning';
import type { Round, RoundQuestion, User } from '../lib/types';
import {
  wordProblemDraftKey,
  wordProblemExamples,
  wordProblemFingerprint,
  type WordProblemV2Prompt,
} from '../lib/word-problems';

/**
 * 乘除应用题「降低提示密度」的浏览器回归：
 * - 题干片段（条件/线索/问题）点选与取消只是选择，没有即时反馈、提示框或开关；
 * - 只有「下一步」才统一验证，失败只显示中性提示「再想一想。」且不推进；
 * - 隐藏条件步骤使用中性提问，旧题库里的具体提示不再显示；
 * - 旧 clueOpen 草稿不会恢复任何提示；
 * - 3 步（普通题）与 4 步（隐藏条件题）流程都能正常走到答案。
 */

type SaveItem = { questionId: string; answer: string; clientVersion: number };

function previewFlow(page: Page, cardId: string): Locator {
  return page.getByTestId(cardId).getByTestId('word-problem');
}

function exampleWeekPrompt(): WordProblemV2Prompt {
  const example = wordProblemExamples.find(
    (item) => item.id === 'example-week',
  );
  if (!example) throw new Error('缺少 example-week 示例');
  return example.prompt;
}

/** 与 word-problems.spec.ts 中的 mockChildApi 保持同一套接口 mock。 */
async function mockChildApi(
  page: Page,
  round: Round,
  saves: SaveItem[],
): Promise<void> {
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
  // 正式答题页的「检查答案」走服务端，这里只伪造一次正确结果。
  await page.route(/\/api\/rounds\/[^/]+\/check$/, (route) =>
    route.fulfill({ json: { correct: true, hints: [] } }),
  );
}

test.describe('乘除应用题 · 自主读题与中性反馈', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/word-problems');
    await expect(page.getByTestId('preview-card-example-snacks')).toBeVisible();
  });

  test('点选条件、线索和问题都只是选择：没有即时反馈、提示框或提示开关', async ({
    page,
  }) => {
    // 只有隐藏条件题（example-week）的题干里带线索片段。
    const card = page.getByTestId('preview-card-example-week');
    const flow = card.getByTestId('word-problem');
    await expect(flow).toHaveAttribute('data-stage', 'conditions');
    await expect(flow.getByTestId('wp-next')).toHaveText('下一步');

    // 误点问题片段：只切换选中状态，不出现反馈，也不出现线索提示。
    const questionPart = flow.getByTestId('wp-part-q');
    await expect(questionPart).toHaveAttribute('data-kind', 'question');
    await questionPart.click();
    await expect(questionPart).toHaveAttribute('aria-pressed', 'true');
    await expect(flow.getByTestId('wp-feedback')).toHaveCount(0);
    await expect(flow.locator('.wp-clue-hint')).toHaveCount(0);
    await questionPart.click();
    await expect(questionPart).toHaveAttribute('aria-pressed', 'false');
    await expect(flow.getByTestId('wp-feedback')).toHaveCount(0);

    // 点选线索片段：不再有 aria-expanded、提示 aria-label 或提示框。
    const cluePart = flow.getByTestId('wp-part-clue-1');
    await expect(cluePart).toHaveAttribute('data-kind', 'clue');
    await cluePart.click();
    await expect(cluePart).toHaveAttribute('aria-pressed', 'true');
    await expect(flow.getByTestId('wp-feedback')).toHaveCount(0);
    expect(await cluePart.getAttribute('aria-expanded')).toBeNull();
    expect(await cluePart.getAttribute('aria-label')).toBeNull();
    await expect(card.locator('.wp-clue-toggle')).toHaveCount(0);
    await expect(card.locator('.wp-clue-hint')).toHaveCount(0);
    await expect(card.locator('[aria-label*="提示"]')).toHaveCount(0);
    await expect(page.locator('.wp-clue-toggle')).toHaveCount(0);
    await expect(page.locator('.wp-clue-hint')).toHaveCount(0);
    await expect(page.locator('[aria-label*="提示"]')).toHaveCount(0);

    // 同时多选线索、条件和问题：仍然只是选择，没有即时反馈或提示框。
    const conditionPart = flow.getByTestId('wp-part-c1');
    await conditionPart.click();
    await questionPart.click();
    await expect(cluePart).toHaveAttribute('aria-pressed', 'true');
    await expect(conditionPart).toHaveAttribute('aria-pressed', 'true');
    await expect(questionPart).toHaveAttribute('aria-pressed', 'true');
    await expect(flow.getByTestId('wp-feedback')).toHaveCount(0);
    await expect(flow.locator('.wp-clue-hint')).toHaveCount(0);
    await expect(card.locator('.wp-clue-toggle')).toHaveCount(0);
    await expect(page.locator('.wp-clue-hint')).toHaveCount(0);
    await expect(flow).toHaveAttribute('data-stage', 'conditions');

    // 逐一取消选择：同样没有任何即时反馈或提示。
    await cluePart.click();
    await conditionPart.click();
    await questionPart.click();
    await expect(cluePart).toHaveAttribute('aria-pressed', 'false');
    await expect(conditionPart).toHaveAttribute('aria-pressed', 'false');
    await expect(questionPart).toHaveAttribute('aria-pressed', 'false');
    await expect(flow.getByTestId('wp-feedback')).toHaveCount(0);
    await expect(flow.locator('.wp-clue-hint')).toHaveCount(0);
    await expect(flow).toHaveAttribute('data-stage', 'conditions');
  });

  test('只有点下一步才统一验证：错误反馈一致且不推进，普通题 3 步与隐藏题 4 步都能完成', async ({
    page,
  }) => {
    // 普通题（3 步）：条件 → 问题 → 答案。
    const snacks = previewFlow(page, 'preview-card-example-snacks');
    await expect(snacks).toHaveAttribute('data-step-count', '3');
    await expect(snacks.getByTestId('wp-next')).toHaveText('下一步');
    const snacksFeedback = snacks.getByTestId('wp-feedback');

    // 漏选：点了「下一步」才出现统一中性反馈，阶段不推进。
    await snacks.getByTestId('wp-next').click();
    await expect(snacksFeedback).toHaveText('再想一想。');
    await expect(snacks).toHaveAttribute('data-stage', 'conditions');

    // 只选一个条件：同样是中性反馈，不指出缺了哪个条件。
    await snacks.getByTestId('wp-part-c1').click();
    await snacks.getByTestId('wp-next').click();
    await expect(snacksFeedback).toHaveText('再想一想。');
    await expect(snacks).toHaveAttribute('data-stage', 'conditions');

    // 补选正确后进入问题阶段，成功时没有成功话术。
    await snacks.getByTestId('wp-part-c2').click();
    await snacks.getByTestId('wp-next').click();
    await expect(snacks).toHaveAttribute('data-stage', 'question');
    await expect(snacksFeedback).toHaveCount(0);
    await expect(snacks.getByTestId('wp-next')).toHaveText('下一步');

    // 问题阶段不选：中性反馈且停留在问题阶段。
    await snacks.getByTestId('wp-next').click();
    await expect(snacksFeedback).toHaveText('再想一想。');
    await expect(snacks).toHaveAttribute('data-stage', 'question');

    // 选错（把条件片段当问题）：同一句中性反馈，不指出选错原因。
    await snacks.getByTestId('wp-part-c1').click();
    await snacks.getByTestId('wp-next').click();
    await expect(snacksFeedback).toHaveText('再想一想。');
    await expect(snacks).toHaveAttribute('data-stage', 'question');

    // 取消条件候选、改选正确问题后进入答案阶段。
    await snacks.getByTestId('wp-part-c1').click();
    await snacks.getByTestId('wp-part-q').click();
    await snacks.getByTestId('wp-next').click();
    await expect(snacks).toHaveAttribute('data-stage', 'answer');
    await expect(snacksFeedback).toHaveCount(0);
    await snacks.getByTestId('wp-answer-input').fill('48');
    await snacks.getByTestId('wp-check').click();
    await expect(snacks.getByTestId('wp-check-feedback')).toHaveText(
      '答对了！',
    );

    // 隐藏条件题（4 步）：条件 → 隐藏条件 → 问题 → 答案。
    const week = previewFlow(page, 'preview-card-example-week');
    await expect(week).toHaveAttribute('data-step-count', '4');
    await expect(week.getByTestId('wp-next')).toHaveText('下一步');
    await week.getByTestId('wp-part-c1').click();
    await week.getByTestId('wp-next').click();
    await expect(week).toHaveAttribute('data-stage', 'hidden');
    await expect(week.getByTestId('wp-next')).toHaveText('下一步');

    // 空输入：中性反馈且停在隐藏条件步骤。
    await week.getByTestId('wp-next').click();
    await expect(week.getByTestId('wp-feedback')).toHaveText('再想一想。');
    await expect(week).toHaveAttribute('data-stage', 'hidden');

    // 写成 5 天：同样是中性反馈，不提示正确天数。
    await week.getByTestId('wp-hidden-input').fill('5天');
    await week.getByTestId('wp-next').click();
    await expect(week.getByTestId('wp-feedback')).toHaveText('再想一想。');
    await expect(week).toHaveAttribute('data-stage', 'hidden');

    // 宽容写法「一星期有7天」通过：进入问题阶段，没有成功话术。
    await week.getByTestId('wp-hidden-input').fill('一星期有7天');
    await week.getByTestId('wp-next').click();
    await expect(week).toHaveAttribute('data-stage', 'question');
    await expect(week.getByTestId('wp-feedback')).toHaveCount(0);
    await expect(week).not.toContainText('答对');
    await expect(week.getByTestId('wp-hidden-confirmed')).toContainText(
      '一星期有7天',
    );
    await expect(week.getByTestId('wp-next')).toHaveText('下一步');

    await week.getByTestId('wp-part-q').click();
    await week.getByTestId('wp-next').click();
    await expect(week).toHaveAttribute('data-stage', 'answer');
    await week.getByTestId('wp-answer-input').fill('14');
    await week.getByTestId('wp-check').click();
    await expect(week.getByTestId('wp-check-feedback')).toHaveText(
      '答对了！',
    );
  });

  test('旧 clueOpen 草稿不会恢复任何提示框或提示开关', async ({ page }) => {
    const weekCard = page.getByTestId('preview-card-example-week');
    await expect(weekCard).toBeVisible();
    const draftKey = wordProblemDraftKey('example-week');
    const fingerprint = wordProblemFingerprint(exampleWeekPrompt().story);
    const writeDraft = (draft: Record<string, unknown>) =>
      page.evaluate(
        ({ key, value }) => window.sessionStorage.setItem(key, value),
        { key: draftKey, value: JSON.stringify(draft) },
      );

    // 旧草稿停在条件阶段，但带 clueOpen:true；其余字段应正常恢复。
    await writeDraft({
      version: 1,
      fingerprint,
      stage: 'conditions',
      conditionsVerified: false,
      questionVerified: false,
      selectedConditions: ['c1'],
      selectedQuestions: [],
      hiddenInput: '',
      clueOpen: true,
    });
    await page.reload();
    const restored = previewFlow(page, 'preview-card-example-week');
    await expect(restored).toHaveAttribute('data-stage', 'conditions');
    await expect(restored.getByTestId('wp-part-c1')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.wp-clue-hint')).toHaveCount(0);
    await expect(page.locator('.wp-clue-toggle')).toHaveCount(0);
    const clue = restored.getByTestId('wp-part-clue-1');
    expect(await clue.getAttribute('aria-expanded')).toBeNull();
    expect(await clue.getAttribute('aria-label')).toBeNull();
    await expect(restored.getByTestId('wp-feedback')).toHaveCount(0);

    // 旧草稿停在隐藏条件步骤且 clueOpen:true：同样不出现任何提示。
    await writeDraft({
      version: 1,
      fingerprint,
      stage: 'hidden',
      conditionsVerified: true,
      questionVerified: false,
      selectedConditions: ['c1'],
      selectedQuestions: [],
      hiddenInput: '',
      clueOpen: true,
    });
    await page.reload();
    const hiddenRestored = previewFlow(page, 'preview-card-example-week');
    await expect(hiddenRestored).toHaveAttribute('data-stage', 'hidden');
    await expect(hiddenRestored.getByTestId('wp-hidden-input')).toBeVisible();
    await expect(hiddenRestored.getByTestId('wp-feedback')).toHaveCount(0);
    await expect(page.locator('.wp-clue-hint')).toHaveCount(0);
    await expect(page.locator('.wp-clue-toggle')).toHaveCount(0);
    await expect(page.locator('[aria-label*="提示"]')).toHaveCount(0);
    await expect(hiddenRestored.locator('.wp-instruction')).toHaveText(
      '你还想到了什么条件？',
    );
  });

  test('正式答题页不展示旧题库里的具体隐藏条件提示，中性走完 4 步', async ({
    page,
  }) => {
    const basePrompt = exampleWeekPrompt();
    // 模拟旧数据库里的 promptData：hiddenCondition 带具体提示文案。
    const prompt: WordProblemV2Prompt = {
      ...basePrompt,
      hiddenCondition: {
        kind: 'weekDays',
        label: '题目里没有直接说一个星期有几天，请用数字和天写清楚：',
        placeholder: '例如7天',
      },
    };
    const question: RoundQuestion = {
      id: 'practice-week-old-hint',
      position: 1,
      level: 'mixedWordProblem',
      expression: prompt.story,
      answer: '',
      clientVersion: 1,
      promptData: prompt,
    };
    const round: Round = {
      id: '44444444-4444-4444-4444-444444444444',
      mode: 'practice',
      status: 'started',
      source: 'custom',
      packageName: '旧隐藏提示兼容',
      counts: { ...emptyCounts, mixedWordProblem: 1 },
      totalCount: 1,
      startedAt: new Date().toISOString(),
      completedAt: null,
      challengerChain: false,
      questions: [question],
    };
    const saves: SaveItem[] = [];
    await mockChildApi(page, round, saves);

    await page.goto('/#practice');
    const flow = page.locator('[data-unit="0"]').getByTestId('word-problem');
    await expect(flow).toHaveAttribute('data-stage', 'conditions');
    await expect(flow.getByTestId('wp-stage-label')).toHaveText(
      '第 1 步 / 共 4 步：找已知条件',
    );
    await expect(flow.getByTestId('wp-next')).toHaveText('下一步');
    await flow.getByTestId('wp-part-c1').click();
    await flow.getByTestId('wp-next').click();
    await expect(flow).toHaveAttribute('data-stage', 'hidden');

    // 中性提问，且 label/instruction 区域不包含旧提示里的具体说法。
    const instruction = flow.locator('.wp-instruction');
    await expect(instruction).toHaveText('你还想到了什么条件？');
    const hiddenLabel = flow.locator('label.wp-hidden');
    await expect(hiddenLabel).toContainText('把你想到的写下来。');
    const neutralText = (
      (await instruction.innerText()) + (await hiddenLabel.innerText())
    ).replace(/\s+/g, '');
    for (const fragment of ['一个星期', '几天', '数字', '天', '7'])
      expect(neutralText).not.toContain(fragment);
    const hiddenInput = flow.getByTestId('wp-hidden-input');
    await expect(hiddenInput).toHaveAttribute('placeholder', '写一写');
    await expect(hiddenInput).toHaveAttribute('aria-label', '你想到的条件');
    await expect(flow.locator('.wp-clue-hint')).toHaveCount(0);
    await expect(flow.locator('.wp-clue-toggle')).toHaveCount(0);
    const clue = flow.getByTestId('wp-part-clue-1');
    expect(await clue.getAttribute('aria-expanded')).toBeNull();
    expect(await clue.getAttribute('aria-label')).toBeNull();

    // 隐藏条件通过后进入问题阶段，不出现成功话术。
    await hiddenInput.fill('一星期有7天');
    await flow.getByTestId('wp-next').click();
    await expect(flow).toHaveAttribute('data-stage', 'question');
    await expect(flow.getByTestId('wp-feedback')).toHaveCount(0);
    await expect(flow.getByTestId('wp-hidden-confirmed')).toContainText(
      '一星期有7天',
    );

    await flow.getByTestId('wp-part-q').click();
    await flow.getByTestId('wp-next').click();
    await expect(flow).toHaveAttribute('data-stage', 'answer');
    await flow.getByTestId('wp-answer-input').fill('14');
    await expect
      .poll(() =>
        saves.some(
          (item) =>
            item.questionId === question.id && item.answer === '14',
        ),
      )
      .toBe(true);
    // 正式答题页的最终答案由外层「检查答案」交给服务端检查（组件只在
    // 开发预览页显示 wp-check），这里断言服务端返回正确后的既有文案。
    await page.getByRole('button', { name: '检查答案' }).click();
    await expect(
      page.locator('[data-unit="0"] .practice-feedback output'),
    ).toHaveText('答对了，继续前进！');
  });
});

import { expect, test, type Page } from '@playwright/test';

const user = {
  id: 'child',
  username: 'demo',
  displayName: '测试孩子',
  role: 'child',
  mustChangePassword: false,
};
const questions = [
  {
    id: 'q1',
    position: 1,
    level: 'starter',
    expression: '1 + 1',
    answer: '',
    clientVersion: 0,
    promptData: {},
  },
  {
    id: 'q2',
    position: 2,
    level: 'starter',
    expression: '2 + 2',
    answer: '',
    clientVersion: 0,
    promptData: {},
  },
];
const round = {
  id: 'round-1',
  status: 'started',
  source: 'custom',
  packageName: '测试练习',
  counts: { starter: 2 },
  totalCount: 2,
  startedAt: new Date().toISOString(),
  completedAt: null,
  questions,
};
type Answer = { questionId: string; answer: string; clientVersion: number };

async function mockApi(
  page: Page,
  options: {
    conflict?: boolean;
    abandonFails?: boolean;
    answered?: boolean;
    refreshFails?: boolean;
    saveGate?: Promise<void>;
  } = {},
) {
  const saved: Answer[][] = [];
  const order: string[] = [];
  const errors: string[] = [];
  let conflict = options.conflict;
  let recordReads = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => void dialog.accept());
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.slice(5);
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    if (path === 'auth/me') return json({ user });
    if (path === 'rounds/active')
      return json({
        round: options.answered
          ? {
              ...round,
              questions: questions.map((q, index) => ({
                ...q,
                answer: String((index + 1) * 2),
                clientVersion: 1,
              })),
            }
          : round,
      });
    if (path === 'records') {
      recordReads++;
      if (options.refreshFails && recordReads === 2)
        return json({ error: '记录暂时无法加载' }, 500);
      return json({ records: [] });
    }
    if (path === 'wrong-book') return json({ wrongQuestions: [] });
    if (path.endsWith('/answers')) {
      const answers = (route.request().postDataJSON() as { answers: Answer[] })
        .answers;
      order.push('save');
      saved.push(answers);
      await options.saveGate;
      if (conflict) {
        conflict = false;
        return json(
          {
            error: '版本冲突',
            code: 'ANSWER_VERSION_STALE',
            questionId: 'q1',
            answerText: '2',
            clientVersion: 2,
          },
          409,
        );
      }
      return json({
        saved: answers.map((a) => ({
          questionId: a.questionId,
          answerText: a.answer,
          clientVersion: a.clientVersion,
        })),
      });
    }
    if (path.endsWith('/abandon'))
      return json(
        options.abandonFails ? { error: '放弃失败，请重试' } : { ok: true },
        options.abandonFails ? 500 : 200,
      );
    if (path === 'auth/logout') {
      order.push('logout');
      return json({ ok: true });
    }
    if (path.endsWith('/submit'))
      return json({
        result: {
          id: round.id,
          score: 100,
          total_count: 2,
          correct_count: 2,
          duration_seconds: 5,
          completed_at: new Date().toISOString(),
        },
        round: {
          ...round,
          status: 'completed',
          questions: questions.map((q, index) => ({
            ...q,
            answer: String((index + 1) * 2),
            isCorrect: true,
            correctAnswer: (index + 1) * 2,
          })),
        },
      });
    return json({ error: 'Unexpected test API' }, 404);
  });
  await page.goto('/');
  await expect(page.getByLabel('第 1 题答案')).toBeVisible();
  return { saved, order, errors };
}

test('accepting one conflicting server answer still saves all other pending answers', async ({
  page,
}) => {
  const state = await mockApi(page, { conflict: true });
  await page.getByLabel('第 1 题答案').fill('9');
  await page.getByLabel('第 2 题答案').fill('4');
  await expect(page.getByText('答案已保存', { exact: true })).toBeVisible();
  await expect(page.getByLabel('第 1 题答案')).toHaveValue('2');
  expect(state.saved).toHaveLength(2);
  expect(state.saved[1]).toEqual([
    { questionId: 'q2', answer: '4', clientVersion: 1 },
  ]);
  expect(state.errors).toEqual([]);
});

test('a failed abandon keeps answer editing and persistence working', async ({
  page,
}) => {
  const state = await mockApi(page, { abandonFails: true });
  await page.getByLabel('第 1 题答案').fill('8');
  await page.getByRole('button', { name: '退出本轮' }).click();
  await expect(page.getByText('放弃失败，请重试').first()).toBeVisible();
  await page.getByLabel('第 1 题答案').fill('7');
  await expect(page.getByText('答案已保存', { exact: true })).toBeVisible();
  expect(state.saved.at(-1)?.find((a) => a.questionId === 'q1')?.answer).toBe(
    '7',
  );
  expect(state.errors).toEqual([]);
});

test('logout flushes edits made inside the debounce window before ending the session', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.getByLabel('第 1 题答案').fill('2');
  await page.getByTitle('退出登录').click();
  await expect.poll(() => state.order).toEqual(['save', 'logout']);
  await expect(page.getByLabel('第 1 题答案')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('logout locks submission, abandonment and repeated logout until pending saves complete', async ({
  page,
}) => {
  let release = () => {};
  const saveGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = await mockApi(page, { saveGate });
  await page.getByLabel('第 1 题答案').fill('2');
  await page.getByLabel('第 2 题答案').fill('4');
  await page.getByTitle('退出登录').click();
  try {
    await expect.poll(() => state.order).toEqual(['save']);
    await expect(
      page.getByRole('button', { name: '提交并查看成绩' }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: '退出本轮' })).toBeDisabled();
    await expect(page.getByTitle('退出登录')).toBeDisabled();
  } finally {
    release();
  }
  await expect.poll(() => state.order).toEqual(['save', 'logout']);
  expect(state.errors).toEqual([]);
});

test('refresh failure preserves submitted results and offers a working retry', async ({
  page,
}) => {
  const state = await mockApi(page, { answered: true, refreshFails: true });
  await page.getByRole('button', { name: '提交并查看成绩' }).click();
  await expect(page.getByText('满分！你是口算小冠军！')).toBeVisible();
  const retry = page.getByRole('button', { name: '重试刷新记录与错题本' });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(page.getByText('满分！你是口算小冠军！')).toBeVisible();
  expect(state.errors).toEqual([]);
});

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * 回归测试：Vercel 生产日志报
 * `ERR_MODULE_NOT_FOUND Cannot find module /var/task/lib/word-problems
 * imported from /var/task/lib/questions.js`。
 *
 * 现有 Vitest 测试由 Vite 解析器加载模块，会自动补全相对导入后缀，因此抓不到
 * 这个只在原生 Node ESM 下出现的错误。这里用已安装的 TypeScript 把
 * questions.ts 与 word-problems.ts 转译成独立 ESM（保留源码里的实际 import
 * 字符串），再交给真实 Node 子进程加载并调用生成器，同时验证修复前的无后缀
 * 写法仍会失败。
 */

const libDir = path.dirname(fileURLToPath(import.meta.url));
const IMPORT_SPECIFIER = /from\s+(["'])\.\/word-problems\.js\1/;

// 只做单文件转译，最接近线上“源码同构 import、由构建/Node 解析路径”的行为。
const RUNNER_SOURCE = `import { makeQuestionsForCounts } from './questions.js';

const counts = {
  starter: 0,
  explorer: 0,
  challenger: 0,
  multiplyMeaning: 0,
  multiplyFacts: 0,
  multiplyMixed: 0,
  divisionMeaning: 0,
  divisionFacts: 0,
  mixedWordProblem: 3,
  abacusMove: 0,
  abacusMatch: 0,
  abacusCalculation: 0,
};

const wordProblems = makeQuestionsForCounts(20261020, counts).filter(
  (question) => question.level === 'mixedWordProblem',
);

process.stdout.write(
  JSON.stringify(
    wordProblems.map((question) => ({
      id: question.id,
      story: question.expression,
      answer: question.answer,
      promptVersion: question.promptData?.version,
      partCount: question.promptData?.parts?.length ?? 0,
    })),
  ),
);
`;

type GeneratedProblem = {
  id: string;
  story: string;
  answer: number;
  promptVersion: number;
  partCount: number;
};

async function transpileToEsm(fileName: string) {
  const filePath = path.join(libDir, fileName);
  const source = await readFile(filePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });
  return outputText;
}

async function writeRuntimeDir(
  dir: string,
  files: Record<string, string>,
) {
  await mkdir(dir, { recursive: true });
  // 让编译产物的 .js 被 Node 当作 ES Module。
  await writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(dir, 'runner.mjs'), RUNNER_SOURCE);
  for (const [fileName, contents] of Object.entries(files)) {
    await writeFile(path.join(dir, fileName), contents);
  }
}

function runNode(dir: string) {
  return spawnSync(process.execPath, ['runner.mjs'], {
    cwd: dir,
    encoding: 'utf8',
  });
}

describe('questions 运行时导入', () => {
  it('真实 Node ESM 能通过编译产物的 .js 导入加载并生成应用题', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'questions-runtime-'));
    try {
      const wordProblemsJs = await transpileToEsm('word-problems.ts');
      const questionsJs = await transpileToEsm('questions.ts');
      // 编译产物必须保留显式 .js 后缀，即 Vercel 上缺失时启动失败的那条导入。
      expect(questionsJs).toMatch(IMPORT_SPECIFIER);

      const fixedDir = path.join(root, 'fixed');
      await writeRuntimeDir(fixedDir, {
        'word-problems.js': wordProblemsJs,
        'questions.js': questionsJs,
      });

      const fixedRun = runNode(fixedDir);
      expect(fixedRun.status, fixedRun.stderr).toBe(0);
      const generated = JSON.parse(fixedRun.stdout) as GeneratedProblem[];
      expect(generated).toHaveLength(3);
      for (const problem of generated) {
        expect(problem.promptVersion).toBe(2);
        expect(problem.story.length).toBeGreaterThan(0);
        expect(problem.answer).toBeGreaterThan(0);
        expect(problem.partCount).toBeGreaterThan(0);
      }

      // 回归证明：把同一份产物改回修复前的无后缀写法，真实 Node 必须报
      // ERR_MODULE_NOT_FOUND，否则这个测试就抓不住本次生产故障。
      const regressionQuestionsJs = questionsJs.replace(
        IMPORT_SPECIFIER,
        "from './word-problems'",
      );
      expect(regressionQuestionsJs).not.toBe(questionsJs);

      const regressionDir = path.join(root, 'regression');
      await writeRuntimeDir(regressionDir, {
        'word-problems.js': wordProblemsJs,
        'questions.js': regressionQuestionsJs,
      });

      const regressionRun = runNode(regressionDir);
      expect(
        regressionRun.status,
        `${regressionRun.stdout}${regressionRun.stderr}`,
      ).not.toBe(0);
      expect(`${regressionRun.stdout}${regressionRun.stderr}`).toContain(
        'ERR_MODULE_NOT_FOUND',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

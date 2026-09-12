import { it, vi } from 'vitest';
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { createIsolatedDatabase, seedTestFamily } from './test-support';
import { hashPassword } from './auth';
import { handleApi } from './router';
const state = vi.hoisted(() => ({
  sql: undefined as NeonQueryFunction<false, false> | undefined,
}));
vi.mock('./db.js', () => ({
  db: () => {
    if (!state.sql) throw new Error('Test database not ready');
    return state.sql;
  },
}));

// Opt-in, local-only browser harness. It never reads or mutates production application tables.
it.skipIf(process.env.BROWSER_QA !== '1')(
  'serves the built app against an isolated PostgreSQL schema',
  async () => {
    const isolated = await createIsolatedDatabase();
    state.sql = isolated.sql;
    const family = await seedTestFamily(
      state.sql,
      await hashPassword('Browser-test-only-2026!'),
    );
    await state.sql`UPDATE kousuan.users SET username='qa_parent', display_name='小宇的家长' WHERE id=${family.parent.id}`;
    await state.sql`UPDATE kousuan.users SET username='qa_child', display_name='小宇' WHERE id=${family.child.id}`;
    await state.sql`UPDATE kousuan.users SET display_name='一个较长的孩子昵称', must_change_password=true WHERE id=${family.sibling.id}`;
    await state.sql`INSERT INTO kousuan.wrong_question_stats(user_id,expression,correct_answer,level,last_answer,question_key) VALUES(${family.child.id},'8 + 7',15,'explorer','14','qa-seed')`;
    const root = resolve('vercel-dist');
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost:4180');
        if (url.pathname.startsWith('/api/')) {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const input = Object.assign(req, {
            query: { path: url.pathname.slice(5) },
            body: chunks.length
              ? JSON.parse(Buffer.concat(chunks).toString())
              : undefined,
          }) as unknown as VercelRequest;
          const output = Object.assign(res, {
            status(code: number) {
              res.statusCode = code;
              return output;
            },
            json(body: unknown) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(body));
              return output;
            },
          }) as unknown as VercelResponse;
          await handleApi(input, output);
          return;
        }
        const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (path !== root && !path.startsWith(`${root}${sep}`)) {
          res.writeHead(403).end();
          return;
        }
        const target = extname(path) ? path : resolve(root, 'index.html');
        const types: Record<string, string> = {
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.html': 'text/html',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.woff2': 'font/woff2',
        };
        res.setHeader(
          'Content-Type',
          types[extname(target)] ?? 'application/octet-stream',
        );
        res.end(await readFile(target));
      } catch {
        res.writeHead(500).end('Local QA request failed');
      }
    });
    try {
      await new Promise<void>((done) => server.listen(4180, '127.0.0.1', done));
      console.log(
        'Browser QA ready at http://localhost:4180 (qa_parent / qa_child)',
      );
      const deadline = Date.now() + 1_800_000;
      while (Date.now() < deadline) {
        try {
          await access('/tmp/math-adventure-qa-done');
          break;
        } catch {
          await new Promise((done) => setTimeout(done, 1000));
        }
      }
    } finally {
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      await isolated.cleanup();
    }
  },
  1_860_000,
);

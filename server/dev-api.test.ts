import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDevApiMiddleware } from './dev-api';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function serve(handler?: Parameters<typeof createDevApiMiddleware>[0]) {
  const middleware = createDevApiMiddleware(handler);
  const server = createServer((req, res) => {
    void middleware(req, res, () => {
      res.statusCode = 404;
      res.end('page');
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test port');
  return `http://127.0.0.1:${address.port}`;
}

describe('local API adapter', () => {
  it('serves the real auth/me endpoint without a database for anonymous visitors', async () => {
    const base = await serve();
    const response = await fetch(`${base}/api/auth/me`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ user: null });
    expect((await fetch(`${base}/other`)).status).toBe(404);
  });

  it('passes JSON, path, cookies and response cookies through', async () => {
    const handler = vi.fn(async (req, res) => {
      expect(req.query.path).toBe('rounds/abc/answers');
      expect(req.body).toEqual({ answers: [] });
      expect(req.headers.cookie).toBe('example=test');
      res.status(201).setHeader('Set-Cookie', 'example=updated; HttpOnly');
      res.json({ ok: true });
    }) as Parameters<typeof createDevApiMiddleware>[0];
    const base = await serve(handler);
    const response = await fetch(`${base}/api/rounds/abc/answers`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: 'example=test' },
      body: JSON.stringify({ answers: [] }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('example=updated');
  });

  it('rejects malformed and oversized JSON before invoking the handler', async () => {
    const handler = vi.fn();
    const base = await serve(handler);
    for (const [body, status] of [
      ['{', 400],
      [JSON.stringify('x'.repeat(65_536)), 413],
    ] as const) {
      const response = await fetch(`${base}/api/rounds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toHaveProperty('error');
    }
    expect(handler).not.toHaveBeenCalled();
  });
});

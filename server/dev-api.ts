import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleApi } from './router';

const MAX_BODY_BYTES = 64 * 1024;

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size <= MAX_BODY_BYTES) chunks.push(buffer);
  }
  if (size > MAX_BODY_BYTES)
    throw Object.assign(new Error('请求内容过大'), { statusCode: 413 });
  if (!size) return undefined;
  if (
    !req.headers['content-type']?.toLowerCase().startsWith('application/json')
  )
    throw Object.assign(new Error('请使用 JSON 请求'), { statusCode: 415 });
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw Object.assign(new Error('请求内容不是有效 JSON'), {
      statusCode: 400,
    });
  }
}

/** Adapt the local Node server to the same handler used by Vercel. */
export function createDevApiMiddleware(handler: typeof handleApi = handleApi) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/'))
      return next();
    const response = Object.assign(res, {
      status(code: number) {
        res.statusCode = code;
        return response;
      },
      json(value: unknown) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(value));
        return response;
      },
    });
    try {
      const query: Record<string, string | string[]> = {};
      for (const key of new Set(url.searchParams.keys())) {
        const values = url.searchParams.getAll(key);
        query[key] = values.length === 1 ? values[0] : values;
      }
      if (url.pathname !== '/api')
        query.path = url.pathname.slice('/api/'.length);
      const request = Object.assign(req, { query, body: await readBody(req) });
      await handler(request as VercelRequest, response as VercelResponse);
    } catch (error) {
      if (res.writableEnded) return;
      const status = Number(
        (error as { statusCode?: number }).statusCode ?? 500,
      );
      if (status >= 500) console.error('Local API request failed', error);
      response.status(status).setHeader('Cache-Control', 'no-store');
      response.json({
        error: status >= 500 ? '服务暂时不可用' : (error as Error).message,
      });
    }
  };
}

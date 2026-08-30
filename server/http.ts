import type { VercelRequest, VercelResponse } from '@vercel/node';

export function send(res: VercelResponse, status: number, data: unknown) {
  res.status(status).setHeader('Cache-Control', 'no-store').json(data);
}

export function method(req: VercelRequest, expected: string) {
  if (req.method !== expected) throw Object.assign(new Error('请求方法不支持'), { statusCode: 405 });
}

export function body<T = Record<string, unknown>>(req: VercelRequest): T {
  if (!req.body || typeof req.body !== 'object') throw Object.assign(new Error('请求内容无效'), { statusCode: 400 });
  return req.body as T;
}

export function routePath(req: VercelRequest) {
  if (typeof req.query.path === 'string') return req.query.path.replace(/^\//, '').replace(/\/$/, '');
  return new URL(req.url ?? '/', 'https://local.invalid').pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
}

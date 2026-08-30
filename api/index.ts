import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleApi } from '../server/router.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  return handleApi(req, res);
}

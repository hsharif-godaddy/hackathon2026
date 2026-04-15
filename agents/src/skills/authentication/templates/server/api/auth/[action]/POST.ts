import type { Request, Response } from 'express';
import { authHandler } from '@/server/auth-middleware';

export default async function handler(req: Request, res: Response) {
  await authHandler(req, res);
}

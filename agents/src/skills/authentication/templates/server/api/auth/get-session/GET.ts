/**
 * Get Session API Handler
 */

import type { Request, Response } from 'express';

import { auth } from '@/lib/auth/auth';
import { toWebRequest, sendWebResponse } from '@/lib/auth/express-adapter';

export default async function handler(req: Request, res: Response) {
  try {
    const webResponse = await auth.handler(toWebRequest(req));
    await sendWebResponse(webResponse, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(JSON.stringify({ event: 'auth.session.failure', error: message }));
    res.status(500).json({ error: 'Get session failed' });
  }
}

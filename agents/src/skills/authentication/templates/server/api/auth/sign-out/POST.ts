/**
 * Sign Out API Handler
 */

import type { Request, Response } from 'express';

import { auth } from '@/lib/auth/auth';
import { toWebRequest, sendWebResponse } from '@/lib/auth/express-adapter';

export default async function handler(req: Request, res: Response) {
  console.log(JSON.stringify({ event: 'auth.sign-out.begin' }));

  try {
    const webResponse = await auth.handler(toWebRequest(req));
    await sendWebResponse(webResponse, res);

    if (webResponse.ok) {
      console.log(JSON.stringify({ event: 'auth.sign-out.success' }));
    } else {
      console.log(JSON.stringify({ event: 'auth.sign-out.failure', status: webResponse.status }));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(JSON.stringify({ event: 'auth.sign-out.failure', error: message }));
    res.status(500).json({ error: 'Sign out failed' });
  }
}

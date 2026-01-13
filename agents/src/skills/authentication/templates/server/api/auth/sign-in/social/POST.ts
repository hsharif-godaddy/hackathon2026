/**
 * Social Sign-In Handler
 */

import type { Request, Response } from 'express';

import { auth } from '@/lib/auth/auth';
import { toWebRequest, sendWebResponse } from '@/lib/auth/express-adapter';

export default async function handler(req: Request, res: Response) {
  const provider = req.body?.provider;
  console.log(JSON.stringify({ event: 'auth.sign-in.begin', method: 'social', provider }));

  try {
    const webResponse = await auth.handler(toWebRequest(req));
    await sendWebResponse(webResponse, res);

    if (webResponse.ok || webResponse.status === 302) {
      console.log(JSON.stringify({ event: 'auth.sign-in.success', method: 'social', provider }));
    } else {
      console.log(JSON.stringify({ event: 'auth.sign-in.failure', method: 'social', provider, status: webResponse.status }));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(JSON.stringify({ event: 'auth.sign-in.failure', method: 'social', provider, error: message }));
    res.status(500).json({ error: 'Social sign in failed' });
  }
}

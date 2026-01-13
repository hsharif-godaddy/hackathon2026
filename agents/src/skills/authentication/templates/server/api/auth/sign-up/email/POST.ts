/**
 * Email Sign-Up Handler
 */

import type { Request, Response } from 'express';

import { auth } from '@/lib/auth/auth';
import { toWebRequest, sendWebResponse } from '@/lib/auth/express-adapter';

export default async function handler(req: Request, res: Response) {
  const email = req.body?.email;
  console.log(JSON.stringify({ event: 'auth.sign-up.begin', method: 'email', email }));

  try {
    const webResponse = await auth.handler(toWebRequest(req));
    await sendWebResponse(webResponse, res);

    if (webResponse.ok) {
      console.log(JSON.stringify({ event: 'auth.sign-up.success', method: 'email', email }));
    } else {
      console.log(JSON.stringify({ event: 'auth.sign-up.failure', method: 'email', email, status: webResponse.status }));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(JSON.stringify({ event: 'auth.sign-up.failure', method: 'email', email, error: message }));
    res.status(500).json({ error: 'Sign up failed' });
  }
}

/**
 * OAuth Callback Handler (Generic for any provider)
 */

import type { Request, Response } from 'express';

import { auth } from '@/lib/auth/auth';
import { toWebRequest, sendWebResponse } from '@/lib/auth/express-adapter';

export default async function handler(req: Request, res: Response) {
  const provider = req.params.provider;
  console.log(JSON.stringify({ event: 'auth.oauth-callback.begin', provider }));

  try {
    const webResponse = await auth.handler(toWebRequest(req));
    await sendWebResponse(webResponse, res);

    if (webResponse.ok || webResponse.status === 302) {
      console.log(JSON.stringify({ event: 'auth.oauth-callback.success', provider }));
    } else {
      console.log(JSON.stringify({ event: 'auth.oauth-callback.failure', provider, status: webResponse.status }));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(JSON.stringify({ event: 'auth.oauth-callback.failure', provider, error: message }));
    res.status(500).json({ error: `OAuth callback failed for ${provider}` });
  }
}

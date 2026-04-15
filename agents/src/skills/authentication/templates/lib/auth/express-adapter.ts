/**
 * Express to Web API adapter for BetterAuth
 * Converts Express req/res to Web API Request/Response
 */

import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

/**
 * Convert Express request to Web API Request
 */
export function toWebRequest(req: ExpressRequest): Request {
  // Use actual protocol — hardcoding https breaks BetterAuth's CSRF origin
  // check in local dev (HTTP), causing sign-up/sign-in to silently fail.
  const rawProto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const protocol = rawProto.split(',')[0].trim();
  const host = req.get('host') || 'localhost';
  const url = `${protocol}://${host}${req.originalUrl}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      // Skip content-length — the body is re-serialized below and the
      // original length may no longer match. Let the Request constructor
      // derive it from the actual body.
      if (key.toLowerCase() === 'content-length') continue;
      if (Array.isArray(value)) {
        value.forEach((v) => headers.append(key, v));
      } else {
        headers.set(key, value);
      }
    }
  }

  const init: RequestInit = {
    method: req.method,
    headers,
  };

  // Add body for non-GET requests
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body) {
      init.body = JSON.stringify(req.body);
      headers.set('content-type', 'application/json');
    }
  }

  return new Request(url, init);
}

/**
 * Send Web API Response through Express response
 */
export async function sendWebResponse(webResponse: Response, res: ExpressResponse): Promise<void> {
  // Set status
  res.status(webResponse.status);

  // Copy headers — handle Set-Cookie separately since Headers.forEach()
  // joins multiple Set-Cookie values into one string, corrupting them.
  // Use getSetCookie() to preserve each cookie as a distinct header.
  const setCookieHeaders = webResponse.headers.getSetCookie();
  if (setCookieHeaders.length > 0) {
    res.setHeader('set-cookie', setCookieHeaders);
  }
  webResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') {
      res.setHeader(key, value);
    }
  });

  // Send body
  const body = await webResponse.text();
  if (body) {
    res.send(body);
  } else {
    res.end();
  }
}


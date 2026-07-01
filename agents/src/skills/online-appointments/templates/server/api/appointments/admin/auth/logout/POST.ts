import type { Request, Response } from "express";
import { destroySession } from "../session-store";
import { sessionStore, clearSessionCookie, getSessionToken } from "../../../../../auth/index";

export default async function handler(req: Request, res: Response) {
  // Clear legacy Bearer session
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (bearerToken) destroySession(bearerToken);

  // Clear cookie-based session
  const cookieToken = getSessionToken(req);
  if (cookieToken)
    await sessionStore.destroy(cookieToken).catch(() => {
      /* ignored */
    });
  clearSessionCookie(res);

  return res.json({ ok: true });
}

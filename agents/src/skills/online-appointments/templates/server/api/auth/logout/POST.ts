import type { Request, Response } from "express";
import { getSessionToken, sessionStore, clearSessionCookie } from "../../../auth/index";

export default async function handler(req: Request, res: Response) {
  const token = getSessionToken(req);
  if (token) await sessionStore.destroy(token);
  clearSessionCookie(res);
  return res.json({ ok: true });
}

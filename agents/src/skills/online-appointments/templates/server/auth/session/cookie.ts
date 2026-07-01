import type { Request, Response } from "express";

export const COOKIE_NAME = "ola_session";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  // secure: true in production — set via HTTPS env check
  secure: process.env.NODE_ENV === "production",
  maxAge: 8 * 60 * 60 * 1000, // 8 hours in ms
};

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
}

export function getSessionToken(req: Request): string | undefined {
  return (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME];
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

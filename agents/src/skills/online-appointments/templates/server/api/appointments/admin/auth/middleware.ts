import type { Request, Response, NextFunction } from "express";
import { validateSession } from "./session-store";
import { isAdmin } from "../../../appointments/shared/auth";

/**
 * requireAdmin — accepts either:
 *   1. Cookie session with role "admin" (set by the unified auth layer)
 *   2. Authorization: Bearer <legacy-token> (admin panel localStorage flow)
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // 1. Unified cookie session populated by sessionMiddleware
  if (isAdmin(req)) return next();

  // 2. Legacy Bearer token (admin panel that still uses localStorage)
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (token && validateSession(token)) return next();

  return res.status(401).json({ error: "Unauthorized" });
}

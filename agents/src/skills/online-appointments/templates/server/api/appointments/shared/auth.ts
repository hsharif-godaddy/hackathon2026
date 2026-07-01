// ---------------------------------------------------------------------------
// Shared auth utilities for appointment endpoints
//
// Every namespace (public/, admin/, customer/, staff/) uses these helpers.
// They are provider-agnostic: they read the resolved AuthUser from
// req.authUser (populated by the session middleware in entry.ts) without
// knowing which provider produced it.
//
// Usage:
//   import { requireAuth, requireRole, getUser, isAdmin } from "../shared/auth";
//
//   // As Express middleware:
//   app.get("/api/appointments/admin/...", requireRole("admin"), handler);
//
//   // Inside a handler:
//   const user = getUser(req);     // AuthUser | null
//   if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden" });
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from "express";
import type { AuthUser, Role } from "../../../auth/index";
import { getSessionToken, sessionStore } from "../../../auth/index";

// ── Augment Express Request ──────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

// ── Core helpers ─────────────────────────────────────────────────────────────

/** Returns the authenticated user, or null if the request is unauthenticated. */
export function getUser(req: Request): AuthUser | null {
  return req.authUser ?? null;
}

/** Returns true when the request carries a valid session. */
export function isLoggedIn(req: Request): boolean {
  return req.authUser !== undefined;
}

/** Returns true when the authenticated user has the "admin" role. */
export function isAdmin(req: Request): boolean {
  return req.authUser?.roles.includes("admin") ?? false;
}

/** Returns true when the authenticated user has the "staff" role. */
export function isStaff(req: Request): boolean {
  return req.authUser?.roles.includes("staff") ?? false;
}

/** Returns true when the authenticated user has the "customer" role. */
export function isCustomer(req: Request): boolean {
  return req.authUser?.roles.includes("customer") ?? false;
}

/** Returns true when the user owns the given client identity. */
export function ownsClient(req: Request, clientId: string): boolean {
  return req.authUser?.identityType === "Client" && req.authUser.identityId === clientId;
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Populates req.authUser from the session cookie or Authorization header.
 * Always calls next() — it never rejects. Use requireAuth / requireRole to
 * enforce access.
 *
 * Register this ONCE in entry.ts before all routes so every handler can
 * safely call getUser(req) without additional setup.
 */
export async function sessionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // 1. Cookie session (primary — used by customer/staff/admin browser sessions)
    const cookieToken = getSessionToken(req);
    if (cookieToken) {
      const session = await sessionStore.get(cookieToken);
      if (session) {
        req.authUser = session.user;
        return next();
      }
    }

    // 2. Authorization: Bearer <token> header (legacy admin panel / API clients)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const bearerToken = authHeader.slice(7);
      const session = await sessionStore.get(bearerToken);
      if (session) {
        req.authUser = session.user;
        return next();
      }

      // Back-compat: old admin in-memory token (pre-session-store).
      // The admin auth middleware handles this via the legacy session-store.
    }
  } catch {
    // Never block the request on auth resolution errors.
  }
  next();
}

/**
 * Middleware: rejects unauthenticated requests with 401.
 * Compose with requireRole when a specific role is also needed.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

/**
 * Middleware factory: rejects requests where the user does not have at least
 * one of the specified roles.
 *
 *   app.get("/api/appointments/admin/...", requireRole("admin"), handler);
 *   app.get("/api/appointments/staff/...", requireRole("staff", "admin"), handler);
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const hasRole = roles.some((r) => user.roles.includes(r));
    if (!hasRole) {
      res.status(403).json({ error: "Forbidden", required_roles: roles });
      return;
    }
    next();
  };
}

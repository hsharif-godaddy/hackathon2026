import type { Request, Response } from "express";
import { z } from "zod";
import { createSession } from "../session-store";
import { adminAuthRegistry } from "../strategy-registry";
import type { AdminCredentials } from "../strategies/types";
import { sessionStore, setSessionCookie } from "../../../../../auth/index";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export default async function handler(req: Request, res: Response) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const strategy = adminAuthRegistry.getActive();

  const ready = await strategy.isReady();
  if (!ready) {
    return res.status(403).json({ error: "Admin not configured", setup_required: true });
  }

  const identity = await strategy.authenticate((req.body ?? {}) as AdminCredentials);
  if (!identity) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  // Legacy Bearer token for the admin panel's Authorization: Bearer flow
  const legacyToken = createSession();

  // Cookie-based session for the unified auth layer
  const adminUser = {
    id: `Admin:${identity.id}`,
    identityId: identity.id,
    identityType: "Admin" as const,
    roles: ["admin" as const],
    email: parsed.data.email,
    displayName: identity.label,
  };
  const cookieToken = await sessionStore.create(adminUser);
  setSessionCookie(res, cookieToken);

  return res.json({ token: legacyToken, identity });
}

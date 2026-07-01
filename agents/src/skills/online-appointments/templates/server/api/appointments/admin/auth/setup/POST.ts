import type { Request, Response } from "express";
import { createSession } from "../session-store";
import { adminAuthRegistry } from "../strategy-registry";
import type { AdminCredentials } from "../strategies/types";

export default async function handler(req: Request, res: Response) {
  const strategy = adminAuthRegistry.getActive();

  const alreadyReady = await strategy.isReady();
  if (alreadyReady) {
    return res.status(409).json({
      error: "Admin is already configured. Use the login page.",
    });
  }

  const setupError = await strategy.setup((req.body ?? {}) as AdminCredentials);
  if (setupError) {
    return res.status(400).json({ error: setupError.error });
  }

  // Auto-login after successful setup so the user lands on the dashboard.
  const identity = await strategy.authenticate((req.body ?? {}) as AdminCredentials);
  const token = identity ? createSession() : null;

  return res.status(201).json({
    message: "Admin configured successfully.",
    token,
    identity,
  });
}

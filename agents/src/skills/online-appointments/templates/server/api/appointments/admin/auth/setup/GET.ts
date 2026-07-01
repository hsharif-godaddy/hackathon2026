import type { Request, Response } from "express";
import { adminAuthRegistry } from "../strategy-registry";

/** Returns the current setup status and available strategy metadata. */
export default async function handler(_req: Request, res: Response) {
  const strategy = adminAuthRegistry.getActive();

  try {
    const ready = await strategy.isReady();
    return res.json({
      ready,
      strategy: {
        name: strategy.name,
        display_name: strategy.displayName,
        description: strategy.description,
      },
      available_strategies: adminAuthRegistry.list().map((s) => ({
        name: s.name,
        display_name: s.displayName,
        description: s.description,
      })),
    });
  } catch (_error) {
    return res.status(500).json({ error: "Failed to check setup status" });
  }
}

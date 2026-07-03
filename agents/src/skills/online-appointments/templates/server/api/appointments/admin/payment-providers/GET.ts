import type { Request, Response } from "express";
import { db } from "../../../../db/client";
import { paymentProvider } from "../../../../db/schema";
import { PAYMENT_PROVIDERS } from "../../payments/providers";

export default async function handler(_req: Request, res: Response) {
  try {
    const configured = await db.select().from(paymentProvider);
    const configuredMap = new Map(configured.map((p) => [p.provider, p]));

    const providers = Object.values(PAYMENT_PROVIDERS).map((meta) => {
      const row = configuredMap.get(meta.provider);
      return {
        provider: meta.provider,
        displayName: meta.displayName,
        configured: !!row,
        enabled: row?.enabled ?? false,
        id: row?.id ?? null,
      };
    });

    return res.json({ providers });
  } catch (err) {
    console.error("[Payment Providers GET] Failed to fetch providers", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}

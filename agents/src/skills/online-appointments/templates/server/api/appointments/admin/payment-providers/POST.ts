import type { Request, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../../../db/client";
import { paymentProvider } from "../../../../db/schema";
import { PAYMENT_PROVIDERS, type PaymentProviderKey } from "../../payments/providers";
import { generateId } from "../../../../db/uuid";

const providerKeys = Object.keys(PAYMENT_PROVIDERS) as [
  PaymentProviderKey,
  ...PaymentProviderKey[],
];

const schema = z.object({
  provider: z.enum(providerKeys),
});

export default async function handler(req: Request, res: Response) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Validation failed", fields: parsed.error.flatten().fieldErrors });
  }

  const { provider } = parsed.data;

  try {
    const [existing] = await db
      .select()
      .from(paymentProvider)
      .where(eq(paymentProvider.provider, provider))
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: "Provider already configured" });
    }

    const now = new Date();
    await db.insert(paymentProvider).values({
      id: generateId(),
      provider,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[Payment API] Operation failed", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}

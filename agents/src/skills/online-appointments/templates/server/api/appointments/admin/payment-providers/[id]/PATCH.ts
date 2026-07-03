import type { Request, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../../../../db/client";
import { paymentProvider } from "../../../../../db/schema";

const schema = z.object({
  enabled: z.boolean(),
});

export default async function handler(req: Request, res: Response) {
  const id = req.params.id as string;
  if (!id) {
    return res.status(400).json({ error: "Bad Request", message: "Invalid provider ID" });
  }

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Validation failed", fields: parsed.error.flatten().fieldErrors });
  }

  try {
    const [existing] = await db
      .select()
      .from(paymentProvider)
      .where(eq(paymentProvider.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Provider not found" });
    }

    await db
      .update(paymentProvider)
      .set({ enabled: parsed.data.enabled, updatedAt: new Date() })
      .where(eq(paymentProvider.id, id));

    return res.json({ ok: true });
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

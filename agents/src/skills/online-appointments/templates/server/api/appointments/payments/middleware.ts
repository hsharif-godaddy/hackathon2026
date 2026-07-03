import type { RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { paymentProvider } from "../../../db/schema";
import { PAYMENT_PROVIDERS, type PaymentProviderKey } from "./providers";

export function requirePaymentProvider(provider: PaymentProviderKey): RequestHandler {
  return async (_req, res, next) => {
    const [row] = await db
      .select()
      .from(paymentProvider)
      .where(and(eq(paymentProvider.provider, provider), eq(paymentProvider.enabled, true)))
      .limit(1);

    if (!row) {
      res.status(503).json({
        error: `${PAYMENT_PROVIDERS[provider].displayName} payments are not currently enabled`,
      });
      return;
    }

    next();
  };
}

export const PAYMENT_PROVIDERS = {
  stripe: { provider: "stripe", displayName: "Stripe" },
} as const;

export type PaymentProviderKey = keyof typeof PAYMENT_PROVIDERS;

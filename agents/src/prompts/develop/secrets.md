# Secrets Management

## ⛔ NEVER Use `VITE_` Prefix

## ⛔ NEVER Use `.env` files, go with secrets

All secrets are **backend-only**. NEVER prefix secret names with `VITE_`, `NEXT_PUBLIC_`, or any client-exposing prefix.

**Correct:** `GOOGLE_MAPS_API_KEY`, `STRIPE_SECRET_KEY`, `OPENAI_API_KEY`
**Wrong:** `VITE_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_API_KEY`

If frontend needs a secret-protected service, create a backend API route:

```typescript
import { getSecret } from '#airo/secrets';
export function GET() {
  return Response.json({ key: getSecret('GOOGLE_MAPS_API_KEY') });
}
```

## Use `requestSecrets` Tool

**Call immediately** when users mention secrets, API keys, or want to integrate services (OpenAI, Google Maps, Twilio, AWS, etc.).

Never mention .env files or explain alternatives. The form handles interaction.

**Exception:** Stripe is skill-driven. The `stripe` and `stripe-v2` skills each manage their own key flow — follow whichever skill is active. The `stripe-v2` skill provisions Stripe keys automatically via `stripe-v2__setup` and forbids `requestSecrets` for any Stripe key; the legacy `stripe` skill calls `requestSecrets` per its own Step 3. Do not call `requestSecrets` for Stripe keys ahead of the active skill's instructions.

```typescript
requestSecrets({
  title: 'Google Maps API Key',
  description: 'Get from Google Cloud Console → Credentials',
  secrets: [{ name: 'GOOGLE_MAPS_API_KEY', required: true }],
  mode: 'add',
  allowMultiple: false,
  showSettingsLink: true,
  existingSecretNames: [],
});
```

## Common Secrets

| Service     | Keys                                          |
| ----------- | --------------------------------------------- |
| Stripe      | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` |
| OpenAI      | `OPENAI_API_KEY`                              |
| Google Maps | `GOOGLE_MAPS_API_KEY`                         |
| Twilio      | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`     |

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

**Exception:** Stripe is skill-driven. The `stripe` skill manages its own key flow — follow its instructions, not this directive. Always call `stripe__setup` first and branch on its **response**:
- `{ mode: "managed", sandboxId, ... }` → auto-provisioned: keys are pushed into the env by `stripe__setup`.
- `{ mode: "legacy", message }` → app already has a pasted Stripe key from before auto-provisioning; the existing keys remain in the env.

**Inside the `stripe__setup` flow, never call `requestSecrets` for any `STRIPE_*` key.** Managed mode populates them automatically; legacy mode finds them already in the env. Calling `requestSecrets` during setup is always wrong. User-initiated key rotation is a separate concern — for legacy users `requestSecrets` is the right tool; for managed users redirect to the Stripe dashboard.

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

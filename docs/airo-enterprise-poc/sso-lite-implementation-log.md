# SSO Lite Implementation Log - Airo-Enterprise POC

**Author:** Dev Vrat Pathak
**Date:** June 17, 2026
**Feature:** Switch Airo Builder sign-in to SSO Lite (progressive login) For Airo-Enterprise Initiative

---

## Objective

Enable GoDaddy employees to sign in to Airo Builder using their corporate Okta credentials via email-first detection.

---

## Background

For the Enterprise employees, the SSO team provided instructions to switch from the standard SSO page to **SSO Lite** — an email-first progressive sign-in experience. When an employee enters a corporate email (e.g., `xyz@godaddy.com`), the system automatically redirects them to GoDaddy's IdP (Okta). Personal email users continue through the normal password/social flow unchanged.

**SSO team requirements:**
1. Use `/login/progressive` as the SSO page route
2. Set `enableCheckoutLite: true` (Boolean) in the `SsoDeck` props

---

## Decision Points

### Decision 1: Scope of the progressive login route

**Question:** Should `/login/progressive` apply to all auth flows (including HBI 2FA step-up), or only to sign-in/create flows?

**Context:** The existing routing logic handles three cases:
- `/account/create` — new visitors (no returning-user cookie)
- `/login` — returning visitors or session expiry
- `/hbi` — 2FA step-up for sensitive actions (publish, billing) when user is already authenticated

**Decision: Option A — sign-in/create flows only, HBI unchanged.**

**Reasoning:** HBI is not a login flow. It's a security re-verification for already-authenticated users performing sensitive actions. Showing "Enter your email" to someone who is already logged in and just needs to confirm their 2FA would be confusing and potentially weaken the security UX.

---

### Decision 2: Rollout strategy

**Question:** Should this ship directly to all users or be gated behind a feature flag?

**Decision: Feature flag (`appbuilder-sso-lite` via Switchboard).**

**Reasoning:** A gradual rollout provides a kill switch if the new SSO flow causes issues, allows testing with internal users first (shopper ID overrides), and follows the team's existing pattern for UI changes.

---

## Changes Made

### 1. `app/src/config/switchboard-flags.ts`

Added the flag constant:
```ts
export const SWITCHBOARD_APPBUILDER_SSO_LITE = 'appbuilder-sso-lite';
```

### 2. `app/src/lib/ssoPageRoute.ts`

Added a `useSsoLite` parameter to `getSsoPageToLoad`. When `true`, returns `/login/progressive` for all cases except HBI (which always stays at `/hbi`).

**Before:**
```ts
export function getSsoPageToLoad(authReason: number | null, isReturning: boolean): string {
  if (authReason === SsoExpirationCode.HBI) return '/hbi';
  if (authReason === null && !isReturning) return '/account/create';
  return '/login';
}
```

**After:**
```ts
export function getSsoPageToLoad(authReason: number | null, isReturning: boolean, useSsoLite: boolean = false): string {
  if (authReason === SsoExpirationCode.HBI) return '/hbi';
  if (useSsoLite) return '/login/progressive';
  if (authReason === null && !isReturning) return '/account/create';
  return '/login';
}
```

The default parameter (`false`) ensures backward compatibility — all existing call sites and tests work without modification.

### 3. `app/src/components/auth/SsoLogin.tsx`

- Imported `useSwitchboard` hook and `SWITCHBOARD_APPBUILDER_SSO_LITE` constant
- Added `enableCheckoutLite?: boolean` to the local `SsoDeckComponentProps` interface
- Read the flag value: `const ssoLiteEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_SSO_LITE) ?? false`
- Passed flag to routing: `getSsoPageToLoad(authReason, isReturningUser(), ssoLiteEnabled)`
- Conditionally passed `enableCheckoutLite` prop to `SsoDeckDynamic`: `{...(ssoLiteEnabled && { enableCheckoutLite: true })}`

### 4. `app/src/lib/__tests__/ssoPageRoute.test.ts`

Added 4 test cases in a new `describe('SSO Lite (progressive login)')` block:
- New user + SSO Lite → `/login/progressive`
- Returning user + SSO Lite → `/login/progressive`
- Session expiry (LOGIN/VAT) + SSO Lite → `/login/progressive`
- HBI + SSO Lite → still `/hbi` (unchanged)

---

## Verification Results

| Check | Result |
|-------|--------|
| Unit tests (`pnpm --filter website test "ssoPageRoute"`) | 12/12 passing |
| TypeScript (`pnpm --filter website typecheck`) | Clean |
| ESLint (`pnpm --filter website lint`) | Clean |
| Manual test (hardcoded `true`) | SSO Lite email-first page rendered correctly |

---

## Routing Summary (Final State)

| Scenario | Flag OFF (default) | Flag ON |
|----------|-------------------|---------|
| New visitor (no cookie) | `/account/create` | `/login/progressive` |
| Returning visitor | `/login` | `/login/progressive` |
| Session expiry (LOGIN/VAT) | `/login` | `/login/progressive` |
| HBI (2FA step-up) | `/hbi` | `/hbi` |

---

## Deployment Steps

1. Merge PR
2. Register `appbuilder-sso-lite` as a boolean flag (default `false`) in Switchboard:
   - Dev: https://switchboard.int.dev-gdcorp.tools/airo-app-builder
   - Test: https://switchboard.int.test-gdcorp.tools/airo-app-builder
   - Prod: https://switchboard.int.gdcorp.tools/airo-app-builder
3. Gradually increase rollout percentage or flip default to `true` when ready

---

## Rollback

Flip `appbuilder-sso-lite` to `false` in Switchboard. The app reverts to the standard sign-in flow within ~2 minutes (cache refresh interval). No code revert needed.

---

## Notes

- `enableCheckoutLite` is not in the `@sso/deck` TypeScript types (v2.1.4) but is accepted at runtime by the underlying SsoDeck component.
- The `useSwitchboard` hook returns `undefined` when Switchboard is disabled or the flag doesn't exist — the `?? false` coercion ensures graceful fallback to the standard flow.
- Local development with `GASKET_DISABLE_SWITCHBOARD=1` will always use the standard flow unless the flag is hardcoded for testing.

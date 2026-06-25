# SSO Lite (Progressive Login) - Proposal

**Author:** Dev Vrat Pathak
**Date:** June 17, 2026
**Status:** Pending Decision

---

## Summary

The SSO team has provided instructions to switch the Airo Builder sign-in flow from the standard SSO page to **SSO Lite** (email-first progressive sign-in). This enables GoDaddy employees to sign in via Okta using their work email, while preserving the existing experience for external users (shoppers). This document outlines what changes today, the two implementation options, and their tradeoffs.

---

## What Happens Today

When a user clicks **Sign In** in Airo Builder, the app routes them to one of three SSO pages based on context:

| Scenario | Trigger | SSO Page Shown | Experience |
|----------|---------|----------------|------------|
| New visitor (never signed in) | No returning-user cookie | `/account/create` | "Create Account" with Facebook, Google, Email options |
| Returning visitor | Has returning-user cookie | `/login` | Username + Password form with social sign-in buttons |
| Sensitive action (publish, billing, etc.) | Session needs elevated security (`authReason = 2`) | `/hbi` | 2FA step-up challenge (authenticator code) |

**Problem:** There is no mechanism for the SSO system to recognize a corporate email (e.g., `xyz@godaddy.com`) and redirect the employee to GoDaddy's identity provider (Okta). Employees must use shopper credentials or create a personal account to access the builder.

---

## What SSO Lite Enables

SSO Lite replaces the standard sign-in page with an **email-first** flow:

1. User sees "Join or Sign In" with an email field
2. User enters their email and clicks "Continue with Email"
3. **If corporate email** (e.g., `@godaddy.com`) -> automatically redirected to Okta (GoDaddy IdP) -> federated SSO login -> returned to Airo Builder authenticated
4. **If personal email** -> continues with normal password/social flow (no change for shoppers)

This means employees don't need a separate shopper account - they just use their work email and get routed to Okta automatically.

---

## Technical Change Required

The SSO team has specified two changes to our `SsoDeck` component:

1. Use `/login/progressive` as the page route (instead of `/login` or `/account/create`)
2. Set `enableCheckoutLite: true` as a prop on the `SsoDeck` component

These are localized changes in:
- `app/src/lib/ssoPageRoute.ts` (page routing logic)
- `app/src/components/auth/SsoLogin.tsx` (component props)

---

## Implementation Options

### Option A: Progressive login for sign-in flows only (Recommended)

Change the sign-in and account-creation routes to `/login/progressive`, but **leave HBI (2FA step-up) unchanged**.

| Scenario | Before | After |
|----------|--------|-------|
| New visitor | `/account/create` | `/login/progressive` |
| Returning visitor | `/login` | `/login/progressive` |
| Sensitive action (HBI) | `/hbi` | `/hbi` (unchanged) |

**Pros:**
- Unified entry point for all new and returning users (email-first is cleaner UX)
- Employees get seamless Okta sign-in without needing shopper credentials
- External users (shoppers) see a modern, streamlined flow with email, Google, and Facebook options
- No disruption to security-sensitive HBI flows that are already working correctly
- HBI remains a focused 2FA challenge for already-authenticated users (showing them "enter your email" would be confusing and regressive)

**Cons:**
- Adds one extra step for returning users who previously went straight to username/password (now they enter email first)
- Slight change to the account creation funnel (users see "Join or Sign In" instead of dedicated "Create Account")

---

### Option B: Progressive login for ALL flows (including HBI)

Change every SSO route to `/login/progressive`, including the HBI 2FA step-up.

| Scenario | Before | After |
|----------|--------|-------|
| New visitor | `/account/create` | `/login/progressive` |
| Returning visitor | `/login` | `/login/progressive` |
| Sensitive action (HBI) | `/hbi` | `/login/progressive` |

**Pros:**
- Completely unified experience - every auth interaction goes through the same page
- Simpler code (one route for everything)

**Cons:**
- **Degraded security UX for sensitive actions:** When a user tries to publish or manage billing, they're already logged in. Showing them "Enter your email" instead of a focused 2FA challenge is confusing ("Why am I signing in again? I'm already signed in.")
- **Potential security concern:** HBI is specifically designed for step-up authentication. Routing it through a general sign-in page may bypass or weaken the 2FA enforcement depending on how SSO Lite handles the `auth_reason` parameter
- **User friction on sensitive actions:** Extra steps (enter email -> verify) instead of just entering the 2FA code

---

## Recommendation

**Option A** — apply progressive login to sign-in/create flows only, leave HBI unchanged.

The progressive flow solves the employee sign-in problem without disrupting the security step-up experience. HBI is a different use case (re-verification, not initial authentication) and should remain focused and minimal.

---

## Impact Assessment

| Dimension | Impact |
|-----------|--------|
| Employee experience | Major improvement - Okta SSO instead of needing shopper accounts |
| Shopper experience | Minor change - email-first instead of username/password-first |
| Security | No regression (HBI preserved under Option A) |
| Code change size | Small (~10 lines across 2 files) |
| Risk | Low - SSO Lite is an established GoDaddy SSO feature |
| Rollback | Revert 2 file changes |

---

## Next Steps

1. Confirm decision on Option A vs Option B
2. Determine if this should be gated behind a Switchboard feature flag for gradual rollout
3. Implement and test locally against dev SSO
4. Validate with SSO team that `enableCheckoutLite: true` + `/login/progressive` is sufficient
5. Deploy to test environment for QA

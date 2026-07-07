# DC-18064 — Source AAB → Airo Care s2s JWT in agents-service

**Date:** 2026-06-30
**Bead:** Projects-2
**Parent:** DC-17886 (Customer-authenticated Airo Care conversations in AAB)
**Scope:** Lightweight (3 pts). Reuse-an-existing-capability.

## Problem

Airo Care is adding an s2s dual-auth path (`Authorization: sso-jwt <s2s>` + `X-Delegated-For: <customer-idp>`). agents-service has no Care-scoped credential source today. A later subtask (DC-18065, CareBridge) needs an on-demand s2s token to hand to `@airo-care/client`'s authenticator. This subtask delivers that token source — nothing else.

## Outcome

A named async factory in agents-service returns a valid GoDaddy `sso-jwt` for Airo Care on demand, fresh-or-cached, with env vars documented. DC-18065 consumes it; this subtask does not wire it.

## Decisions

- **Reuse, don't mint.** agents-service does not sign JWTs. `getCareS2SToken()` wraps the existing `getS2STokenV2({ awsProfile, ssoHost })` in `packages/ai-lib/src/utils/s2s-auth-v2.ts`, which fetches the token from GoDaddy SSO via gd-auth-client `IamTokenClient`.
- **Same IAM identity.** Care accepts any structurally valid SSO-issued service token today (consumer allowlist is a fast-follow on Care's side, per DC-18062). Reuse the shared `S2S_AWS_PROFILE` (default `gocode`) / `SSO_HOST`. No Care-specific IAM role, no `CARE_*` override env vars — add those only when Care ships its allowlist and requires a distinct role.
- **Return the raw token.** `@airo-care/client`'s authenticator (DC-18063) prepends `sso-jwt` and adds `X-Delegated-For`. The factory returns the bare JWT string, no scheme prefix.
- **Caching is inherited.** `getS2STokenV2` already caches with a 60s pre-expiry buffer and in-flight de-dup — satisfies AC#2 with no new cache code.
- **Local-dev fallback.** When S2S auth is disabled, return the `SSO_JWT` env var (matches the `media.ts` / `base-driver-v2` fallback pattern).

## Acceptance Criteria

1. agents-service exposes `getCareS2SToken(): Promise<string>` returning a valid s2s JWT for Airo Care on demand.
2. Token is cached with TTL < lifetime (inherited from `getS2STokenV2`); a refresh entry point is available for DC-18066.
3. Env vars documented for local/test/prod: `USE_S2S_AUTH`, `S2S_AWS_PROFILE`, `SSO_HOST`, and the `SSO_JWT` local-dev fallback.
4. One unit test covering the token path and the local-dev fallback path.

## Out of Scope

- `X-Delegated-For` / customer-IDP sourcing → **DC-18065** (CareBridge wiring).
- Retry-on-401 / cache-miss handling → **DC-18066**.
- Per-consumer IAM role / `CARE_*` overrides → deferred until Care requires a distinct identity.
- Custom JWT minting/signing → not needed; explicitly rejected.

## Dependencies & Assumptions

- **Consumer seam (DC-18063, TJ, In Progress):** `S2SDelegatedAuthenticator` constructor accepts an s2s token *or a factory*. The factory shape here matches that contract. If the final constructor signature differs, DC-18065 adapts the call site — not this subtask.
- **Server contract (DC-18062, TJ, In Review; care-agent-sdk PR #85, open):** s2s JWT validated for signature + expiry only; no `aud`/scope claim required from us.
- **⚠️ Scheme discrepancy:** DC-18062's ticket text says `Authorization: Bearer <s2s-jwt>`, but the merged design (PR #85) fires dual-auth only on the **`sso-jwt` scheme** — `Bearer` routes to the legacy path. The PR is authoritative. agents-service already emits `sso-jwt <token>` everywhere, so this is favorable; flagged so the plan doesn't follow the stale ticket text.
- **Necessary-not-sufficient:** PR #85 rejects `sso-jwt` without `X-Delegated-For` (`DelegatedForRequiredError`). This token alone cannot successfully call Care; the pairing happens in DC-18065.

## Open Questions

None blocking. Both cross-team questions (identity, aud claim) resolved against PR #85 + DC-18062/18063.

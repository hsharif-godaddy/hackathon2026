# feat: Source AAB → Airo Care s2s JWT in agents-service (DC-18064)

**Date:** 2026-06-30
**Type:** feat
**Depth:** Lightweight
**Bead:** Projects-2
**Origin:** docs/brainstorms/2026-06-30-care-s2s-jwt-requirements.md
**Parent:** DC-17886 (Customer-authenticated Airo Care conversations in AAB)

**REQUIRED SUB-SKILL:** Execute with `ce-work`; finish with `ce-commit-push-pr`.
**Goal:** Expose a Care-scoped s2s-token factory in agents-service by reusing `getS2STokenV2`.
**Architecture:** Function module in `agents/src/care/` wrapping `@airo/ai-lib`'s v2 s2s helper; no class, no new credential machinery.
**Tech stack:** TypeScript (ESM), `@airo/agents` (Express, port 4000), Vitest, `@airo/ai-lib` (gd-auth-client `IamTokenClient`).
**Execution posture:** Test-first for U1 — write `careAuth.test.ts` scenarios against mocked `@airo/ai-lib` exports before implementing the module.

## Summary

Add a Care-scoped s2s-token factory to agents-service: `getCareS2SToken(): Promise<string>` returns a fresh-or-cached GoDaddy `sso-jwt` (raw token, no scheme prefix) by reusing the existing `getS2STokenV2` helper. DC-18065 (CareBridge) will hand this factory to `@airo-care/client`'s `S2SDelegatedAuthenticator`, which prepends `sso-jwt` and pairs it with `X-Delegated-For`. This subtask delivers only the credential source.

## Problem Frame

Airo Care's new dual-auth path (PR #85, DC-18062) accepts `Authorization: sso-jwt <s2s>` + `X-Delegated-For: <customer-idp>`. agents-service has no Care-scoped credential accessor today. The mechanism it already uses for every other internal service — `getS2STokenV2` fetching an IAM identity token from GoDaddy SSO via gd-auth-client — is exactly what Care needs: Care validates only signature + expiry and accepts any structurally valid SSO-issued service token (consumer allowlist is a Care-side fast-follow). No new credential machinery, no JWT minting.

## Key Technical Decisions

- **Reuse `getS2STokenV2`, don't mint.** New code is a thin Care-config binding over `packages/ai-lib/src/utils/s2s-auth-v2.ts`. Caching (60s pre-expiry buffer), in-flight de-dup, and per-`profile::ssoHost` keying are inherited — satisfies AC#2 with zero new cache code.
- **Mirror `base-driver-v2` config resolution exactly** (`agents/src/tools/ai-lib-tools/drivers/base-driver-v2.ts:37-42`): `awsProfile: process.env.S2S_AWS_PROFILE || 'gocode'`, `ssoHost: process.env.SSO_HOST || 'sso.test-godaddy.com'`, enable flag `isS2SAuthV2Enabled()` (`USE_S2S_AUTH === 'true'`), local fallback `process.env.SSO_JWT`. Using the v2 helper means the v2 enable flag — **not** the legacy `isS2SAuthEnabled()` / `GOCODE_USE_S2S_AUTH`.
- **Return the RAW token** — the one deliberate divergence from `base-driver-v2`. `base-driver-v2.getAuthToken()` returns `sso-jwt ${token}` because it builds its own header; `getCareS2SToken` returns the bare JWT because `@airo-care/client`'s authenticator (DC-18063) prepends the `sso-jwt` scheme. Document this at the call site. (see origin: docs/brainstorms/2026-06-30-care-s2s-jwt-requirements.md)
- **No `CARE_*` override env vars.** Care accepts our existing identity; speculative per-Care profile/host knobs are deferred until Care ships its allowlist and requires a distinct role. (`ponytail:` reuse shared profile/host, split when Care requires a distinct role.)
- **No retry-on-401 here.** `getS2STokenV2`/`refreshS2STokenV2` are exposed; reactive 401 invalidation + retry is DC-18066 / CareBridge scope.

## Scope Boundaries

**In scope:** `getCareS2SToken` + `refreshCareS2SToken` in a new `agents/src/care/` module; local-dev `SSO_JWT` fallback; env-var docs; one unit test.

### Deferred to Follow-Up Work
- `X-Delegated-For` / customer-IDP sourcing and the actual `@airo-care/client` wiring → DC-18065 (CareBridge).
- Reactive 401 / cache-miss handling → DC-18066.
- Per-consumer IAM role / `CARE_*` overrides → only when Care requires a distinct identity.

---

## Implementation Units

### U1. Care s2s-token accessor module

**Goal:** Provide `getCareS2SToken()` and `refreshCareS2SToken()` that return a raw GoDaddy `sso-jwt` for Airo Care, backed by `getS2STokenV2`.

**Requirements:** AC#1 (produce token on demand), AC#2 (cached with TTL < lifetime, inherited).

**Dependencies:** none.

**Files:**
- `agents/src/care/careAuth.ts` (new — creates the `agents/src/care/` dir that DC-18065 will also use)
- `agents/src/care/careAuth.test.ts` (new)

**Approach:**
- A private `careS2SConfig()` returning `{ awsProfile: process.env.S2S_AWS_PROFILE || 'gocode', ssoHost: process.env.SSO_HOST || 'sso.test-godaddy.com' }`. Reuses base-driver-v2's resolution *values*, but reads env per call rather than caching in a constructor (this module is function-based, not a class) — keeps env stubbing and per-env behavior straightforward.
- `getCareS2SToken()`: if `isS2SAuthV2Enabled()` → `return getS2STokenV2(careS2SConfig())`; else if `process.env.SSO_JWT` → return it; else throw a clear error ("No Care s2s auth configured. Set USE_S2S_AUTH=true (hosted) or SSO_JWT (local)."). Mirrors `base-driver-v2.getAuthToken()` precedence.
- `refreshCareS2SToken()`: `return refreshS2STokenV2(careS2SConfig())`.
- Both return the **raw** token (no `sso-jwt` prefix). Add a one-line comment stating the consumer prepends the scheme.
- Import `getS2STokenV2`, `refreshS2STokenV2`, `isS2SAuthV2Enabled` from `@airo/ai-lib`. Use the structured logger per repo convention (no `console.log`); a single `care.s2s.token.*` info/warn line is enough.

**Execution note:** Test-first — write the failing `careAuth.test.ts` scenarios (below) against mocked `@airo/ai-lib` exports first, confirm they fail (module absent), then implement `careAuth.ts` to green.

**Patterns to follow:** `agents/src/tools/ai-lib-tools/drivers/base-driver-v2.ts:37-73` (config resolution + three-branch fallback precedence); `packages/ai-lib/src/utils/__tests__/s2s-auth-v2.test.ts:1-44` (vitest + env-stub + `vi.mock` style). The three imports (`getS2STokenV2`, `refreshS2STokenV2`, `isS2SAuthV2Enabled`) are re-exported from the `@airo/ai-lib` barrel (`packages/ai-lib/src/index.ts:45`).

**Test scenarios** (`agents/src/care/careAuth.test.ts`, vitest; mock `@airo/ai-lib` exports, stub `process.env`):
- `getCareS2SToken` with `USE_S2S_AUTH=true` calls `getS2STokenV2` with `{ awsProfile: 'gocode', ssoHost: 'sso.test-godaddy.com' }` (defaults) and returns its raw token unprefixed (no leading `sso-jwt `).
- Honors `S2S_AWS_PROFILE` / `SSO_HOST` overrides in the config passed to `getS2STokenV2`.
- Local fallback: `USE_S2S_AUTH` unset + `SSO_JWT` set → returns `SSO_JWT` verbatim, does **not** call `getS2STokenV2`.
- Neither set → throws with the configured-auth message.
- `refreshCareS2SToken` delegates to `refreshS2STokenV2` with the same config.

**Verification:** `pnpm --filter @airo/agents test:unit careAuth` green; `pnpm --filter @airo/agents typecheck` and `lint` clean.

---

### U2. Document Care s2s env vars

**Goal:** Record that Care reuses the existing s2s token, satisfying AC#3 (local/test/prod env documented).

**Requirements:** AC#3.

**Dependencies:** U1.

**Files:**
- `agents/.env.example` (modify — "S2S Authentication" section, lines 32-43)

**Approach:** Extend the lines 32-43 S2S section with a Care note. **Caveat verified during audit:** that section currently documents the *legacy v1* vars (`GOCODE_USE_S2S_AUTH`, `AWS_PROFILE=airobuild-dev-private-sso`), not the *v2* vars `careAuth.ts` actually consumes (`USE_S2S_AUTH`, `S2S_AWS_PROFILE`). So this unit must also surface the v2 vars: add commented `USE_S2S_AUTH=true` and `S2S_AWS_PROFILE=gocode` lines and state that Airo Care (and base-driver-v2) use these for hosted test/prod, with `SSO_HOST` for the SSO host and the existing `SSO_JWT` (line 161) as the local-dev fallback. No Care-specific vars. Keep it to a few comment lines; don't restructure the file.

**Test scenarios:** Test expectation: none — documentation-only change.

**Verification:** `agents/.env.example` reads coherently; the v2 var names (`USE_S2S_AUTH`, `S2S_AWS_PROFILE`, `SSO_HOST`, `SSO_JWT`) match exactly what `careAuth.ts` reads in U1.

---

## Handoff

After U1-U2 land and `pnpm --filter @airo/agents typecheck`, `lint`, and `test:unit careAuth` are green, invoke `ce-commit-push-pr` to commit (explicit `git add agents/src/care/careAuth.ts agents/src/care/careAuth.test.ts agents/.env.example docs/plans/2026-06-30-001-feat-care-s2s-jwt-plan.md`), push, and open the PR for DC-18064.

---

## Dependencies & Assumptions

- **Consumer seam (DC-18063, TJ, In Progress):** `S2SDelegatedAuthenticator` accepts an s2s token *or a factory* at construction. The `getCareS2SToken` factory shape matches; if the final signature differs, DC-18065 adapts the call site.
- **Server contract (DC-18062 In Review; care-agent-sdk PR #85 open):** s2s JWT validated for signature + expiry only — no `aud`/scope claim required from us.
- **⚠️ Scheme discrepancy:** DC-18062's ticket text says `Authorization: Bearer <s2s-jwt>`, but the merged design (PR #85) fires dual-auth only on the **`sso-jwt` scheme** (Bearer routes to the legacy path). The PR is authoritative; agents-service already emits `sso-jwt <token>` everywhere, so producing the raw token is correct. Do not follow the stale ticket text.
- **Necessary-not-sufficient:** PR #85 rejects `sso-jwt` without `X-Delegated-For` (`DelegatedForRequiredError`). This token alone cannot call Care; pairing happens in DC-18065.

## Open Questions

None blocking. Both cross-team questions (identity, aud claim) resolved against PR #85 + DC-18062/18063.

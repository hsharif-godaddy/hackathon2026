# Switchboard feature flags (Airo App Builder)

This document explains how **Switchboard** integrates with this repo, how to work with flags **locally**, and what to change in **code** when you introduce a new flag. It does **not** replace internal GoDaddy documentation for the Switchboard admin product itself (see [Switchboard admin and new flags](#switchboard-admin-and-new-flags)).

## What Switchboard does here

Switchboard provides **runtime boolean (and some string) feature settings** per environment. The Builder app reads them in two ways:

| Surface                       | API                                                                                                                                 | Code                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Browser**                   | Browser calls PCX BFF directly using `appFetch` (adds `credentials: 'include'` and handles 401 UI state; no app API route involved) | `useSwitchboard('flag-name')` and `fetchFeatureFlag()` in [`app/src/hooks/useSwitchboard.ts`][useSwitchboard]     |
| **Server (BFF / API routes)** | `fetch()` to the same BFF feature endpoint with `sso-jwt`                                                                           | `checkSwitchboardFlag()` / `checkSwitchboardValue()` in [`app/src/lib/switchboard/server.ts`][switchboard-server] |

The HTTP shape used in code is:

- **Host:** `https://bff.pcx.{rootDomain}` where `rootDomain` comes from the request (client: `getRootDomain()`, server: `getRootDomainFromHeaders()` in `app/src/utils/getRootDomain.ts`).
- **Path:** `/api/config/feature/{featureName}`
- **Query:** `app=airo-app-builder` (constant `SWITCHBOARD_APP` on the server).

Successful JSON responses are expected to include a **`setting`** field; booleans use that as the flag value.

## Local development

### Enable local overrides

When **`NEXT_PUBLIC_ENABLE_LOCAL_FEATURES=true`**, the app **does not call Switchboard** for flag names that appear in the local override maps; it returns the configured boolean/string instead. The variable is not restricted to local dev — it also works in the test environment (or any environment where `app/.env` is present with the value set), which is useful for testing flag-gated features without a live Switchboard flag.

- **Preflight opt-in:** `pnpm run dev` runs a `LocalFeaturesCheck` (see [`dev-runner/internal/preflight/checks/local_features.go`][local-features-go] and [`fixers/local_features.go`][local-features-fixer-go]). If `app/.env` doesn't exist yet the check is **skipped** until after the env setup step. If the variable is absent the check reports a warning with a fix available — the fix only runs if you choose to apply it at the preflight prompt. It is **not** applied automatically on every `pnpm run dev` run.
- **Manual:** add or set `NEXT_PUBLIC_ENABLE_LOCAL_FEATURES=true` in `app/.env` yourself. [`app/env.example`][env-example] documents the variable (default `false` in the example file).

The gate is implemented via `isFeatureEnabled.localFeatures()` in [`app/src/lib/features.ts`][features] on the client and `process.env.NEXT_PUBLIC_ENABLE_LOCAL_FEATURES === 'true'` on the server.

### Client vs server override lists

The **client** and **server** allowlists are **not the same**:

- Client: `LOCAL_FEATURE_OVERRIDES` in [`app/src/hooks/useSwitchboard.ts`][useSwitchboard].
- Server: `SERVER_LOCAL_FEATURE_OVERRIDES` and `SERVER_LOCAL_VALUE_OVERRIDES` in [`app/src/lib/switchboard/server.ts`][switchboard-server].

If a flag is read in both places (for example UI on the client and JWT or API logic on the server), you usually need an entry in **both** maps for consistent local behavior.

### Flags not in the local maps

If `NEXT_PUBLIC_ENABLE_LOCAL_FEATURES=true` but the flag name is **not** in the override map, the client/server code **falls through to the real BFF** Switchboard request. That typically requires:

- A resolvable **root domain** (local dev usually uses the Gasket dev host; see repo onboarding for `/etc/hosts` and HTTPS proxy).
- **Valid SSO** where the BFF expects it, or you may get `401` / fail-closed behavior depending on the helper (`fetchFeatureFlag` vs `useSwitchboard` auth behavior is documented in [`useSwitchboard.ts`][useSwitchboard]).

### Verifying a flag at runtime

Open the browser DevTools **Network** tab and filter by `config/feature`. Each flag fetch appears as a request to `bff.pcx.{rootDomain}/api/config/feature/{flagName}`. Click the request and check the **Response** — a working flag returns `{"setting": true}` (or `false`, or a string value). A missing or unrecognised flag typically returns `{"setting": null}`, which the code helpers treat as `false`.

### Related docs

- [Model override runbook](model-override.md) — includes the **Switchboard app URL** used for ops-style string flags (`appbuilder-model-override`).
- [SSE transport](sse-transport-protocol.md) — example of a flag name and local-dev behavior.
- [`app/src/hooks/useSwitchboard.ts`][useSwitchboard] — client hook, `LOCAL_FEATURE_OVERRIDES`.
- [`app/src/lib/switchboard/server.ts`][switchboard-server] — server helpers, `SERVER_LOCAL_FEATURE_OVERRIDES`, `SERVER_LOCAL_VALUE_OVERRIDES`.
- [`app/src/lib/features.ts`][features] — `isFeatureEnabled.localFeatures()` gate.
- [`dev-runner/internal/preflight/checks/local_features.go`][local-features-go] / [`fixers/local_features.go`][local-features-fixer-go] — opt-in preflight check and fixer for `NEXT_PUBLIC_ENABLE_LOCAL_FEATURES`.
- [`app/env.example`][env-example] — environment variable reference.

## Adding a flag in **this codebase**

After a flag **exists** in Switchboard (or you only need local behavior first), typical steps are:

1. **Call site:** Use `useSwitchboard('your-flag-kebab-case')` in React, or `checkSwitchboardFlag('your-flag-kebab-case', jwt, headers)` / `checkSwitchboardValue(...)` on the server. For SSR prefetching (populating the query cache before render in a Next.js route handler), use `prefetchSwitchboard(queryClient, 'your-flag-kebab-case')` from [`useSwitchboard.ts`][useSwitchboard].
2. **Local dev:** If the feature should be on (or off) without hitting Switchboard, add the name to `LOCAL_FEATURE_OVERRIDES` and, if used on the server, to `SERVER_LOCAL_FEATURE_OVERRIDES` or `SERVER_LOCAL_VALUE_OVERRIDES`.
3. **JWT / agents:** If the BFF must embed the value in the agent token, update the agent-token route and any JWT typing/caching keyed on claims (grep similar flags such as model or agent profile for the pattern).
4. **Tests:** Add or adjust unit tests; mock Switchboard at the `appFetch` / `fetch` boundary where tests already do so for related routes.

Naming: use the `appbuilder-` prefix (e.g. `appbuilder-my-feature`). This is the dominant convention in the codebase. The `app-builder-` and `airo-builder-` prefixes appear on a handful of older flags but are not intentional distinctions — don't introduce new flags with those prefixes.

## Switchboard admin and new flags

Create and manage flags for the Airo App Builder application at:

**[https://switchboard.int.gdcorp.tools/airo-app-builder](https://switchboard.int.gdcorp.tools/airo-app-builder)**

### Flag types

When creating a new flag you will be asked to choose a type. The available options are:

| Type                          | When to use                                                                                                                                                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boolean**                   | Simple on/off flag with no targeting. Use when you want every customer to get the same value (e.g. a kill-switch or a feature that is globally on/off). The code helpers return `true` / `false` from the `setting` field.                                        |
| **Number**                    | Numeric setting (e.g. a rate limit). Rare in this codebase — use `checkSwitchboardValue` and parse the result.                                                                                                                                                    |
| **String**                    | Arbitrary string value with no targeting. Used for things like `appbuilder-model-override` where the value is a model name rather than a flag. Read with `checkSwitchboardValue`.                                                                                 |
| **JSON / Object with Schema** | Structured data. Not currently used in this codebase.                                                                                                                                                                                                             |
| **Shopper Split**             | ✅ **Default choice for most AAB flags.** Targets by shopper ID (the logged-in GoDaddy customer). Because every AAB user is authenticated, this gives deterministic, per-customer targeting and supports percentage rollouts and allow-listing specific shoppers. |
| **Visitor Split**             | Targets by anonymous visitor/cookie ID — works before login. Less useful for AAB since the app always requires authentication.                                                                                                                                    |
| **Market Split**              | Targets by locale / market (e.g. `en-US`, `es-MX`). Use when a feature should roll out to a specific market first.                                                                                                                                                |
| **Reseller Split**            | Targets by reseller channel. Use when a feature should be scoped to a specific reseller's customer base.                                                                                                                                                          |
| **Advanced Split**            | Combines multiple dimensions (shopper + market, etc.). Use when a simple split is not expressive enough.                                                                                                                                                          |
| **Raw**                       | Manual JSON config for the Switchboard engine. Avoid unless you know exactly what you need.                                                                                                                                                                       |

**Quick guidance:**

- **Feature rollout or experiment** → Shopper Split (deterministic per customer, supports % rollout).
- **Locale / market gating** → Market Split.
- **Ops / emergency value** (e.g. override a model name) → String.
- **Simple global on/off** with no targeting → Boolean.

### What to confirm with your team

1. **Environments mirror deployments** — Switchboard environments map directly to the published deployment environments. If your code is deployed to test, the flag must exist in the test environment in Switchboard or the code will fail closed. Create the flag in each environment your build is deployed to before or alongside deploying the code that reads it.
2. **Access** — you need to be a member of the **`DEV-Airo-Builders`** AD group to create or edit flags in the `airo-app-builder` Switchboard application.
3. **Default value** — decide what the flag returns when unset (Switchboard returns `null` / missing `setting`; code helpers default to `false` for booleans and `null` for strings).
4. **Naming** — see the [naming convention above](#adding-a-flag-in-this-codebase).

Once the flag exists in Switchboard, use the **[Adding a flag in this codebase](#adding-a-flag-in-this-codebase)** section above to wire it in.

<!-- Link definitions -->

[useSwitchboard]: ../app/src/hooks/useSwitchboard.ts
[switchboard-server]: ../app/src/lib/switchboard/server.ts
[features]: ../app/src/lib/features.ts
[local-features-go]: ../dev-runner/internal/preflight/checks/local_features.go
[local-features-fixer-go]: ../dev-runner/internal/preflight/fixers/local_features.go
[env-example]: ../app/env.example

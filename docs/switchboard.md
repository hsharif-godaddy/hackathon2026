# Switchboard feature flags (Airo App Builder)

This document explains how **Switchboard** integrates with this repo, how to work with flags **locally**, and what to change in **code** when you introduce a new flag. It does **not** replace internal GoDaddy documentation for the Switchboard admin product itself (see [Switchboard admin and new flags](#switchboard-admin-and-new-flags) and the [GoDaddy internal Switchboard guide on Confluence](https://godaddy-corp.atlassian.net/wiki/spaces/CONVERSATIONS/pages/3462570192/Add+a+Feature+Flag+Experiment+in+Switchboard)).

## What Switchboard does here

Switchboard provides **runtime boolean (and some string) feature settings** per environment. The app reads them via `@godaddy/gasket-plugin-switchboard`, which runs a singleton `@switchboard/client` that authenticates to Switchboard over **IAM** (not per-user SSO) and polls settings into an in-process cache. `gasket.ts` configures `apps: ['@hivemind', 'airo-app-builder']` so Hivemind experiment cohorts and Switchboard feature flags land in the same per-request tree.

| Surface                       | API                                                                                                             | Code                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Browser**                   | No network call. Flags are SSR-baked into `window.gasketData.switchboard` by the plugin and read synchronously. | `useSwitchboard('flag-name')` / `getSwitchboardFlag('flag-name')` in [`app/src/hooks/useSwitchboard.ts`][useSwitchboard] (return `boolean \| undefined` synchronously). |
| **Server (BFF / API routes)** | `await gasket.actions.getSwitchboardConfig(req)` behind helpers. No per-request HTTP fetch to Switchboard.      | `checkSwitchboardFlag(name, req)` / `checkSwitchboardValue(name, req)` in [`app/src/lib/switchboard/server.ts`][switchboard-server].                                    |

`req` is anything with a `headers` field (`NextRequest`, `Request`, or a plain `{ headers }` wrapper); the plugin extracts the criteria (shopperId / customerId / visitor) from those headers for Hivemind targeting.

**Error contract (server):** `checkSwitchboardFlag` / `checkSwitchboardValue` return `false` / `null` when the key is absent from the tree or has the wrong type, but **re-throw** on any system failure - the underlying gasket call throwing (IAM error, plugin startup race, transient) _or_ returning no tree at all (null / undefined). Both indicate the plugin couldn't supply flag state and must not be read as "all flags are off". Paywall and other security gates depend on the re-throw to fail closed. UI/API callers that want a soft default should wrap in `try/catch`.

**Staleness:** Flag flips propagate within the client's `cacheRefreshMs` (default ~2 min). Nothing in this codebase requires lower latency; if yours does, read the plugin docs before designing around that assumption.

## IAM grants

The plugin authenticates to Switchboard using the AWS role in scope. Reader access on `airo-app-builder` is already granted. The grants are scoped per **Switchboard environment** (not per CDK AWS account) - so each of dev/test/prod gets its own grant list, even though the roles span multiple AWS accounts.

**Switchboard `dev` and `test` environments** - same grants on both (covers CDK dev account `694282668781` and CDK test account `269423819739`):

- `arn:aws:iam::694282668781:role/*`
- `arn:aws:iam::694282668781:role/airobuilde-custom-*`
- `arn:aws:iam::269423819739:role/airobuilde-custom-*`

**Switchboard `prod` environment** (covers CDK prod account `644094189644` plus the dev/test account patterns so deploy tooling from those accounts can read prod flags):

- `arn:aws:iam::644094189644:role/airobuilde-custom-*`
- `arn:aws:iam::694282668781:role/airobuilde-custom-*`
- `arn:aws:iam::269423819739:role/airobuilde-custom-*`

Local dev inherits the dev grant through `AWS_PROFILE=airobuild-dev-private-sso` (account `694282668781`, PowerUser permission set), the same profile already required by other AWS-touching tooling.

## Local development

`local.dev` reads from the Switchboard development environment. Local feature flags should be configured in Switchboard rather than overridden in code, so local behavior stays aligned with deployed environments.

Use the dev Switchboard app to enable, disable, or create flags for local development:

**[https://switchboard.int.dev-gdcorp.tools/airo-app-builder](https://switchboard.int.dev-gdcorp.tools/airo-app-builder)**

For an existing boolean flag, open the flag in the dev app and set the desired development value or targeting rule. For a new local-dev flag, create it there first, then add the code call site in this repo.

**To enable a flag only for yourself** (without affecting other developers or automated tests hitting the dev environment): use the **Overrides** section in the Switchboard UI to add your shopper ID with the desired value. For flags using a split type, you can also add your shopper ID directly into the targeting rule. The identifier is your GoDaddy **shopper ID** (not customer ID) — find it in your SSO JWT claims or via the GoDaddy CRM.

Local dev inherits the dev grant through `AWS_PROFILE=airobuild-dev-private-sso` (account `694282668781`, PowerUser permission set). Without those credentials, flag lookups resolve to the default (`false` / `null`) - there is no automatic fallback.

### Verifying a flag at runtime

- **Client:** open DevTools console and inspect `window.gasketData.switchboard` - it contains the full merged tree (`@hivemind` + `airo-app-builder`) resolved for the current user. Individual flag reads go through `useSwitchboard()` synchronously; there is no network call to filter for in the Network tab.
- **Server:** flag values are embedded in the agent-token route's flag block. On real lookup errors (gasket / IAM failure) look for `switchboard.server.lookup-error`.

### Related docs

- [Model override runbook](model-override.md) - includes the **Switchboard app URL** used for ops-style string flags (`appbuilder-model-override`).
- [SSE transport](sse-transport-protocol.md) - example of a flag name and local-dev behavior.
- [`app/src/hooks/useSwitchboard.ts`][useSwitchboard] - client hook.
- [`app/src/lib/switchboard/server.ts`][switchboard-server] - server helpers.

## Adding a flag in **this codebase**

After a flag **exists** in Switchboard, typical steps are:

1. **Call site:** Use `useSwitchboard('your-flag-kebab-case')` in React, `getSwitchboardFlag('your-flag-kebab-case')` in non-hook call sites (stores, async callbacks), or `checkSwitchboardFlag('your-flag-kebab-case', req)` / `checkSwitchboardValue(...)` on the server. No SSR prefetching is needed - the plugin populates `gasketData.switchboard` during the render pass, and the client reads are synchronous.
2. **Local dev:** Create or update the flag in the Switchboard development environment.
3. **JWT / agents:** If the BFF must embed the value in the agent token, update the agent-token route (`app/src/app/api/auth/agent-token/route.ts`) and any JWT typing/caching keyed on claims (grep similar flags such as model or agent profile for the pattern).
4. **Tests:** Add or adjust unit tests. Mock `useSwitchboard` / `getSwitchboardFlag` at the hook boundary with `vi.mock('@/hooks/useSwitchboard', () => ({ useSwitchboard: vi.fn(() => true), getSwitchboardFlag: vi.fn(() => true) }))`. For server-side code, mock `checkSwitchboardFlag` from `@/lib/switchboard/server` directly.

**Naming:** use the `appbuilder-` prefix (e.g. `appbuilder-my-feature`). This is the dominant convention in the codebase. The `app-builder-` and `airo-builder-` prefixes appear on a handful of older flags but are not intentional distinctions - don't introduce new flags with those prefixes.

### Flags wired through the agent JWT

Some flags are evaluated in `app/src/app/api/auth/agent-token/route.ts` and passed to the agents service on the JWT (grep `resolveBooleanFlag` in that file). Examples:

| Flag | JWT claim | Notes |
| ---- | --------- | ----- |
| `appbuilder-atlas-crawler` | `useAtlasCrawler` | Atlas vs external scrape backend |
| `appbuilder-rebuild-intake-form` | `rebuildIntakeFormEnabled` | Intake UI before first rebuild scrape only (`!initialBuildComplete` on agents) |
| `appbuilder-skill-suggestions` | `skillSuggestionsEnabled` | Master switch for the pending-skills feature. Gates (a) merging skill-reported pending capabilities into "Continue building" next-actions (read via `getActiveAgentContext()` in `NextActionsService`) and (b) proactive session-start "what's new" announcements in `skill-announcements-context.ts` (threaded via `context.metadata` on WS + SSE). Off → next-actions shows LLM suggestions only and no announcements are injected |

## Switchboard admin and new flags

Create and manage flags for the Airo App Builder application at:

- **Dev:** [https://switchboard.int.dev-gdcorp.tools/airo-app-builder](https://switchboard.int.dev-gdcorp.tools/airo-app-builder)
- **Prod:** [https://switchboard.int.gdcorp.tools/airo-app-builder](https://switchboard.int.gdcorp.tools/airo-app-builder)

### Flag types

When creating a new flag you will be asked to choose a type. The available options are:

| Type                          | When to use                                                                                                                                                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boolean**                   | Simple on/off flag with no targeting. Use when you want every customer to get the same value (e.g. a kill-switch or a feature that is globally on/off). The code helpers return `true` / `false` from the tree.                                                   |
| **Number**                    | Numeric setting (e.g. a rate limit). Rare in this codebase.                                                                                                                                                                                                       |
| **String**                    | Arbitrary string value with no targeting. Used for things like `appbuilder-model-override` where the value is a model name rather than a flag. Read with `checkSwitchboardValue`.                                                                                 |
| **JSON / Object with Schema** | Structured data. Not currently used in this codebase.                                                                                                                                                                                                             |
| **Shopper Split**             | ✅ **Default choice for most AAB flags.** Targets by shopper ID (the logged-in GoDaddy customer). Because every AAB user is authenticated, this gives deterministic, per-customer targeting and supports percentage rollouts and allow-listing specific shoppers. |
| **Visitor Split**             | Targets by anonymous visitor/cookie ID - works before login. Less useful for AAB since the app always requires authentication.                                                                                                                                    |
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

1. **Environments mirror deployments** - Switchboard environments map directly to the published deployment environments. If your code is deployed to test, the flag must exist in the test environment in Switchboard or the code will fail closed. Create the flag in each environment your build is deployed to before or alongside deploying the code that reads it.
2. **Access** - you need to be a member of the **`DEV-Airo-Builders`** AD group to create or edit flags in the `airo-app-builder` Switchboard application.
3. **Default value** - decide what the flag returns when unset (code helpers default to `false` for booleans and `null` for strings).
4. **Naming** - see the [naming convention above](#adding-a-flag-in-this-codebase).

Once the flag exists in Switchboard, use the **[Adding a flag in this codebase](#adding-a-flag-in-this-codebase)** section above to wire it in.

<!-- Link definitions -->

[useSwitchboard]: ../app/src/hooks/useSwitchboard.ts
[switchboard-server]: ../app/src/lib/switchboard/server.ts

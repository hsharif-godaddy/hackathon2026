# DPP → /develop hand-off: hydrate initial prompt + domain from control plane

## TL;DR — the lift is small

The desired outcome ("DPP redirects to /develop, prompt is enhanced, agent starts to do work") falls out of the existing system with **one required code change** and a couple of small additions for the domain-context bonus:

- **The "enhancement" is free.** `agents/src/server/agent-router.ts` already routes to the `agents/src/prompts/initial/1.0/core.md` design-focused-preview-planner system prompt on every first turn — the `if (!hasMessages)` branch resolves to `'initial'` whenever no prior messages exist and no `templateId` is supplied, regardless of entry point. No agent-side work.
- **The one required change** is to the auto-send _gate_ in `app/src/app/[market]/develop/hooks/useInitialization.ts`. `initialPromptText` already falls back to `site.initial_prompt` via `sitePromptForCurrentApp ?? getStoredInitialPrompt(...)`, so the chat input shows the prompt on cold redirect — but `context.hasInitialPrompt` (the boolean latch the auto-send waits on) is derived solely from `checkHasInitialPrompt`, which only checks `initial-prompt-pending-{id}` + `in-creation-flow-{id}` in sessionStorage. Those flags are never written by DPP-style redirects, so the gate stays closed and auto-send never fires. The fix is to OR in a site-aware check (`isSiteForCurrentApp(site, appId, realAppId) && !!site.initial_prompt`) so the gate hydrates from the same `site` zustand source the text read already uses, with the existing staleness guard preserved.
- **Domain context (the "extras DPP wants on day one")** adds three small touches: one mapping line in the BFF adapter, one typed field on `AppDetailsResponse`, and a one-line preamble at the auto-send call site. No agent change — the default 1.0 prompt already weaves domain mentions into design direction organically.

Net diff is roughly: **one BFF mapping line, one type field, one variables-allowlist entry, a small change to `checkHasInitialPrompt`, ~3 lines for the preamble composition** — plus tests. No new endpoints, no new sync surfaces, no second control-plane data source, no agent-side work, no changes to the prompt-engineering pipeline. The job→realAppId flip and the WebSocket auto-send pipeline already exist and do not need to change.

## Context

GoDaddy's domain-purchase-path (DPP) UI creates an Airo app by calling **mgmt-airo's control-plane API directly** (not Airo's BFF), writes `variables.initialPrompt` (and `variables.fqdn` for the purchased domain) to the app record, then redirects the user to **`https://<airobuilder>/develop/{jobId}?type=job`** — the same URL shape the home page uses today. DPP knows the job ID at create time and does not need to poll for the realAppId; the develop page handles the `jobId → realAppId` flip itself.

Today the BFF — both the V2-add-app and signup paths in `mapAppToSiteInfo` / `createSite` (`app/src/lib/control-plane/v2-control-plane-adapter.ts`) — already writes `variables: { initialPrompt: params.prompt, ... }` on create. So `site.initial_prompt` is populated for home-page traffic too, not just DPP. The develop page reads it via `sitePromptForCurrentApp` (gated by `isSiteForCurrentApp`, the cross-app staleness guard) and falls back to `getStoredInitialPrompt(initialJobId, appId)` for rebuild-mode and pre-hydration cases. The chat input therefore _shows_ the prompt on a cold redirect — what's missing is auto-send. The boolean gate `context.hasInitialPrompt` is hydrated from `checkHasInitialPrompt`, which inspects only `initial-prompt-pending-{id}` and `in-creation-flow-{id}` sessionStorage flags. The home-page `quick-create` flow writes those flags before navigation; an external redirect (DPP) does not, so the gate is permanently false and auto-send never fires even though everything else is in place.

The "prompt enhancement" the spec calls for is **not user-message rewriting** — it's the design-focused-preview-planner system prompt at `agents/src/prompts/initial/1.0/core.md`, which `agents/src/server/agent-router.ts` automatically routes to whenever `hasMessagesForApp(appId)` is false and no `templateId` is supplied. That routing is entry-point-agnostic; we don't need to touch the agent to get the enhancement, we just need the develop page to actually send the first user message.

**Outcome:** redirecting from any external GoDaddy product (DPP first, others later) to `/develop/{jobId}?type=job` will, after the standard job→app resolution, auto-send the stored `initialPrompt` to the agent on first websocket connect; the initial agent runs the existing 1.0 preview planner; the develop agent picks up the handoff; the user sees their first preview without lifting a finger. FQDN (when present) is woven into the first message so the agent treats it as part of the user's intent.

Architecture decision: **the control-plane app record is the source of truth for the initial prompt.** sessionStorage stays as an in-flight cache for the home-page flow (lets the prompt show in the input box pre-send, survives mid-flight reloads) but it is no longer the only path.

## Two-phase semantics (important)

DPP redirects with `jobId`, not `appId`. The develop page handles two phases:

1. **Job phase** (`/develop/{jobId}?type=job`): BFF's `getSite(jobId)` falls into `jobIdLookup()` (`app/src/lib/control-plane/v2-control-plane-adapter.ts`) which returns a stub — `{ id: jobId, name: 'Provisioning...', status: Creating }` — with **no `variables`** and **no `initial_prompt`**. The agent's WebSocket is not yet listening. The state machine gates `shouldAutoSendPrompt` on the `ready.websocketConnected` substate (`app/src/app/[market]/develop/hooks/initializationMachine.ts`), which is unreachable during this phase. The page shows the "Provisioning..." UI exactly as it does for home-page traffic. **No DPP-specific behavior needed in this phase.**

2. **App phase** (after URL flips to `/develop/{realAppId}`): the `CREATION_SUCCEEDED` handler in `useInitialization.ts` does the flip. `useAppDetails(realAppId)` returns the full record with `initial_prompt` and (after this plan) `fqdn`. WebSocket connects. The auto-send pipeline fires. **This is where the new fallback kicks in.**

The fallback does **not** need the job-phase response to expose variables — the existing flip + hydrate machinery delivers us a fully-loaded app record by the time we'd auto-send.

## Critical files

| File                                                                                                                                                    | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/src/app/[market]/develop/hooks/useInitialization.ts`                                                                                               | Extend `checkHasInitialPrompt` to OR in a site-aware check, so the auto-send gate hydrates from `site.initial_prompt` (with the `isSiteForCurrentApp` staleness guard) when the sessionStorage `pending` / `in-creation-flow` flags are absent. Compose the first message with FQDN preamble when present. Existing read precedence (`sitePromptForCurrentApp ?? getStoredInitialPrompt`, rebuild-mode branch first) and the `!context.initialPromptSent` machine-context latch are preserved. |
| `app/src/lib/control-plane/v2-control-plane-adapter.ts` (currently maps `app.variables?.initialPrompt → site.initial_prompt` inside `mapAppToSiteInfo`) | Add mapping for `app.variables?.fqdn → site.fqdn` (or whichever variable key DPP writes — confirm during impl). Apply length-clamping here (Step 5) so the contract is uniform across all consumers.                                                                                                                                                                                                                                                                                           |
| `app/src/lib/control-plane/types.ts` (`SiteInfo`)                                                                                                       | Extend `SiteInfo` with `fqdn?: string`, mirroring the existing `initial_prompt?: string`. This is the canonical type for fields surfaced by `mapAppToSiteInfo`; `Site` in the develop-page zustand store is `type Site = SiteInfo`, so the Step 3 `site?.fqdn` read needs this field on `SiteInfo` itself (no index-signature escape hatch on this type).                                                                                                                                      |
| `app/src/hooks/useAppDetails.ts`                                                                                                                        | Add typed fields `initial_prompt?: string` and `fqdn?: string` to `AppDetailsResponse`. The existing `[key: string]: any` index signature lets values flow today, but undermines the new typing — flag for follow-up cleanup once direct callers exist.                                                                                                                                                                                                                                        |
| `app/src/app/api/sites/[id]/variables/route.ts` (`ALLOWED_VARIABLE_KEYS`)                                                                               | Add `'fqdn'` so the BFF can also write it (e.g. for non-DPP entry points later). Read-only via mgmt-airo direct-write is enough for DPP day-one; adding the key keeps the surface symmetric.                                                                                                                                                                                                                                                                                                   |
| **(read-only reference)** `app/src/lib/quick-create.ts` (`setQuickCreateSessionFlags`)                                                                  | Documents the flags the home-page flow writes (`initial-prompt-pending-{id}`, `in-creation-flow-{id}`). Useful for understanding why the existing sessionStorage branch of `checkHasInitialPrompt` works for home traffic but not external redirects. No code change here — the site-aware branch in Step 2 covers external entry points without writing these flags.                                                                                                                          |

**No agent-side changes.** `agents/src/server/agent-router.ts` already routes to `'initial'` (i.e. `agents/src/prompts/initial/1.0/core.md`) on `hasMessagesForApp === false` with no `templateId`. The "enhancement" falls out for free.

## Implementation

### Step 1 — BFF: surface `fqdn` on the site response

In `app/src/lib/control-plane/v2-control-plane-adapter.ts`, alongside the existing `initial_prompt` mapping inside `mapAppToSiteInfo`:

```ts
initial_prompt: app.variables?.initialPrompt,
fqdn: app.variables?.fqdn,
```

Add `'fqdn'` to `ALLOWED_VARIABLE_KEYS` in `app/src/app/api/sites/[id]/variables/route.ts`.

In `app/src/hooks/useAppDetails.ts`, extend `AppDetailsResponse`:

```ts
interface AppDetailsResponse {
  id: string;
  name: string;
  status: SiteStatus;
  domains?: AppDomain[];
  variants?: string[];
  variantsWithLifecycle?: SiteVariant[];
  initial_prompt?: string;
  fqdn?: string;
  [key: string]: any;
}
```

**Why `fqdn` and not `purchasedDomain`.** The data is "an FQDN attached to this app at create time" — provenance is a separate concern. `purchasedDomain` would couple the variable to DPP's specific journey and rule out future entry points (user-owned domain, transferred domain, API-direct create) that want the same field without the purchase semantics. `fqdn` also matches downstream workflow naming (e.g., airo-provision). The existing `domains` field on the site record is the deployed-URL list — different concept, no collision. (Confirm the key choice with the DPP team before locking.)

### Step 2 — develop page: hydrate the auto-send gate from `site.initial_prompt`

The text-read path (`sitePromptForCurrentApp ?? getStoredInitialPrompt(initialJobId, appId)` on the `initialPromptText` derivation) already covers cold redirects — do not change it, and do not introduce a second control-plane source via `appDetails`. The actual gap is `context.hasInitialPrompt`, which `checkHasInitialPrompt` derives from sessionStorage flags only.

In `app/src/app/[market]/develop/hooks/useInitialization.ts`, change `checkHasInitialPrompt` (and its call sites in the initial state derivation and the post-RESET re-hydration effect) to also accept the current `site` and apply the `isSiteForCurrentApp(site, appId, realAppId)` staleness guard before consulting `site.initial_prompt`. Conceptually:

```ts
function checkHasInitialPrompt(
  initialJobId: string | null,
  appId: string | null,
  site: Site | null,
  realAppId: string | null,
): boolean {
  // existing sessionStorage checks unchanged...

  // Site-aware fallback: cold external redirect (DPP, future entry points) where
  // the home-flow flags were never written but the BFF returned a populated
  // site.initial_prompt for the current app.
  if (isSiteForCurrentApp(site, appId, realAppId) && site.initial_prompt) {
    return true;
  }

  return false;
}
```

Keep the auto-send guard otherwise unchanged — `!context.initialPromptSent` is the post-send latch (machine context, not sessionStorage) and must stay. The `state.matches({ ready: 'websocketConnected' })` and `context.isWebSocketConnected` predicates are unchanged.

**Cross-session re-send guard** — `site.initial_prompt` persists forever in mgmt-airo, so on a page refresh the BFF response is identical to a first-time DPP redirect; the in-context `initialPromptSent` latch resets on full reload, and the `messages.length === 0` check in `autoSendInitialMessage` races WS history loading. That race is exactly the regression PR #3925 reverted. Set `localStorage['initial-prompt-auto-sent-{appId}']` in `markInitialPromptSent` (the action runs in the auto-send `finally`, so it covers both success and failure paths) and read it in two places: `checkHasInitialPrompt`'s site-aware branch and the dedicated site-aware hydration effect — when the flag is set, skip dispatching `HYDRATE_APP { hasInitialPrompt: true }` so `determiningSubPhase` routes to `ready.active` and no auto-send fires. The flag is keyed by realAppId so it does not leak across apps. localStorage is the smallest cross-session signal that survives refresh in the same browser without a server-side change; the trade-off is that a different browser/device would re-send (acceptable — DPP normally redirects within the same session). Don't gate on `historyLoadingComplete && messages.length === 0` instead — that introduces a regression on the fresh DPP redirect because the WS history can land after `PAGE_DATA_LOADED` flips us into `ready.active`, and `HYDRATE_APP` cannot transition out of a final state.

The existing effect that syncs `site.initial_prompt → sessionStorage[initial-prompt-text-{site.id}]` already handles persisting the text for downstream `getStoredInitialPrompt` reads. We are _not_ adding a second sessionStorage write, a `setQuickCreateSessionFlags` mirror, or an `appDetails` fallback in the text path — the gate hydrates directly from the same `site` zustand source the text read already uses.

### Step 3 — first-message composition: prepend FQDN context

When `site.fqdn` is present, compose the first user message with a short, neutral preamble before auto-sending. Gating on FQDN presence alone is sufficient — the home-page flow doesn't write an FQDN, so a non-empty value indicates an external-entry redirect that wants the agent to know about the domain. Use the same `site` zustand source the rest of Step 2 reads from (not `appDetails`) so the source of truth stays consistent.

```ts
const fqdn = site?.fqdn?.toLowerCase();
const firstMessage = fqdn
  ? `This site is for ${fqdn}. ${initialPromptText}`
  : initialPromptText;
```

Lowercasing matches RFC-canonical FQDN form and how a domain reads naturally in prose; mgmt-airo doesn't enforce case-normalization on `variables` writes, so don't trust the read side.

The preamble is **provenance-neutral** — it tells the agent what the domain is, not how the user got it. If a future entry point needs DPP-specific framing ("just purchased on GoDaddy", which would unlock discount/upsell language in the design plan), introduce a separate `referrer` / `source` variable rather than overloading `fqdn`. For v1 the neutral form is sufficient and avoids the "wants to purchase" confusion mode noted below.

Done at the auto-send call site (the `pendingAutoSendRef` / `autoSendInFlightRef` setup in the develop page) — not at the agent. The default `agents/src/prompts/initial/1.0/core.md` already weaves ad-hoc URL/domain mentions into project details organically (its discovery-and-design-direction step doesn't need to be told about the new context shape).

Rationale for client-side preamble vs. agent-side context builder: zero agent changes, zero new sync surfaces, and the `app.variables` blob is not currently piped into the agent's local DB on Nomad allocation. The `apps` table in `agents/src/database/schema.ts` has no `variables` JSON column at all, so even if alloc-config were extended (it's a generic key reader via `getNomadAllocConfigValue`), there's nowhere to land the blob. Surfacing more context to the agent is a Phase 2 concern that should be designed on top of an explicit allocation-time variables passthrough, not bolted on.

**Reliability caveat — soft signal vs. structured intent.** The preamble is free text inside the user message. The initial agent has no explicit rule for "when you see `This site is for X`, treat X as the brand domain and skip the discovery question." LLMs are generally good at this organically, but this is a _soft signal_, not the same kind of _structured intent_ the existing prompt already uses elsewhere (e.g., `DOMAIN PURCHASE INTENT: yes` in the develop-agent handoff format at `agents/src/prompts/initial/1.0/core.md`, which has hardcoded follow-on behavior). Failure modes worth watching for in real traffic:

- Agent treats the FQDN as a feature request ("user wants a domain page") rather than a brand fact and asks redundant questions
- Agent ignores the preamble entirely on shorter prompts
- Agent invents a different brand name and uses the FQDN inconsistently

Two paths forward, in order of cost:

1. **Ship soft, observe.** Accept the soft signal, run external-entry traffic, evaluate whether the agent reliably weaves the FQDN into design direction without re-asking. Cheap to ship, cheap to back out. Recommended for v1 unless we see concrete failures fast.
2. **Promote to structured intent.** If empirical reliability is poor, add an explicit rule to `initial/1.0/core.md` along the lines of `BRAND FQDN: <name>` with hardcoded behavior (use as brand domain, derive project name from it unless the prompt says otherwise, skip the brand-name discovery question, weave into project details). The develop page would emit the structured token instead of natural-language prose. This crosses into prompt-engineering territory and is a real change to the initial-agent template — out of scope for the unblocking PR, but the natural next iteration if (1) underperforms.

### Step 4 — no double-send: both entry points already share `site.initial_prompt`

Day one, the home-page flow already populates `variables.initialPrompt` via `createSite` in `v2-control-plane-adapter.ts` (both the V2 add-app and signup paths set `variables: { initialPrompt: params.prompt, ... }`). DPP populates the same field via direct mgmt-airo write. So `site.initial_prompt` is set for both paths, and the existing `sitePromptForCurrentApp ?? getStoredInitialPrompt(...)` precedence in the text read already absorbs the overlap. The site-aware extension to `checkHasInitialPrompt` from Step 2 fires for both paths too — that's expected and not a duplicate-send bug. The actual refresh-safe guard is the durable `localStorage['initial-prompt-auto-sent-{appId}']` flag described in Step 6: `!context.initialPromptSent` is in-memory and any `conversationMessages.length === 0` check is best-effort hardening (WS history can land after the machine has flipped to `ready.active`), so neither survives a page reload on its own.

### Step 5 — length-clamping parity for control-plane-sourced prompts

The home page length-clamps the prompt before writing sessionStorage (`useHomepageSubmission.ts`); the WAF also enforces `MAX_PROMPT_BYTES` on home-page write traffic. DPP-sourced prompts come straight from mgmt-airo (no BFF write, no WAF), so apply the same clamp **inside `mapAppToSiteInfo`** when mapping `app.variables?.initialPrompt → site.initial_prompt`. Doing it at the BFF response keeps the contract uniform — every consumer of `site.initial_prompt` gets a bounded value, regardless of which read path (`sitePromptForCurrentApp` from zustand, `appDetails.initial_prompt` from react-query, future direct fetches) they use, and no new entry point has to reinvent the check.

## Verification

Manual end-to-end (the canonical happy path — DPP shape):

1. Use `./bin/mgmt hosting:app:create` with `variables.initialPrompt = "Build me a portfolio for a freelance illustrator"` and `variables.fqdn = "studiosketch.com"` to mimic DPP. Note the returned **jobId**.
2. Open `https://local.gasket.dev-godaddy.com:8443/develop/{jobId}?type=job` directly in a fresh browser tab (no prior sessionStorage).
3. Confirm the **job phase**: page shows "Provisioning..." UI; `GET /api/sites/{jobId}` returns the stub with no `initial_prompt`. The agent WS is not yet connected.
4. Wait for `realAppId` resolution → URL flips to `/develop/{realAppId}`.
5. Confirm the **app phase**:
   - `GET /api/sites/{realAppId}` includes `initial_prompt` and `fqdn`.
   - The develop page connects the websocket, ChatPane auto-sends `"This site is for studiosketch.com. Build me a portfolio for a freelance illustrator"` as the first user message.
   - Agent logs show the `agent_router.initial_selected` event with `agentId: 'initial', templateId: null` — confirms the design-focused 1.0 planner ran.
   - Agent calls `setProjectName`, `todoList`, `handoff` — confirms the standard initial → develop hand-off pipeline executed.
6. Reload the page after the agent has begun work. Confirm the prompt does NOT re-send. The reload guarantee is the `localStorage['initial-prompt-auto-sent-{appId}']` flag set in `markInitialPromptSent`'s `finally` block (covers both send-success and send-failure paths) — `checkHasInitialPrompt`'s site-aware branch and the dedicated site-aware hydration effect both consult it, so on reload `hasInitialPrompt` stays false and `determiningSubPhase` routes to `ready.active` with no auto-send. The `conversationMessages.length === 0` check is unreliable here because WS history can land after `PAGE_DATA_LOADED` flips the machine into `ready.active` (a `final` state that `HYDRATE_APP` cannot leave).

Regression — home-page flow:

1. Land on `/`, type a prompt, hit Create.
2. Confirm sessionStorage `initial-prompt-pending-{jobId}` and `in-creation-flow-{jobId}` are set by `setQuickCreateSessionFlags`, copied to the `{realAppId}` keys across the flip, and the existing sessionStorage branch of `checkHasInitialPrompt` returns true. The new site-aware branch added in Step 2 also returns true (because home traffic populates `site.initial_prompt` via the adapter), but the result is the same — auto-send fires once, the existing `!context.initialPromptSent` latch prevents a second send. End-to-end behavior identical to current main.

Automated:

- Add a unit test in `app/src/app/[market]/develop/hooks/__tests__/useInitialization.test.ts` covering the new site-aware branch: `sessionStorage flags empty, site.initial_prompt set, isSiteForCurrentApp passes → checkHasInitialPrompt === true`. Add a paired test for the staleness guard: `site.id !== appId && site.id !== realAppId → checkHasInitialPrompt === false` (cross-app contamination protection).
- Add a unit test for the domain-preamble composition: `fqdn set + control-plane prompt → composed first message has expected shape`.
- Add a control-plane-adapter unit test for the `fqdn` mapping.
- Add an E2E test under `tests/regression/` for the cold-redirect path: seed an app with mgmt-airo (or local-control-plane equivalent), navigate directly to `/develop/{jobId}?type=job`, assert the URL flips, the agent receives the composed first message, and `agent_router.initial_selected` fires.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` for the website package, plus the regression E2E.

## Out of scope / follow-ups

- **Job-phase variable surfacing.** mgmt-airo's `/api/airo/v1/jobs/{jobId}/apps` may already return partial app records with `variables` (the BFF currently discards them in `jobIdLookup` and returns a "Provisioning..." stub). If we ever want a richer loading-state UI ("Building your portfolio for studiosketch.com..."), surface `variables` in the job-phase response. Not needed for auto-send to work; skipped.
- **Agent-side `app.variables` passthrough.** Right now `variables` does not reach the agent process at all (no Nomad alloc-config wiring, no PATCH-driven sync). When more entry points need to pass richer first-turn context (subscription tier, brand book, GoDaddy product handle), the right move is to extend allocation-time env injection in mhp-core and add a context builder beside `buildDynamicDataMessage` (`agents/src/server/context-builders.ts`) that reads the agent's local apps row. Don't try to retrofit a runtime BFF→agent variables fetch — it'd add a new sync surface and round-trip on every first turn.
- **Hivemind/Switchboard cohort selection on `promptVersion`.** The variant routing inside the `if (!hasMessages)` branch of `agents/src/server/agent-router.ts` is profile-driven today. Adding entry-point or random-cohort selection (so DPP traffic could be A/B-tested against a future `prompt-enhancer` variant) is a separable initiative.
- **DPP-specific initial-agent template** under `agents/src/prompts/initial/templates/domain-purchase/`. We're starting with the same template as new-site, so this is parked. The slot is there if behavior eventually needs to diverge — pass `templateId='domain-purchase'` from DPP, drop a `manifest.json` under that directory, no router or factory change needed (the template-id branch in `agent-router.ts` and the auto-discovery in `agents/src/agents/ai-lib-agents/index.ts` pick it up).
- **`useAppDetails`'s `[key: string]: any` index signature.** Once direct callers exist for the new typed fields, drop the index signature so TypeScript actually catches drift between the BFF response shape and consumers. Out of scope for this PR — flagging so a future cleanup pass picks it up.

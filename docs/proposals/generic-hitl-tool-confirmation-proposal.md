---
title: "feat: generic human-in-the-loop (HITL) tool-confirmation primitive"
type: feat
status: proposed
date: 2026-06-07
origin: branch yhan1/publish-tool-confirmation — publish HITL one-off + reset-on-approval timeout fix
---

# feat: generic human-in-the-loop (HITL) tool-confirmation primitive

## Overview

Today the agent can only gate ONE operation behind explicit user approval — publish — and it does so with
publish-specific code embedded in the `publish` client-action executor. This plan generalizes that into a reusable
"this tool requires user confirmation before it runs" primitive declared on a tool definition and enforced by the
skill-tool framework, so any side-effecting tool (social post, destructive DB/commerce mutation, etc.) can opt in
without copying the publish wiring.

**This is a deferred design, not immediate work.** It should be built when the SECOND, structurally-different
consumer lands (see Trigger Condition). It is captured now so the context — and the specific trap to avoid — is
not lost.

## Problem Frame

The publish approval gate (added on branch `yhan1/publish-tool-confirmation`) is the harness's first and only HITL
gate. It works only because publish already round-trips to the browser as a `publish` client action, so the
approval modal could piggyback on that existing trip. The mechanism is publish-specific end-to-end:

- `app/src/hooks/websocket/actions/publishAction.ts` — `awaitAgentPublishApproval()` shows the modal and blocks the
  publish executor until the user approves/declines.
- `app/src/components/layout/AgentPublishConfirmationModal.tsx` — a publish-named modal.
- `app/src/stores/useDevelopPageStore.ts` — `agentPublishConfirmation: 'idle'|'pending'|'approved'|'cancelled'`.
- `agents/src/skills/publishing/tools/index.ts` + `agents/src/tools/publish-client-tool.ts` — a bespoke
  `cancelled` flag threaded through `PublishResult` so the agent treats a decline as a non-error.

The next likely HITL candidates are enumerated (for a different purpose) in
`packages/ai-transport/src/non-idempotent-tools.ts`: `socialPostPublish`, `manage_products`, `commerce_store_setup`,
`deleteRow`, `updateRow`, etc. **Almost all of these execute server-side / via the commerce MCP wrapper — they are
NOT browser client actions.** They therefore CANNOT reuse the publish browser-side gate. Copying `publishAction.ts`
for the second consumer would either fail (no browser round-trip to hang the modal on) or fragment the codebase
into N bespoke gates each with its own cancellation contract.

A marker comment in `publishAction.ts` (`awaitAgentPublishApproval` docblock) already documents this and points
here.

## Trigger Condition

Build this when a SECOND tool needs confirmation — ideally a **server-side** one (`socialPostPublish`, a destructive
commerce/database mutation). That consumer is the one that forces the design to answer the questions publish never
exercises (no browser round-trip; headless default). Do NOT generalize from publish alone — publish is the one case
that does not represent the population, so designing the "generic" primitive against it bakes in the wrong
assumptions (see Scope Boundaries / Key Decisions).

## Scope Boundaries

- **Not a refactor for its own sake.** Publish keeps working as-is until this lands; migrating publish is cleanup
  bundled into this work, not a separate prerequisite.
- **Confirm-then-act, not the publish shape.** The generic primitive uses a SEPARATE `confirm` client action
  followed by the tool's own execution — it does not embed approval inside the work action the way publish does.
- **Must define a headless/PaaS behavior.** PaaS has no builder UI, so a generic `confirm` round-trip has no human
  to ask. The primitive must specify a default (auto-approve, auto-deny, or a request-body opt-out) — this is the
  single biggest reason not to design against publish (AAB-only) alone.

## Context & Research

### What already exists and is reusable

- `packages/ai-skills/src/build-skill-tools.ts`
  - `SkillToolDefinition` (line ~16) with a `config` block already hosting cross-cutting knobs: `timeout`,
    `requiresApp`, `validate`, `stopAfter`. This is the natural home for a `requiresConfirmation` declaration.
  - The `execute:` wrapper inside `tool({...})` (lines ~238-275) is the central choke point where the framework
    runs `validate` → timeout race → `execute` → `computeState` for EVERY skill tool. This is where enforcement
    belongs (intercept before `toolDef.execute`).
- Generic agent→client round-trip (already in place):
  - `packages/ai-transport/src/client-action-registry.ts` — `ClientActionRegistry` (`executeAction`,
    `resolveAction`, `resetTimeout`).
  - `agents/src/services/ClientActionService.ts` — `IClientActionService` (shared WS + SSE surface;
    `executeAction`, `resetTimeout`, `getPendingRequestIds`, `cleanup`).
  - Browser dispatch: `app/src/hooks/websocket/handlers/ClientActionHandler.ts` (WS) and
    `app/src/hooks/useSSEChat.ts` (SSE `minimalContext`), keyed by the executor registry in
    `app/src/hooks/websocket/actions/` (`clientActionExecutors`).
- **The reset-on-approval reverse channel (added this branch) is a general primitive, independent of confirmation:**
  - `app/src/hooks/websocket/handlers/types.ts` — `MessageContext.resetActionTimeout?(requestId)`. The
    browser names WHICH pending action to refresh, never HOW LONG; there is deliberately no client-chosen
    duration in this protocol (the agent always reuses the action's original server-owned timeout).
  - WS wiring: `app/src/services/websocket/TransportSupervisor.ts` (`socket.emit('client_action_reset_timeout', …)`).
  - SSE wiring: `app/src/services/transport/SSETransport.ts` (`requestClientActionTimeoutReset`, best-effort) +
    the `POST .../actions/reset-timeout` route in `agents/src/server/sse/routes.ts`.
  - Agent listener: `ClientActionService` `client_action_reset_timeout` handler.

### Relationship to the reset-on-approval fix (important)

The reset-on-approval mechanism solves the shared-deadline problem WITHIN a single client action that both waits for
a human and then does work (publish's current shape). **Confirm-then-act dissolves that problem structurally:** the
`confirm` action has its own short timeout and the tool's execution starts only after approval, with its own fresh
timeout. So under this design, the reset hack becomes OPTIONAL for publish (publish would migrate to confirm-then-act
and no longer need it). The `resetActionTimeout` primitive remains useful for any *other* single long-running client
action that legitimately interleaves human input and work — it is not wasted, just no longer load-bearing for
publish.

## Proposed Design

1. **Declaration** — add to `SkillToolDefinition.config` in `build-skill-tools.ts`:
   ```ts
   requiresConfirmation?:
     | boolean
     | ((input: any, context: any) => boolean | { title: string; message: string })
   ```
   Sits beside `validate`/`timeout`/`stopAfter` — same altitude, same declarative style.

2. **Enforcement** — in the `execute` wrapper (build-skill-tools.ts), immediately after `validate` and BEFORE
   `toolDef.execute`: if `requiresConfirmation` resolves truthy, dispatch a generic `confirm` client action and
   await it. On decline, short-circuit to a canonical cancellation result (e.g. `{ confirmed: false }`) WITHOUT
   calling `toolDef.execute` — so no side effect starts. On approve, fall through to normal execution.

3. **Round-trip** — a generic `confirm` client action (its own browser executor `confirmAction` registered in
   `clientActionExecutors`) that renders a parameterized `ToolConfirmationModal` (generalize
   `AgentPublishConfirmationModal`) from `{ title, message }` and resolves with the user's choice. Reuses the
   existing `ClientActionService.executeAction` round-trip; no new transport plumbing required for the happy path.
   Inject the confirmation capability into the skill-tool framework via `SkillRegistrationOptions` (same pattern as
   `onStateComputed`), not read ad hoc off `context`.

4. **Headless/PaaS default** — the confirmation injection point resolves a default when no interactive client is
   connected: auto-approve, auto-deny, or honor a request-body opt-out. Decide per product requirement.

5. **Canonical cancellation contract** — one `{ confirmed: false }` shape returned to the agent, replacing publish's
   bespoke `cancelled` flag. The agent loop / tool layer treats it as a non-error "not done, don't retry".

## Migration of publish

- Replace `awaitAgentPublishApproval` in `publishAction.ts` with `requiresConfirmation` on the publish tool
  definition.
- Generalize `AgentPublishConfirmationModal` → `ToolConfirmationModal`; drop the publish-specific
  `agentPublishConfirmation` store state in favor of generic confirm state keyed by requestId.
- Remove the `cancelled` flag from `PublishResult` in favor of the canonical `{ confirmed: false }`.
- Re-evaluate publish's `resetActionTimeout` usage: under confirm-then-act it is no longer required (the confirm
  and publish actions have independent timeouts). Keep `resetActionTimeout` as a general primitive but unwire it
  from publish if confirm-then-act makes it redundant.

## Open Questions

- **Headless/PaaS default:** auto-approve, auto-deny, or request-body opt-out? (Product decision; the deciding
  consumer should drive this.)
- **Where does the confirmation capability live** — `SkillRegistrationOptions` injection (preferred, mirrors
  `onStateComputed`) vs. on the tool execution `context`?
- **Confirm-then-act vs. reset-on-approval for tools that genuinely interleave** human input and work mid-execution
  (rare). Confirm-then-act covers the common "approve, then run" case; reset stays for the interleaved case.
- **Non-idempotent-tools overlap:** once a declined confirmation prevents the side effect from starting,
  `non-idempotent-tools.ts` (retry-vs-continue safety) becomes less load-bearing for confirmed tools — worth
  revisiting that list during this work.

## Implementation Units

- [ ] **Unit 1: Declare `requiresConfirmation` on `SkillToolDefinition`** — type + docs in
  `packages/ai-skills/src/build-skill-tools.ts`; no behavior yet.
- [ ] **Unit 2: Generic `confirm` client action + `ToolConfirmationModal`** — browser executor + parameterized modal
  (generalize `AgentPublishConfirmationModal`); generic confirm state in `useDevelopPageStore` keyed by requestId.
- [ ] **Unit 3: Enforce in the execute wrapper** — dispatch `confirm` before `toolDef.execute`; inject the
  confirmation service via `SkillRegistrationOptions`; canonical `{ confirmed: false }` short-circuit.
- [ ] **Unit 4: Headless/PaaS default** — resolve confirmation when no interactive client is connected.
- [ ] **Unit 5: Onboard the triggering second consumer** (e.g. `socialPostPublish`) via `requiresConfirmation`.
- [ ] **Unit 6: Migrate publish** off the one-off (remove `awaitAgentPublishApproval`, the bespoke `cancelled`
  flag, and the publish-specific modal/store state); re-evaluate `resetActionTimeout` usage.
- [ ] **Unit 7: Tests** — confirm-then-act happy path + decline (WS + SSE), headless default, publish parity after
  migration, and the canonical cancellation contract.

## Risks & Dependencies

- **Premature generalization risk** is the headline risk and the reason for the Trigger Condition: designing from
  publish alone yields an abstraction wrong for server-side / headless consumers.
- Depends on the existing client-action round-trip (`ClientActionService`/`ClientActionRegistry`) and the
  skill-tool execute wrapper — both already in place.
- Touches two packages (`@airo/ai-skills` + `app`) plus `agents`; the confirm round-trip must be consistent across
  WS and SSE (per `packages/ai-transport/CLAUDE.md`: a fix landing in only one transport is a bug).
- E2E: a generalized modal changes `data-testid`s currently referenced for the publish confirmation flow — update
  `tests/e2e/` and `tests/regression/` per the root CLAUDE.md UI-change rule.

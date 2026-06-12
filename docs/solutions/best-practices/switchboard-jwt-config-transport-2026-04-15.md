---
title: Switchboard JSON config through a JWT claim (built, reverted, cautionary)
date: 2026-06-11
last_updated: 2026-06-11
category: best-practices
module: budget-judge
problem_type: best_practice
component: authentication
severity: medium
applies_when:
  - Considering routing structured JSON config from Switchboard to agents via a JWT claim
  - Evaluating whether to extract hardcoded values into remote/per-session config
  - Reviewing a design that packs config into agentContext on the JWT
tags:
  - switchboard
  - jwt-claims
  - feature-flags
  - agent-config
  - websocket
  - configuration
  - cautionary
  - superseded
---

# Switchboard JSON config through a JWT claim (built, reverted, cautionary)

## Status: do not rebuild this

This document used to recommend an end-to-end pattern for wiring Switchboard
JSON config into the agents service through a JWT claim, using the judge
discount config as the worked example: `appbuilder-judge-config` flag ->
`judgeConfigRaw` JWT claim -> `parseJudgeConfig` -> `createJudgeAgent`.

That pattern was BUILT and then REVERTED before it ever ran in production. The
revert is the decision of record:
`docs/solutions/best-practices/judge-config-revert-premature-abstraction-2026-04-15.md`.

Every named hook from the original recommendation has been deleted from the
codebase. As of 2026-06-11, `judgeConfigRaw`, `parseJudgeConfig`,
`createJudgeAgent`, and the `appbuilder-judge-config` flag return zero matches
across `agents/src` and `app/src`. The judge agent is back to hardcoded
thresholds and the `getJudgeAgent()` singleton.

Do not treat this as a recommended approach. If you are tempted to wire
structured config from Switchboard through a JWT claim, read the revert doc
first. Its short version: start hardcoded, and extract to remote config only
once production evidence demands it (values changed >= 2 times, or a real need
for per-session/per-customer variation). If agents genuinely need remote
config, prefer having agents fetch it directly once at session start over
threading it through BFF -> JWT -> agents.

## Why it was reverted

The judge config was never changed in production and the thresholds move
quarterly at most, so the transport infrastructure carried cost for zero value.
The revert deleted ~773 net lines. See the revert doc for the full accounting.

The remainder of this document is preserved only as a cautionary reference: if
you ever do pack config into a JWT claim, these are the generic pitfalls that
bit this implementation. They are general properties of the JWT/Switchboard
transport surface, not endorsements of the reverted design.

## Generic pitfalls if you ever route config through a JWT claim

These mechanisms still exist in the codebase and are general to JWT/Switchboard
transport (`getCacheKey`, `resolveStringFlag`, `agentContext`,
`checkSwitchboardValue`, `SERVER_LOCAL_VALUE_OVERRIDES`).

1. **Cache key must include ALL variable fields.** `getCacheKey()` keys the
   minted token. If a config field is not part of the key, a cached token
   returns stale config after Switchboard updates. Forgetting a field means
   tokens are silently cached by siteId/permissions only.

2. **String-flag resolution filters sentinel values.** `resolveStringFlag`
   maps `'default'` to `undefined`. That is correct for a model name where
   `'default'` means "use the system default", but it silently drops a JSON
   payload. Structured config needs custom extraction plus a non-JSON guard
   (for example `.startsWith('{')`) so `JSON.parse()` cannot throw on an
   arbitrary Switchboard string.

3. **agentContext vs socket.data is a real distinction.** JWT-derived,
   auth-scoped config belongs on `socket.handshake.auth.agentContext`.
   `socket.data` is for transient, connection-scoped timing metadata only
   (for example `connectTime`). Putting auth-scoped config on `socket.data`
   breaks the established pattern.

4. **JWT size limit (~4KB) is a hard ceiling.** The practical JWT limit across
   browsers and proxies is roughly 4KB, and the token is sent on every request.
   Each new claim narrows that margin. Anything approaching ~1KB of config, and
   certainly large payloads like prompt templates, does not belong in a JWT.
   Fetch it directly instead.

5. **Parsing must fail safe.** Anything arriving via a Switchboard-sourced JWT
   claim can be malformed. A parse/validation failure has to degrade to a safe
   default, never crash the agents service.

6. **Local override has no compile-time link to the real default.** A hardcoded
   JSON value in `SERVER_LOCAL_VALUE_OVERRIDES` has no type-level enforcement
   against drift from whatever the production default is, so the two silently
   diverge.

## Related

- `docs/solutions/best-practices/judge-config-revert-premature-abstraction-2026-04-15.md` -- the decision of record; why this was reverted (premature abstraction / YAGNI)
- `docs/solutions/developer-experience/feature-flag-websocket-relay-pattern-2026-03-31.md` -- earlier WS relay approach for flags
- `docs/solutions/developer-experience/feature-flag-layer-selection-2026-04-01.md` -- Switchboard vs features.ts distinction, local override setup
- `docs/solutions/logic-errors/websocket-onmessagestart-context-metadata-timing-2026-04-13.md` -- why agentContext (JWT claims) is preferred over context.metadata

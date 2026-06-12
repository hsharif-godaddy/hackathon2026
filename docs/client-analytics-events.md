# Client Analytics Events

Reference for all client-side analytics events in the Airo App Builder UI. Three pipelines are used:

- **Elasticsearch** via `shipAnalyticsLog` — all events prefixed with `client.` in ES
- **FullStory / CSP** via `logImpressionEvent` / `logClickEvent` / `logActionEvent` — pushed to `window._expDataLayer`
- **AiroHQ** via `logAiroHQEvent` — pushed to `window._expDataLayer`, consumed by GoDaddy recommendation engine

---

## Context Fields

These fields are **automatically injected into every event on both ES and FS pipelines** without callers needing to pass them. Set when entering the develop page, cleared on unmount. All 6 fields flow through `getSharedInstrumentationContext()` — adding a new field here requires only one change in `instrumentation.ts`.

| Field | Values | Description |
|---|---|---|
| `appId` | nanoid string (8–128 chars) | Primary join key across all events. UUID-shaped values are rejected to prevent job IDs leaking in. |
| `entry_point` | See table below | How the user arrived at this app session. |
| `plan_type` | `none` · `free` · `airoPlus` · `starter` · `professional` · `ultimate` | User's subscription plan via `getEffectivePlan()`. Legacy AiroPlus users on Starter map back to `airoPlus`. |
| `creation_source` | See table below | How the app was originally created. |
| `intent_category` | `new_build` · `edit` · `rebuild` | Current build intent. Starts as `new_build` in create-flow, switches to `edit` after first build, switches to `rebuild` when rebuild tools fire. Caller-provided value wins over session baseline. |
| `business_name` | string | Project name — set when `setProjectName` tool completes. |

**`entry_point` values (priority order):**

URL params are resolved first (`resolveEntryPoint`), then sessionStorage (set at creation time). At develop-page load, `useInstrumentationPrimer` reads the stored value; return visits override with `my_apps`.

| Value | When |
|---|---|
| GoDaddy pathname | `?location=<url>` — parent URL is a godaddy.com host; pathname extracted and sanitized (e.g. `products/websites/builder`) |
| `?itc` param value | URL contains `?itc=...` (sanitized, max 64 chars) |
| `?site_location` param value | URL contains `?site_location=...` (sanitized, max 64 chars) |
| `aab_homepage` | Submitted from the homepage (fallback when no URL param matches) |
| `aab_landing_page` | Submitted from an explore/landing page |
| `create_route` | Created via partner / create route |
| `my_apps` | Navigated from the My Apps page |
| `direct_nav` | Fallback — opened directly without a recorded creation entry point |

**`creation_source` values:**

| Value | When |
|---|---|
| `free_text` | User typed a free-text prompt |
| `example_selected` | User selected an example/template |
| `design_file` | User uploaded a design file |
| `code_import` | User uploaded a zip/code archive |
| `ui_kit_import` | User uploaded a UI kit file |
| `logo_design` | Created from logo designer flow |
| `business_plan` | Created from business plan template |
| `partner_handoff` | Created via partner/create route handoff |
| `my_apps` | Navigated back from My Apps |

---

## Elasticsearch Events (`shipAnalyticsLog`)

### Develop Page Lifecycle

| Event | Fires when | Key fields |
|---|---|---|
| `funnel.develop_page.loaded` | Develop page mounts and `appId` resolves — fires at most once per page mount — ES only | `appId`, `source` (`quick-create` or `direct-nav`) |
| `funnel.chat_loader.hidden` | Chat loader overlay hides (user can now see chat) — create-flow only — ES only | `appId`, `phase`, `subPhase` |

### WebSocket Connection

ES only — no FS counterparts.

| Event | Fires when | Key fields |
|---|---|---|
| `funnel.ws.token_acquired` | Agent JWT successfully obtained before WS connect | `appId` |
| `funnel.ws.token_failed` | Agent JWT fetch failed | `appId`, error details |
| `funnel.ws.connected` | WebSocket connection established and authenticated | `appId` |
| `funnel.ws.connect_failed` | WebSocket connection failed (all retry attempts exhausted) | `appId`, error details |

### Initial Build Funnel

Tracks the create-flow from prompt submission to first post-build interaction. Only active for apps created from the homepage/landing page. Each event fires **at most once per create-flow session** (idempotent).

| Event | Fires when | Key fields |
|---|---|---|
| `funnel.initial_prompt.sent` | Auto-send of the initial prompt fires (create-flow only) — ES only | `appId`, `promptLength` |
| `funnel.initial_build.started` | `activateInitialBuildFunnel` called — same moment as initial prompt | `appId` |
| `funnel.first_response.rendered` | First assistant message with content appears in the UI — ES only | `appId`, `messageId`, `hasContent`, `hasToolCalls` |
| `funnel.initial_build.question_received` | Agent calls `askQuestion` or `suggestedResponse` for the first time — ES only | `appId` |
| `funnel.initial_build.handoff` | `handoff` tool fires — agent transitions from Q&A to generation | `appId` |
| `funnel.initial_build.complete` | First completion event with a `commitHash` (code committed to git) | `appId`, `commitHash` |
| `funnel.initial_build.post_interaction` | First user-initiated message after build is complete — ES only | `appId` |

**`commitHash`** — git SHA of the generated artifact. Join key to link the build event to a specific website output.

### Chat / Prompt

| Event | Fires when | Key fields |
|---|---|---|
| `chat.prompt.sent` | User submits any message (create-flow and edit sessions) — ES only | `appId`, `promptLength`, `source` (`user-input` or `suggestion`), `hasEditContext`, `hasSelectedAsset`, `hasBuildErrorContext`, `hasReferencedFiles` |
| `funnel.user_first_message.sent` | First user-initiated message in a create-flow session (not the auto-sent prompt) — ES only | `appId`, `promptLength` |
| `funnel.edit.triggered` | User submits a message when `intent_category === 'edit'` — ES counterpart to `develop.edit.triggered` | `appId`, `promptLength`, `artifactHash` (optional) |

### Context Gathering

Tracks when the agent enters and exits the Q&A phase. Can fire multiple times per session (once per turn that involves questions).

| Event | Fires when | Key fields |
|---|---|---|
| `funnel.context_gathering.started` | First question tool (`askQuestion` / `suggestedResponse`) arrives in a turn | `appId` |
| `funnel.context_gathering.completed` | A non-gather action tool fires after gathering started, or stream ends while gathering | `appId` |

### Rebuild

| Event | Fires when | Key fields |
|---|---|---|
| `funnel.rebuild.started` | `websiteRebuild` tool_call arrives | `appId`, `priorArtifactHash` (commit hash before rebuild, optional) |

**`priorArtifactHash`** — git commit hash before the rebuild. Enables joining "before" and "after" artifact states.

### Publish

| Event | Fires when | Key fields |
|---|---|---|
| `publish.attempted` | Every publish attempt regardless of outcome | `appId`, `trigger`, `blockedReason` (optional), `commitHash` (optional) |
| `publish.success` | Deployment polling reaches `DEPLOYED` status | `appId`, `commitHash`, `isFirstPublish` |
| `publish.failed` | Deployment polling reaches `FAILED` status | `appId`, `commitHash`, `failureReason` |
| `publish.limit.modal.shown` | Publish limit modal shown to user | `appId` |
| `publish.limit.modal.dismissed` | User dismisses publish limit modal | `appId` |
| `publish.limit.modal.upgrade_clicked` | User clicks upgrade in publish limit modal | `appId` |

**`trigger`** — `'ui'` (user clicked publish) or `'agent'` (agent-triggered publish).

**`blockedReason`** — present only on blocked attempts:
- `site_suspended` — site is suspended (`PublishComplianceBlockReason.SiteSuspended`)
- `subscription_non_compliant` — subscription violates compliance rules (`PublishComplianceBlockReason.SubscriptionNonCompliant`)
- `gate_blocked` — DNS conflict or other gate check failed (UI path only)
- `paywall_denied` — no eligible subscription or publish limit reached
- `auth_required` — auth preflight failed (agent path only)

**`isFirstPublish`** — `true` if this is the first deployment for this app.

**`failureReason`** — from `deployment.metadata.errorMessage` or `deployment.job.errorMessage`, truncated to 200 chars.

### App Generation Feedback

| Event | Fires when | Key fields |
|---|---|---|
| `appGeneration.feedback.submit` | User submits thumbs up/down on the generation feedback banner | `appId`, `feedback` (`thumbs_up` / `thumbs_down`) |

---

## FullStory / CSP Events (`logImpressionEvent` / `logClickEvent` / `logActionEvent`)

Wire format: `appbuilder.{product}.{section}.{widget}.{impression|click|load}`

### Develop Page

| EID | Type | Fires when |
|---|---|---|
| `develop.page.view` | impression | Develop page mounts (every mount) |

### Initial Build Funnel

Maps 1:1 with the ES funnel events above. Join via `appId`.

| EID | Type | Fires when | ES counterpart |
|---|---|---|---|
| `develop.initialBuild.start` | impression | Create-flow begins | `funnel.initial_build.started` |
| `develop.generation.triggered` | impression | Agent transitions from Q&A to generation (`handoff` tool) | `funnel.initial_build.handoff` |
| `develop.firstBuild.complete` | action (`load`) | First build commits to git | `funnel.initial_build.complete` |

**Generation funnel (join key: `appId`):**

```
develop.initialBuild.start        ← create flow begins
  → develop.generation.triggered  ← generation starts (post context gathering)
    → develop.firstBuild.complete ← generation completes
```

### Context Gathering

| EID | Type | Fires when | ES counterpart |
|---|---|---|---|
| `develop.contextGathering.started` | impression | Q&A phase begins | `funnel.context_gathering.started` |
| `develop.contextGathering.completed` | impression | Q&A phase ends | `funnel.context_gathering.completed` |

### Rebuild

| EID | Type | Fires when | Extra fields |
|---|---|---|---|
| `develop.rebuild.started` | impression | Rebuild tool fires | `priorArtifactHash` (optional) |
| `develop.rebuild.intakewaiting` | impression | Rebuild enters `awaiting_intake` (before scope estimates load) | `sourceUrl` |
| `develop.rebuild.intakeform` | impression | Rebuild intake form renders (scope + design) | `sourceUrl` |
| `develop.rebuild.intakeform.error` | impression | Scope estimates failed or returned empty while awaiting intake | `sourceUrl`, `reason` (`fetch_failed` \| `empty_estimates`) |
| `develop.rebuild.intakesubmit` | click | User clicks **Start rebuild** on intake form | `scope`, `designChoice`, `designDirection`, `submitSource` (`submit`), `sourceUrl` |
| `develop.rebuild.intakedefaults` | click | User clicks **Use recommended defaults** | `scope` (`homepage_only`), `designChoice` (`keep_similar`), `designDirection` (`keep-similar`), `submitSource` (`defaults`), `sourceUrl` |
| `develop.rebuild.intaketimeout` | impression | Backend auto-applies defaults after 10-minute intake wait | `scope` (`homepage_only`), `designChoice` (`keep_similar`), `designDirection` (`keep-similar`), `submitSource` (`timeout`), `sourceUrl` |

**Intake selection fields (product reporting):**

- **`scope`** — `homepage_only` \| `small` \| `large`
- **`designChoice`** — UI radio id: `airo_decide` \| `keep_similar` \| `modernize` \| `simplify` \| `bold`
- **`designDirection`** — value sent to agents API (`airo_decide` maps to `keep-similar`)

### Edit

| EID | Type | Fires when | Extra fields |
|---|---|---|---|
| `develop.edit.triggered` | impression | User submits a message when `intent_category === 'edit'` | `promptLength`, `artifactHash` (optional) |

**`promptLength`** — character count of the user's message.

**`artifactHash`** — current git commit hash at prompt time. Links the edit to a specific artifact state.

### Publish

| EID | Type | Fires when | Extra fields |
|---|---|---|---|
| `develop.publish.attempt` | impression | Every publish attempt (blocked or proceeded) | `trigger`, `blockedReason` (optional), `commitHash` (optional) |
| `develop.publish.first_publish_success` | impression | Deployment reaches `DEPLOYED` — first publish | `commitHash`, `isFirstPublish: true` |
| `develop.publish.publish_success` | impression | Deployment reaches `DEPLOYED` — repeat publish | `commitHash`, `isFirstPublish: false` |
| `develop.publish.failed` | impression | Deployment reaches `FAILED` | `failureReason` |

### Credits

| EID | Type | Fires when |
|---|---|---|
| `credits.usage.consumed` | impression | A stream turn completes and the turn had usage (credits were consumed) |

### Tool Tracking

| EID | Type | Fires when |
|---|---|---|
| `develop.tool.start` | impression | Stream starts (first token received) |
| `develop.tool.complete` | impression | Stream completes successfully |
| `develop.tool.error` | impression | Stream ends with an error |
| `develop.tool.{toolName}` | impression | A specific tool result arrives (one per tool in the turn) |

---

## AiroHQ Events (`logAiroHQEvent`)

Consumed by the GoDaddy AiroHQ recommendation engine to track task completion signals.

### Develop Page View

| Fires when | `recommendation_task` | `category` |
|---|---|---|
| Develop page mounts | `builder_develop_page_view` | `impression` |

### Prompt Submit

| Fires when | `recommendation_task` | `recommendation_type` | `category` |
|---|---|---|---|
| User submits any message | `builder_develop_prompt_submit` | `user_prompt` | `click` |

### Publish

| Fires when | `recommendation_task` | `completedTask` | `category` |
|---|---|---|---|
| UI publish attempt — first publish | `builder_project_first_published` | `false` | `click` |
| UI publish attempt — repeat publish | `builder_project_published` | `false` | `click` |
| Agent publish attempt — first publish | `builder_project_first_published` | `false` | `click` |
| Agent publish attempt — repeat publish | `builder_project_published` | `false` | `click` |
| Deployment `DEPLOYED` — first publish | `builder_project_first_published` | `true` | `impression` |
| Deployment `DEPLOYED` — repeat publish | `builder_project_published` | `true` | `impression` |

For every successful publish, AiroHQ fires twice — at attempt (`completedTask: false`) and at deployment confirmation (`completedTask: true`).

### Fields

| Field | Description |
|---|---|
| `ai_agent_id` | Always `'app-builder'` |
| `category` | `'click'` at user-action time; `'impression'` at system-confirmed completion |
| `recommendation_task` | Task identifier — see tables above |
| `recommendation_type` | `'publish'` or `'user_prompt'` or `'navigation'` |
| `recommendation_id` | The `appId` |
| `completedTask` | `false` at attempt; `true` when confirmed complete |

---

## Event Sources

| File | Events |
|---|---|
| `app/[market]/develop/[id]/page.tsx` | `funnel.develop_page.loaded` · `funnel.chat_loader.hidden` · `funnel.initial_prompt.sent` · `develop.page.view` · AiroHQ page view |
| `hooks/shared/initialBuildFunnel.ts` | `funnel.initial_build.*` · `develop.initialBuild.start` · `develop.generation.triggered` · `develop.firstBuild.complete` |
| `hooks/shared/contextGatheringTracker.ts` | `funnel.context_gathering.*` · `develop.contextGathering.*` |
| `hooks/shared/toolSideEffects.ts` | `funnel.rebuild.started` · `develop.rebuild.started` |
| `app/.../rebuild/RebuildIntakeForm.tsx` | `develop.rebuild.intakewaiting` · `develop.rebuild.intakeform` · `develop.rebuild.intakeform.error` · `develop.rebuild.intakesubmit` · `develop.rebuild.intakedefaults` · `develop.rebuild.intaketimeout` |
| `app/.../tool-renderers/WebsiteRebuildToolRenderer.tsx` | `develop.rebuild.intaketimeout` (backup when user returns after timeout) |
| `components/chat/ChatPane.tsx` | `chat.prompt.sent` · `funnel.user_first_message.sent` · `funnel.edit.triggered` · `develop.edit.triggered` · AiroHQ prompt submit |
| `components/StreamingMessageList.tsx` | `funnel.first_response.rendered` |
| `components/layout/AppPublish.tsx` | `publish.attempted` · `develop.publish.attempt` · AiroHQ publish (UI path) |
| `hooks/websocket/actions/publishAction.ts` | `publish.attempted` · `develop.publish.attempt` · AiroHQ publish (agent path) |
| `hooks/useDeploymentsQuery.ts` | `publish.success` · `publish.failed` · `develop.publish.*_success` · `develop.publish.failed` · AiroHQ publish completion |
| `hooks/websocket/useWebSocketHelpers.ts` | `develop.tool.*` impression events |
| `services/websocket/ConnectionManager.ts` | `funnel.ws.*` |
| `components/chat/banners/AppGenerationFeedbackBanner.tsx` | `appGeneration.feedback.submit` |
| `app/[market]/develop/hooks/useInstrumentationPrimer.ts` | Sets all 6 context fields on develop page mount |

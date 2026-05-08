# Initial Build Funnel Events

Events tracking the initial app creation flow from prompt submission through first post-build interaction.

## Event Summary

| #   | Event                                              | Pipeline                       | Fires when                                                          |
| --- | -------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| 1   | `funnel.initial_build.started`                     | shipAnalyticsLog (ES)          | Initial prompt auto-sent in create-flow                             |
| 1   | `appbuilder.develop.initialBuild.start.impression` | logImpressionEvent (FullStory) | Same as above (Hivemind entry point)                                |
| 2   | `funnel.initial_build.question_received`           | shipAnalyticsLog (ES)          | Agent calls `askQuestion` or `suggestedResponse` for the first time |
| 3   | `funnel.initial_build.handoff`                     | shipAnalyticsLog (ES)          | `handoff` tool completes (InitialAgent → DevelopAgent)              |
| 4   | `funnel.initial_build.complete`                    | shipAnalyticsLog (ES)          | First `complete` event with a `commitHash` (code committed)         |
| 4   | `appbuilder.develop.firstBuild.complete.custom`    | logActionEvent (FullStory)     | Same as above                                                       |
| 5   | `funnel.initial_build.post_interaction`            | shipAnalyticsLog (ES)          | First user-initiated message after build complete                   |

## Flow Diagram

```
User submits prompt on homepage
        │
        ▼
[1] funnel.initial_build.started
        │
        ▼
Agent asks onboarding questions (optional)
        │
        ▼
[2] funnel.initial_build.question_received  (first question only)
        │
        ▼
User answers questions → agent builds handoff prompt
        │
        ▼
[3] funnel.initial_build.handoff
        │
        ▼
DevelopAgent builds the homepage, commits code
        │
        ▼
[4] funnel.initial_build.complete
        │
        ▼
User sees preview, interacts with agent
        │
        ▼
[5] funnel.initial_build.post_interaction
```

## Behavior

- All events are **idempotent** — each fires at most once per create-flow session.
- The funnel is only active during create-flow sessions (app created from homepage). Direct navigation to `/develop` does not activate it.
- Events 2 and 3 may be skipped if the agent doesn't ask questions (e.g., template-based builds that go straight to handoff).
- Event 4 requires a git commit — if the agent turn completes without committing, this event won't fire until a subsequent turn commits.
- Event 5 only fires after event 4 has fired (build must be complete first).

## Querying

### Elasticsearch (Kibana)

All `shipAnalyticsLog` events are prefixed with `client.` in ES:

```
client.funnel.initial_build.started
client.funnel.initial_build.question_received
client.funnel.initial_build.handoff
client.funnel.initial_build.complete
client.funnel.initial_build.post_interaction
```

Each includes `appId` in the data payload. Event 4 also includes `commitHash`.

### FullStory

- Impression: `appbuilder.develop.initialBuild.start.impression` — use for Hivemind experiment cohort entry
- Action: element `{area: appbuilder, product: develop, section: firstBuild, widget: complete, action: custom}` — fires on build complete

## Implementation

State tracked in `app/src/hooks/shared/initialBuildFunnel.ts` (module-level singleton). Wired into:

| Location                                                    | Purpose                               |
| ----------------------------------------------------------- | ------------------------------------- |
| `app/src/app/[market]/develop/[id]/page.tsx`                | Activates funnel on auto-send         |
| `app/src/hooks/shared/toolSideEffects.ts`                   | Detects question/handoff tool results |
| `app/src/hooks/shared/completionSideEffects.ts`             | Detects first commit on completion    |
| `app/src/hooks/websocket/handlers/CompleteHandler.ts`       | WS transport completion               |
| `app/src/hooks/useSSEChat.ts`                               | SSE transport completion              |
| `app/src/app/[market]/develop/components/chat/ChatPane.tsx` | Post-build interaction                |

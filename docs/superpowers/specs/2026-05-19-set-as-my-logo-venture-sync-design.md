# "Set as my logo" — Square + Horizontal Sync to Venture Home

**Date:** 2026-05-19
**Scope:** logo-designer template, media-logo skill, app tool renderers
**Status:** Implemented (PR #3881)

## Post-merge corrections

Two divergences from the as-written spec, decided during implementation
and validated in PR #3881 review. The body below is unchanged for history.

- **i18n strings:** the spec proposed `t(key, undefined, 'fallback')` so the
  renderer could ship before the keys existed in the i18n portal. That does
  not actually bypass `scripts/validate-i18n.mjs`, which AST-parses every
  `t('...')` call against the published key set and rejects unknown keys
  regardless of fallback args. The renderer therefore ships with inline
  English strings and a `TODO(i18n)` comment pointing at the portal URL.
  Once the keys are published, swap to `t()`. Tracked as Task 6 of the
  implementation plan.
- **Renderer success-reporting:** the spec said "after both sent: phase =
  'done'", which would have surfaced "Logo saved to your dashboard." even
  if both `fetchAsDataUrl` calls rejected and zero postMessages were made.
  The shipped renderer counts successful posts and surfaces a `'done'`
  state only when at least one variant reached the parent; zero successes
  surface a `'error'` state with retry copy.

## Problem

When a user finishes the logo-designer flow inside the embedded Airo Builder, they currently end on an `askQuestion` whose final option is "Use this logo". Picking it does nothing automated — the agent just says a confirmation, relying on the per-logo "Set as logo" button rendered after Step 6d. Clicking that button posts a single `set-as-logo` message to Venture Home with the **horizontal** logo only.

Two consequences:

1. The Venture Home dashboard renders that horizontal logo squished into a square slot.
2. The "set" UX is split across two surfaces (the `askQuestion` answer and the per-logo button).

## Goal

When the user picks the final option in the logo-designer `askQuestion`, the flow should:

1. Read clearly as "Set as my logo".
2. Generate a square companion of the user's current logo via `media-logo__edit_logo`.
3. Push **both** the existing horizontal and the new square versions to Venture Home (two `set-as-logo` postMessages, both as data URLs).
4. Confirm in chat that the logo has been set.
5. Trust the existing Venture Home / image-library hook to surface the square version on the dashboard. We do not change Venture Home in this work.

## Non-goals

- Updating Venture Home (`vnext-dashboard`). Anything past `MediaLibraryModal.handleIframeMessage` is out of scope.
- Setting `venture.logoUrl` directly. We assume the receiving side picks the square asset and promotes it.
- Refactoring `LogoActionsToolRenderer` or removing the per-logo button surfaced from Step 6d. That button keeps working; it just doesn't drive this new flow.
- Anything for non-embedded users. The renderer reports a brief notice and skips postMessages — it does not attempt a workaround.

## Current state (relevant pieces only)

| Concern | File |
| --- | --- |
| Final askQuestion options | `agents/src/prompts/initial/templates/logo-designer/core.md:248-267` |
| Logo-edit tool (auto-resolves source from slot) | `agents/src/skills/media-logo/tools/index.ts` `editLogoTool` |
| Slot constants — `logo/horizontal`, `logo/primary` (square) | `agents/src/skills/media-logo/tools/index.ts` `LOGO_SLOT_PATHS` |
| Existing offer-actions tool (single URL → button → postMessage) | `agents/src/skills/media-logo/tools/index.ts` `offerLogoActionsTool` |
| Existing renderer (button, single URL) | `app/src/app/[market]/develop/components/tool-renderers/LogoActionsToolRenderer.tsx` |
| Tool name → renderer mapping | `app/src/app/[market]/develop/components/tool-renderers/index.ts:102` |
| postMessage receiver (data-URL only) | `vnext-dashboard/src/features/VentureHome/components/LogoModals/MediaLibraryModal.js:105-121` |

## Design

Add one server tool, one client renderer, and edit the logo-designer prompt. Existing surfaces are untouched.

### 1. Logo-designer prompt change

`agents/src/prompts/initial/templates/logo-designer/core.md`

- In the `askQuestion` options block: `"Use this logo"` → `"Set as my logo"`.
- Replace the matching response handler with:

  > **Set as my logo** →
  > 1. Call `media-logo__edit_logo({ prompt: "Reformat for a square layout, preserving the existing design and content.", layout: "square", count: 1 })`. This auto-resolves the current logo from the slot and saves the square variant to `logo/primary`.
  > 2. If `edit_logo` returns an `error`, surface it to the user and offer to retry. Do **not** call `set_venture_logo` in that case.
  > 3. On success, call `media-logo__set_venture_logo({})`.
  > 4. Reply with one short message: "Logo set! You can close this window — your dashboard will now show the new logo."

### 2. New server tool: `media-logo__set_venture_logo`

`agents/src/skills/media-logo/tools/index.ts` (export and register).

- **Inputs:** none. Reads `appId` from `context.metadata.appId` (same pattern as `editLogoTool`).
- **Behavior:**
  - `mediaManifestService.getSlot(appId, 'logo/horizontal')` → `currentUrl` = `horizontalUrl`.
  - `mediaManifestService.getSlot(appId, 'logo/primary')` → `currentUrl` = `squareUrl`.
  - If either slot is missing or has no `currentUrl`, return `{ error: <human-readable> }` so the agent can recover.
  - Otherwise return:

    ```ts
    {
      text: 'Sent horizontal and square logo to your venture dashboard.',
      structuredContent: { horizontalUrl, squareUrl }
    }
    ```

- **Logging:** `skills.media-logo.tools.set_venture_logo.{start,success,no_app_id,slot_missing}` with `appId`, slot paths, and URL presence flags. Never log the URLs themselves at info level.
- **No timeout config** — pure read.

### 3. New client renderer: `SetVentureLogoToolRenderer`

`app/src/app/[market]/develop/components/tool-renderers/SetVentureLogoToolRenderer.tsx`. Registered for `'media-logo__set_venture_logo'` in `tool-renderers/index.ts`.

Behavior:

- Reads `structuredContent.horizontalUrl` / `.squareUrl` once `toolStatus === 'completed'`.
- Returns `null` (renders nothing) if `toolStatus !== 'completed'`, the URLs are absent, `!isEmbedded`, or `getParentOrigin()` is null. Matches the `LogoActionsToolRenderer` non-embedded behavior — silent skip, no UI surface.
- A `useRef` guards single execution; React strict-mode double mount cannot duplicate sends.
- Local state `phase: 'sending' | 'done'`. Initial phase is `'sending'` for the first render that satisfies the guard above.
- On first eligible mount:
  1. For each URL in `[horizontalUrl, squareUrl]`, sequentially:
     - `dataUrl = await fetchAsDataUrl(url)`. On failure, log `setVentureLogo.fetchFailed` warn and skip — VH ignores non-data-URL payloads, so an absolute-URL fallback is not useful here.
     - `window.parent.postMessage({ action: 'set-as-logo', sender: 'airo-hq', imageUrl: dataUrl }, parentOrigin)`.
  2. Set phase = 'done'.
- One impression event: `develop.brand.logo_set_to_venture` with `flow: 'logo-designer'` once.
- UI when rendered:
  - phase 'sending' → translation key `builder_logo_setting_to_venture` ("Setting your logo on your dashboard…").
  - phase 'done' → translation key `builder_logo_set_to_venture` ("Logo saved to your dashboard.").
- Translation keys use the `t(key, undefined, 'fallback string')` pattern so the renderer works before the keys are pushed to the i18n portal.

### 4. Tests

- `agents/src/skills/media-logo/tools/__tests__/set-venture-logo.test.ts`
  - happy path (both slots populated → returns both URLs).
  - missing horizontal slot → returns error string.
  - missing square slot → returns error string.
  - missing appId → returns error string, no slot reads attempted.
- `app/src/app/[market]/develop/components/tool-renderers/SetVentureLogoToolRenderer.test.tsx`
  - fires both postMessages with `data:` URLs, in order, when embedded.
  - fires exactly once across re-renders.
  - non-embedded → returns null (no postMessages, no UI).
  - `fetchAsDataUrl` rejects for square → only horizontal posted, warn logged, render still transitions to phase 'done'.
  - `getParentOrigin` returns null → returns null (no postMessages, no UI).
- Update `LogoActionsToolRenderer.test.tsx` only if its translation key list changes (it should not).

### 5. i18n

Two new keys to be created at https://i18n.int.gdcorp.tools/org/hcx/app/aab (PARTNERSTRANSLATIONS AD group) at the user's convenience:

- `builder_logo_setting_to_venture` — "Setting your logo on your dashboard…"
- `builder_logo_set_to_venture` — "Logo saved to your dashboard."

The renderer uses `t(key, undefined, 'fallback')` so missing keys do not break pre-commit.

## Data flow

```
askQuestion ─ user picks "Set as my logo" ──▶ agent
                                              │
                                              ▼
                                    edit_logo({ layout: "square", … })
                                              │
                                              ▼  (saves to logo/primary slot)
                                    set_venture_logo({})
                                              │
                                              ▼  (reads logo/horizontal + logo/primary)
                                  structuredContent { horizontalUrl, squareUrl }
                                              │
                                              ▼
                              SetVentureLogoToolRenderer (auto-fires)
                                              │
                                  ┌───────────┴───────────┐
                                  ▼                       ▼
                       postMessage(horizontal)   postMessage(square)
                                  │                       │
                                  ▼                       ▼
                         VH MediaLibraryModal.handleIframeMessage
                                  │                       │
                                  ▼                       ▼
                         uploadAsset(blob)         uploadAsset(blob)
                         + addLogoAssets(...)      + addLogoAssets(...)
                                              │
                                              ▼
                              (VH-side hook promotes square to venture.logoUrl)
                                              │
                              agent reply "Logo set! You can close this window…"
```

## Failure modes & user-visible behavior

| Failure | What happens |
| --- | --- |
| `edit_logo` errors / times out | Agent surfaces error and offers retry. No postMessages sent. |
| `set_venture_logo` slot lookup misses one slot | Tool returns `error`; agent tells user something is missing and asks them to regenerate. No partial sends. |
| `fetchAsDataUrl` fails for a variant inside the renderer | That variant is silently dropped (warn-logged). The other variant still goes through. (`LogoActionsToolRenderer` falls back to an absolute URL here; the new renderer does not, because VH discards non-data-URL payloads — sending one would be confusing dead weight.) |
| User is not embedded (`isEmbedded === false` or `getParentOrigin()` returns null) | Renderer returns `null` — no UI, no postMessages. The `edit_logo` call still ran up-front; that cost is incurred but the agent's confirmation message is the only user-visible result. Logo-designer launches embedded in practice. |
| VH `MediaLibraryModal` not mounted on the receiver | postMessages fall on the floor. We do not detect this. The agent's confirmation message is best-effort, not a guarantee of receipt. |

## Risks / things to watch

- **Cost:** picking "Set as my logo" now triggers a billed `edit_logo` API call. Acknowledged and accepted.
- **Sequential vs parallel posting:** sequential is intentional so VH's two `uploadAsset` calls under the same `ventureId` don't collide. If profiling later shows it's a bottleneck, parallelize with care.
- **Square slot reuse:** `logo/primary` is reused for whatever was last saved as square. The new flow always runs `edit_logo({ layout: "square" })` first, so the slot reflects the user's currently-selected logo at the moment of "Set as my logo". An older `layout: "all"` square in the slot is overwritten by this run. Acknowledged.
- **Receiver contract drift:** if VH adds a `data.event` field requirement or changes its sender check, our payload still matches today's contract (`sender: 'airo-hq'`, `action: 'set-as-logo'`, `imageUrl: data:image/...`). No change needed unless the contract changes upstream.

## Out of scope (recap)

- Venture Home / `vnext-dashboard` changes.
- Updating `LogoActionsToolRenderer` or removing it.
- Replacing the post-Step-6d offer_logo_actions surface.
- Non-embedded fallback that uploads via a server-side path.

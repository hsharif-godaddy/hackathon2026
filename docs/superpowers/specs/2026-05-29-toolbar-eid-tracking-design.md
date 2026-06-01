# Dev-tools Toolbar EID Tracking + Generic Cross-iframe Event Bus

**JIRA:** [AIROBUILD-1970](https://godaddy-corp.atlassian.net/browse/AIROBUILD-1970)
**Date:** 2026-05-29
**Status:** Draft

## Goal

Add click and impression EID tracking to the dev-tools toolbar so we can measure inline-editing usage in FullStory/CSP, and land a generic typed event-bus wrapper around cross-iframe `postMessage` so future cross-iframe features stop adding cases to the develop-page switch. Tracking is the bus's first consumer.

## Background

The dev-tools toolbar is the primary editing surface once a user has generated an app — buttons for text formatting (bold/italic/color/align/size/list), image replace and modify, AI sparkles edit, text-fix accept/reject, quick-edit submit, and multi-select. It currently emits zero tracking, so we have no signal on which editing affordances users actually use.

The toolbar runs inside the customer-app iframe and cannot push to `_expDataLayer` directly — that lives in the builder app. Tracking events have to be relayed up via `postMessage`, then re-fired on the builder side using the existing pipeline in `app/src/utils/instrumentation.ts` (`generateClickEID`, `logClickEvent`, `logImpressionEvent` → `_expDataLayer` → CSP → FullStory).

EID convention is a 3-segment input (`product.section.widget`); the loggers prefix `appbuilder` and append `.click` or `.impression` to produce the full 5-segment EID.

Separately, cross-iframe `postMessage` between dev-tools and builder is already a sprawling surface (~30 distinct message types), each handled in monolithic `handleMessage()` switches on both sides. Every new feature adds another `case` and another sender. Tracking would be the next addition in that pattern unless we clean the layer up.

## Decisions

1. **Comm-layer**: typed event-bus wrapper, with tracking as its first registered consumer. Generic dispatch primitive lands in this PR; legacy `case`-handlers are migrated incrementally in a follow-up ticket. (Resolves the ticket's open question.)
2. **Surface taxonomy**: `surface: 'text' | 'image'` only, fired on the toolbar-reveal impression. QuickEditBar and TextFixPopover are downstream of an already-tracked click — no separate impression. `'ai'` is not used today and not reserved.
3. **Multi-select Reference button**: fires `multi_select_add` regardless of whether multi-select mode is active. Same user intent; multi-select toggle is just modal state.
4. **Follow-link button** (`Pointer` icon): out of scope. Navigation, not an edit. Added to follow-up ticket scope.

## Architecture

### Data flow (one direction, fire-and-forget)

```
[dev-tools iframe]                                    [builder]
ElementHoverBar / button                              develop/[id]/page.tsx
        │                                                   │
        │  postTrackEvent({kind, eid, properties})           │
        ▼                                                   │
trackBus.send() ──postMessage──► handleMessage()            │
                                  │                         │
                                  │  dispatch(event.data)   │
                                  ▼                         │
                          eventBus handler-map              │
                                  │                         │
                                  ▼                         │
                          handleTrackEvent(msg)             │
                                  │                         │
                                  ▼                         │
                  logClickEvent / logImpressionEvent        │
                                  │                         │
                                  ▼                         │
                          _expDataLayer ──► CSP ──► FullStory
```

### Invariants preserved

- The builder-side `handleMessage` source-window check (`isFromIframe || isFromSameWindow`) stays as the only origin gate on that path — we are NOT adding `isOriginAllowed` here. The bus operates *after* that check.
- The dev-tools-side incoming-message origin check (`isOriginAllowed` in `DevelopmentMode.tsx`) and the `IFRAME_READY` handshake stay exactly as they are.
- `safePostMessage` (DataCloneError handling) and `postMessageToIframe` (SecurityError handling) stay as the underlying primitives. The bus is a builder on top of them.
- Builder-side handler reuses existing `logClickEvent` / `logImpressionEvent` from `instrumentation.ts`. No new tracking primitives.
- `appId` continues to be auto-merged via the module-level state in `instrumentation.ts`. No caller changes needed for that.
- **Implicit dedupe invariant** (load-bearing): `DevelopmentMode.tsx` freezes `effectiveElement` via `frozenElementRef` while `quickEditActive` is true (= `toolbarMode || quickEditMode`). This is what keeps the `element` prop stable during a live toolbar session, which is what makes the impression-dedupe model work without separate dedupe state. Refactors to `DevelopmentMode.tsx` must preserve the freeze or replace it with an equivalent guarantee.

## Event taxonomy

### Click EIDs

All resolve to `appbuilder.devtools.toolbar.<widget>.click`.

| Button                         | Widget token            | Source                                         |
| ------------------------------ | ----------------------- | ---------------------------------------------- |
| Bold                           | `bold`                  | `BoldButton.tsx`                               |
| Italic                         | `italic`                | `ItalicButton.tsx`                             |
| Color picker apply             | `text_color`            | `TextColorButton.tsx` (on apply, not on open)  |
| Text align change              | `text_align`            | `TextAlignButton.tsx` (on apply)               |
| Size step up                   | `text_size_up`          | `TextSizeStepperButton.tsx`                    |
| Size step down                 | `text_size_down`        | `TextSizeStepperButton.tsx`                    |
| List type change               | `list_type`             | `ListTypeButton.tsx`                           |
| Replace image                  | `replace_image`         | `ElementHoverBar.handleReplace`                |
| Modify image                   | `modify_image`          | `ElementHoverBar.handleModify`                 |
| Sparkles (Edit with AI)        | `sparkles`              | `ElementHoverBar.handleEditWithAI`             |
| Text fix Accept                | `text_fix_accept`       | `ElementHoverBar.handleFixAccept`              |
| Text fix Reject                | `text_fix_reject`       | `ElementHoverBar` (passes `fix.reject`)        |
| Quick Edit submit              | `quick_edit_submit`     | `ElementHoverBar.handleQuickEditSubmit`        |
| Reference / Multi-select add   | `multi_select_add`      | `ElementHoverBar.handleReference`              |
| Multi-select remove (× on overlay) | `multi_select_remove` | `ElementHoverBar` overlay-remove callback      |

### Impression EID

- `appbuilder.devtools.toolbar.view.impression`
- Custom property: `surface: 'text' | 'image'`
- Fires once per element per appearance.

### Auto-merged custom properties

- `appId` — added by `instrumentation.ts` from window-level state. Callers do not pass it.

## Impression dedupe model

Fire when `toolbarMode` flips `false → true` in `ElementHoverBar`. Two facts make this work without separate dedupe state:

1. The element-change effect already resets `toolbarMode = false` when the `element` prop changes — so the next visible toolbar is necessarily a new appearance.
2. While `toolbarMode || quickEditMode` is true, `DevelopmentMode.tsx` freezes `effectiveElement` (see "Invariants preserved"), so the `element` prop is stable for the lifetime of the toolbar session.

A single effect watching `toolbarMode` is therefore sufficient (`element` need not be in deps because it cannot change while `toolbarMode` is `true`):

```ts
useEffect(() => {
  if (!toolbarMode) return;
  const surface: 'text' | 'image' = isImage ? 'image' : 'text';
  postTrackEvent({
    kind: 'impression',
    eid: 'devtools.toolbar.view',
    properties: { surface },
  });
}, [toolbarMode]);
```

**Does NOT fire on**: scroll, resize, ResizeObserver tick, popover open/close, `barStyle` updates, QuickEditBar open, TextFixPopover open. These keep `toolbarMode` true (or transition it through `false` deliberately, which is a separate appearance).

**Does fire on**: the same DOM element re-acquired after losing hover then re-hovering — this is a fresh user-perceivable appearance and matches the "per appearance" intent in the ticket. Touch auto-open via `setTimeout(..., 50)` also flips `toolbarMode → true` and fires once.

**Subtlety**: when the user clicks Sparkles (→ QuickEditBar) or Fix (→ diff popover) and later returns to the toolbar on the same element, that's a second impression. Treated as intended — separate visible appearance from the user's POV.

## Event-bus wrapper

Two new files per side. The packages don't share a workspace dep, so the contract is mirrored, not imported.

### Builder side — `app/src/utils/eventBus.ts`

```ts
import { logger } from '@/lib/request-context';

type BusMessage = { type: string };

const handlers = new Map<string, (msg: BusMessage) => void>();

export function on<T extends BusMessage>(type: T['type'], handler: (msg: T) => void): void {
  if (handlers.has(type)) {
    logger.warn('eventBus.duplicate-registration', { type });
  }
  handlers.set(type, handler as (msg: BusMessage) => void);
}

export function dispatch(msg: unknown): boolean {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as BusMessage;
  if (typeof m.type !== 'string') return false;
  const handler = handlers.get(m.type);
  if (!handler) return false;
  try {
    handler(m);
  } catch (err) {
    logger.error('eventBus.handler-failure', { type: m.type, error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}
```

### Builder side — `app/src/utils/trackBus.ts`

```ts
import { on } from './eventBus';
import { logClickEvent, logImpressionEvent } from './instrumentation';
import { logger } from '@/lib/request-context';

export const TRACK_EVENT_TYPE = 'TRACK_EVENT' as const;

export type TrackEventMessage = {
  type: typeof TRACK_EVENT_TYPE;
  kind: 'click' | 'impression';
  eid: string;
  properties?: Record<string, string | number | boolean>;
};

export function registerTrackBus(): void {
  on<TrackEventMessage>(TRACK_EVENT_TYPE, (m) => {
    if (typeof m.eid !== 'string' || !m.eid) {
      logger.warn('trackBus.invalid-eid', { eid: m.eid });
      return;
    }
    if (m.kind === 'click') {
      logClickEvent(m.eid, m.properties)();
    } else if (m.kind === 'impression') {
      logImpressionEvent(m.eid, m.properties)();
    } else {
      logger.warn('trackBus.unknown-kind', { kind: m.kind, eid: m.eid });
    }
  });
}
```

### Dev-tools side — `app-templates/v8/dev-tools/src/utils/eventBus.ts`

```ts
import { safePostMessage } from './postMessage';

export function send<T extends { type: string }>(msg: T): void {
  safePostMessage(window.parent, msg);
}
```

### Dev-tools side — `app-templates/v8/dev-tools/src/utils/trackBus.ts`

```ts
import { send } from './eventBus';

const TRACK_EVENT_TYPE = 'TRACK_EVENT' as const;

export function postTrackEvent(payload: {
  kind: 'click' | 'impression';
  eid: string;
  properties?: Record<string, string | number | boolean>;
}): void {
  send({ type: TRACK_EVENT_TYPE, ...payload });
}
```

The `'TRACK_EVENT'` string literal is the contract between the two unworkspaced packages; mirroring the constant on each side guards against in-package typos at typecheck time.

### Wiring in `app/src/app/[market]/develop/[id]/page.tsx`

```ts
// Module scope (outside the component, not inside useEffect — registration must
// happen once at module load, not on every render):
registerTrackBus();

// In handleMessage, adding one early-return after the existing source-window check:
const handleMessage = (event: MessageEvent) => {
  const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
  const isFromIframe = iframe && event.source === iframe.contentWindow;
  const isFromSameWindow = event.source === window;
  if (!isFromIframe && !isFromSameWindow) return;
  if (dispatch(event.data)) return;          // ← bus consumed it (success OR validated-and-dropped)
  switch (event.data.type) { /* unchanged — every existing case stays */ }
};
```

The existing source-window check is the origin gate; we are not adding `isOriginAllowed` to the builder side. The legacy switch is unchanged. Tracking is the only event going through the bus today; the follow-up ticket migrates the rest one-by-one.

**`dispatch` returning `true` for invalid events is intentional**: when `registerTrackBus`'s handler rejects an event for `invalid-eid` or `unknown-kind`, the bus still consumed it — the legacy switch should NOT also try to handle a `TRACK_EVENT` it has no `case` for. Only handler-not-registered (unknown `type`) or non-message input returns `false`.

**Bus policy**: any new cross-iframe message added before the migration ticket lands MUST go through the bus from the start. New `case` additions to the legacy switch are not allowed in the meantime — otherwise the bus's lifetime expands silently.

### Migration path (follow-up ticket scope, not in this PR)

Migrating one event becomes a 3-line change:

1. **Dev-tools sender**: `safePostMessage(window.parent, {type: 'X', ...})` → `bus.send({type: 'X', ...})`
2. **Builder receiver**: delete the `case 'X'` from the legacy switch
3. **Builder registration**: `on<XMessage>('X', handler)` next to the other registrations

Each migrated event reduces the legacy switch by one `case`.

## Validation / robustness

- Builder-side `dispatch` rejects non-object input, missing/non-string `type`, and unknown types (returns `false`). Handler exceptions are caught and logged as `eventBus.handler-failure` — they do not propagate to `window.onerror`.
- Builder-side `trackBus` rejects non-string/empty `eid` and unknown `kind` values with warning logs.
- Dev-tools side leans on existing `safePostMessage` (DataCloneError handling, JSON-sanitize retry).
- No Zod / runtime schema in this iteration. The contract is two strings + one flat properties object. Adding Zod later is a one-file change if the surface grows.
- Origin validation stays where it is; `dispatch` runs *after* `isOriginAllowed`.

## Testing strategy

### Unit tests

| Surface              | Test file                                                          | Assertions                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Builder bus          | `app/src/utils/eventBus.test.ts` (new)                             | `on()` registers; `dispatch()` returns true and invokes; unknown type returns false; non-object/missing-type input returns false; duplicate registration logs warning; handler exception caught and logged                              |
| Builder track adapter| `app/src/utils/trackBus.test.ts` (new)                             | After `registerTrackBus()`, dispatching `{type:'TRACK_EVENT', kind:'click', eid:'x.y.z'}` calls `logClickEvent('x.y.z', props)`; same for `impression`; unknown `kind` is dropped + warned; empty `eid` is dropped + warned             |
| Dev-tools sender     | `app-templates/v8/dev-tools/src/utils/__tests__/trackBus.test.ts` (new) | `postTrackEvent({kind, eid, properties})` calls `safePostMessage(window.parent, {type:'TRACK_EVENT', kind, eid, properties})` with exact shape                                                                                          |
| Toolbar impression   | `ElementHoverBar.test.tsx` (extend)                                | One impression on `toolbarMode` false→true; `surface=text` for text element, `surface=image` for image; no second impression on scroll/resize/popover open; no second impression while `toolbarMode` stays true; second on close+reopen |
| Per-button click     | Existing per-button `__tests__` files                              | Bold/Italic/Color-apply/Size±/Align-apply/List-apply fires `postTrackEvent` with `eid='devtools.toolbar.<widget>'`. Color and Size: assert click on the *apply* action, not the popover-open chevron.                                   |
| Hover-bar callbacks  | `ElementHoverBar.test.tsx` (extend)                                | `handleReplace` / `handleModify` / `handleEditWithAI` / `handleQuickEditSubmit` / `handleFixAccept` / `handleReference` (in both multi-select states) / overlay-remove callback fire the right widget token                              |

### Manual smoke

1. Open a generated app, click each toolbar button, confirm `_expDataLayer` gets the expected entries. From DevTools console:
   ```js
   window._expDataLayer.filter(e => e.schema === 'add_click' || e.schema === 'add_impression')
   ```
   Each entry should have `data.traffic.eid` (clicks) or `data.eid` (impressions) starting with `appbuilder.devtools.toolbar.`, plus `appId` in `customProperties` / `custom_properties` and `surface: 'text' | 'image'` on the toolbar-view impression.
2. Verify existing flows unchanged: Edit-with-AI, multi-select, screenshots, image replace, theme/font preview, scroll position updates.

## File-by-file change list

### New files (8)

- `app/src/utils/eventBus.ts` — builder dispatch primitive
- `app/src/utils/eventBus.test.ts`
- `app/src/utils/trackBus.ts` — builder track adapter (`registerTrackBus`)
- `app/src/utils/trackBus.test.ts`
- `app-templates/v8/dev-tools/src/utils/eventBus.ts` — dev-tools sender
- `app-templates/v8/dev-tools/src/utils/trackBus.ts` — dev-tools `postTrackEvent`
- `app-templates/v8/dev-tools/src/utils/__tests__/trackBus.test.ts`
- `app-templates/v8/dev-tools/src/components/__tests__/TextSizeStepperButton.test.tsx` — no existing test file for this component

### Modified files (~9)

- `app/src/app/[market]/develop/[id]/page.tsx` — call `registerTrackBus()` in module setup; add `if (dispatch(event.data)) return;` early-return in `handleMessage`
- `app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx` — toolbar-view impression effect; `postTrackEvent` calls in `handleReplace`, `handleModify`, `handleEditWithAI`, `handleQuickEditSubmit`, `handleFixAccept`, and `handleReference`. Text-fix Reject is handled by wrapping `fix.reject` in a local `handleFixReject` callback (the `<TextFixPopover onReject={...}>` prop, line 526) — `TextFixPopover.tsx` itself does not change. Multi-select-remove tracking is added inside the `addNumberedOverlay` callback in `handleReference` (the existing inline `() => { removeNumberedOverlay(num); safePostMessage(...) }`).
- `app-templates/v8/dev-tools/src/components/BoldButton.tsx`
- `app-templates/v8/dev-tools/src/components/ItalicButton.tsx`
- `app-templates/v8/dev-tools/src/components/TextColorButton.tsx`
- `app-templates/v8/dev-tools/src/components/TextSizeStepperButton.tsx` (two widget tokens depending on direction)
- `app-templates/v8/dev-tools/src/components/TextAlignButton.tsx`
- `app-templates/v8/dev-tools/src/components/ListTypeButton.tsx`

### Modified test files (6)

- `app-templates/v8/dev-tools/src/components/__tests__/{ElementHoverBar,BoldButton,ItalicButton,TextColorButton,TextAlignButton,ListTypeButton}.test.tsx`

(`TextSizeStepperButton.test.tsx` is in "New files" above — no existing file to extend.)

## Out of scope

- Tracking inside non-toolbar customer-app UI (error boundary, multi-select badges, etc.) — possible follow-up.
- Migrating the existing ~30 `postMessage` events onto the bus — covered by the follow-up ticket below. New tracking events go through the bus; existing flows migrate opportunistically.
- Server-side analytics aggregation — existing CSP/FullStory pipeline is sufficient.
- Follow-link toolbar button — navigation, not an edit. Will be re-evaluated as part of the follow-up.

## Risk

Medium. Origin validation (`isOriginAllowed`) and the `IFRAME_READY` handshake are load-bearing — preserved unchanged; `dispatch` runs after them. The tracking-only path is low-risk; the bus primitive is ~30 lines of code with no behavior change to existing `postMessage` flows. The variable is the toolbar-button wiring, where each button's existing tests pin down behavior the new `postTrackEvent` calls must not regress.

## Acceptance criteria mapping

| Ticket AC | Resolved by |
|---|---|
| 1. Every toolbar button emits `appbuilder.devtools.toolbar.<button>.click` | Per-button click section above + per-button `__tests__` |
| 2. Toolbar reveal emits `appbuilder.devtools.toolbar.view.impression`, deduped per element per appearance, with `surface` custom property | Impression dedupe model section + `ElementHoverBar.test.tsx` extensions |
| 3. Events appear in `_expDataLayer` locally and reach FullStory in test | Manual smoke + builder track-adapter unit test |
| 4. No regression in existing cross-iframe flows (edit mode, multi-select, screenshots, visual context, theme/font preview) | Existing case-handlers unchanged; manual smoke covers each flow |
| 5. Decision documented on whether/how the cross-iframe comm layer was unified; if a wrapper landed, tracking is its first consumer | This document; generic event-bus wrapper landed; tracking is first registered consumer; follow-up ticket files migration |

## Follow-up

Open a JIRA ticket after this lands to migrate the remaining ~30 `postMessage` types in `develop/[id]/page.tsx` switch and dev-tools senders to the new event-bus wrapper. Each migration is a 3-line change (sender swap, switch-case removal, handler registration). Label `aab` + appropriate topic tag.

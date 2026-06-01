# Toolbar EID Tracking + Generic Event Bus — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire click + impression EID tracking on every dev-tools toolbar button, behind a generic typed event-bus wrapper that lets future cross-iframe features stop adding cases to the develop-page switch.

**Architecture:** Tiny generic `eventBus` primitive on each side (builder receives, dev-tools sends). Tracking is the first registered consumer. Existing ~30 `case` handlers in `develop/[id]/page.tsx` stay unchanged; a one-line `dispatch()` early-return at the top of `handleMessage` consumes bus events. Tracking calls re-fire through existing `logClickEvent` / `logImpressionEvent` in `instrumentation.ts`.

**Tech Stack:** TypeScript, React (Next.js for builder, Vite for dev-tools template), Vitest + Testing Library + jsdom, existing `safePostMessage` / `postMessageToIframe` primitives.

**Spec:** `docs/superpowers/specs/2026-05-29-toolbar-eid-tracking-design.md`

**JIRA:** [AIROBUILD-1970](https://godaddy-corp.atlassian.net/browse/AIROBUILD-1970)

---

## File Structure

**New files (8):**
- `app/src/utils/eventBus.ts` — builder dispatch primitive (`on`, `dispatch`)
- `app/src/utils/eventBus.test.ts`
- `app/src/utils/trackBus.ts` — `registerTrackBus()` + `TRACK_EVENT_TYPE` + `TrackEventMessage` type
- `app/src/utils/trackBus.test.ts`
- `app-templates/v8/dev-tools/src/utils/eventBus.ts` — sender (`send`)
- `app-templates/v8/dev-tools/src/utils/trackBus.ts` — `postTrackEvent`
- `app-templates/v8/dev-tools/src/utils/__tests__/trackBus.test.ts`
- `app-templates/v8/dev-tools/src/components/__tests__/TextSizeStepperButton.test.tsx`

**Modified files (~9):**
- `app/src/app/[market]/develop/[id]/page.tsx` — module-level `registerTrackBus()` + `dispatch()` early-return in `handleMessage`
- `app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx` — toolbar-view impression effect + 8 click EIDs
- `app-templates/v8/dev-tools/src/components/{BoldButton,ItalicButton,TextColorButton,TextSizeStepperButton,TextAlignButton,ListTypeButton}.tsx` — one click EID each (size has two)

**Modified test files (6):** existing `__tests__` for the buttons above (excluding TextSizeStepperButton, which is new).

---

## Conventions

- **Branch:** `AIROBUILD-1970--toolbar-eid-tracking` (already created)
- **Vitest jsdom:** All new test files start with `/** @vitest-environment jsdom */` if they touch React/DOM. Pure utility tests (eventBus, trackBus) can stay on default `node`.
- **Mock pattern:** Match existing tests — `vi.mock('../path/to/module', () => ({ exported: vi.fn() }))` *before* `import` of that module.
- **Per-task commit:** Commit at the end of each task. The user has a "no commit without explicit request" rule for ad-hoc commits, but this plan is the explicit request — every task ends with `git add` + `git commit` per the steps below.
- **Run tests after each implementation step**. If a test fails unexpectedly, stop and surface, don't paper over.

---

## Chunk 1: Builder-side bus + tracking adapter

### Task 1: Builder `eventBus.ts` — dispatch primitive

**Files:**
- Create: `app/src/utils/eventBus.ts`
- Create: `app/src/utils/eventBus.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// app/src/utils/eventBus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { on, dispatch, _resetForTests } from './eventBus';
import { logger } from '@/lib/request-context';

describe('eventBus', () => {
  beforeEach(() => {
    _resetForTests();
    vi.clearAllMocks();
  });

  it('dispatch returns false when input is not a message-shaped object', () => {
    expect(dispatch(null)).toBe(false);
    expect(dispatch(undefined)).toBe(false);
    expect(dispatch('string')).toBe(false);
    expect(dispatch(42)).toBe(false);
    expect(dispatch({})).toBe(false);
    expect(dispatch({ type: 123 })).toBe(false);
  });

  it('dispatch returns false for unregistered type', () => {
    expect(dispatch({ type: 'UNKNOWN' })).toBe(false);
  });

  it('on registers a handler and dispatch invokes it with the full message', () => {
    const handler = vi.fn();
    on<{ type: 'X'; payload: number }>('X', handler);
    expect(dispatch({ type: 'X', payload: 7 })).toBe(true);
    expect(handler).toHaveBeenCalledWith({ type: 'X', payload: 7 });
  });

  it('dispatch returns true when handler runs, regardless of handler outcome', () => {
    on('Y', () => {});
    expect(dispatch({ type: 'Y' })).toBe(true);
  });

  it('handler exception is caught and logged, dispatch still returns true', () => {
    on('Z', () => { throw new Error('boom'); });
    expect(dispatch({ type: 'Z' })).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      'eventBus.handler-failure',
      expect.objectContaining({ type: 'Z', error: 'boom' }),
    );
  });

  it('duplicate registration logs a warning', () => {
    on('DUP', () => {});
    on('DUP', () => {});
    expect(logger.warn).toHaveBeenCalledWith(
      'eventBus.duplicate-registration',
      { type: 'DUP' },
    );
  });
});
```

- [ ] **Step 2: Run tests, see them fail**

```bash
pnpm --filter website test src/utils/eventBus.test.ts
```

Expected: FAIL — `Cannot find module './eventBus'`.

- [ ] **Step 3: Implement minimal `eventBus.ts`**

```ts
// app/src/utils/eventBus.ts
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
    logger.error('eventBus.handler-failure', {
      type: m.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/** Test-only — allows tests to start with an empty handler map. */
export function _resetForTests(): void {
  handlers.clear();
}
```

- [ ] **Step 4: Run tests, see them pass**

```bash
pnpm --filter website test src/utils/eventBus.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/utils/eventBus.ts app/src/utils/eventBus.test.ts
git commit -m "[AIROBUILD-1970] Add builder-side eventBus primitive"
```

---

### Task 2: Builder `trackBus.ts` — track adapter

**Files:**
- Create: `app/src/utils/trackBus.ts`
- Create: `app/src/utils/trackBus.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// app/src/utils/trackBus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('./instrumentation', () => ({
  logClickEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

import { dispatch, _resetForTests } from './eventBus';
import { registerTrackBus, TRACK_EVENT_TYPE } from './trackBus';
import { logClickEvent, logImpressionEvent } from './instrumentation';
import { logger } from '@/lib/request-context';

describe('trackBus', () => {
  beforeEach(() => {
    _resetForTests();
    vi.clearAllMocks();
    registerTrackBus();
  });

  it('TRACK_EVENT_TYPE is "TRACK_EVENT"', () => {
    expect(TRACK_EVENT_TYPE).toBe('TRACK_EVENT');
  });

  it('routes click events to logClickEvent', () => {
    dispatch({
      type: 'TRACK_EVENT',
      kind: 'click',
      eid: 'devtools.toolbar.bold',
      properties: { surface: 'text' },
    });
    expect(logClickEvent).toHaveBeenCalledWith('devtools.toolbar.bold', { surface: 'text' });
  });

  it('routes impression events to logImpressionEvent', () => {
    dispatch({
      type: 'TRACK_EVENT',
      kind: 'impression',
      eid: 'devtools.toolbar.view',
      properties: { surface: 'image' },
    });
    expect(logImpressionEvent).toHaveBeenCalledWith('devtools.toolbar.view', { surface: 'image' });
  });

  it('drops events with empty/non-string eid and warns', () => {
    dispatch({ type: 'TRACK_EVENT', kind: 'click', eid: '' } as any);
    dispatch({ type: 'TRACK_EVENT', kind: 'click', eid: 123 } as any);
    expect(logClickEvent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('trackBus.invalid-eid', expect.any(Object));
  });

  it('drops events with unknown kind and warns', () => {
    dispatch({ type: 'TRACK_EVENT', kind: 'rumble', eid: 'x.y.z' } as any);
    expect(logClickEvent).not.toHaveBeenCalled();
    expect(logImpressionEvent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'trackBus.unknown-kind',
      expect.objectContaining({ kind: 'rumble' }),
    );
  });

  it('dispatch returns true even when trackBus drops the event (it consumed it)', () => {
    expect(dispatch({ type: 'TRACK_EVENT', kind: 'click', eid: '' } as any)).toBe(true);
    expect(dispatch({ type: 'TRACK_EVENT', kind: 'rumble', eid: 'x.y.z' } as any)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, see them fail**

```bash
pnpm --filter website test src/utils/trackBus.test.ts
```

Expected: FAIL — `Cannot find module './trackBus'`.

- [ ] **Step 3: Implement `trackBus.ts`**

```ts
// app/src/utils/trackBus.ts
import { logger } from '@/lib/request-context';
import { on } from './eventBus';
import { logClickEvent, logImpressionEvent } from './instrumentation';

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
      logger.warn('trackBus.invalid-eid', { eid: m.eid, kind: m.kind });
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

- [ ] **Step 4: Run tests, see them pass**

```bash
pnpm --filter website test src/utils/trackBus.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/utils/trackBus.ts app/src/utils/trackBus.test.ts
git commit -m "[AIROBUILD-1970] Add builder-side trackBus adapter"
```

---

### Task 3: Wire `registerTrackBus()` + `dispatch()` into develop page

**Files:**
- Modify: `app/src/app/[market]/develop/[id]/page.tsx` (top-of-file imports + module-scope registration + early-return in `handleMessage`)

- [ ] **Step 1: Read the file region to confirm exact line numbers**

```bash
grep -n "import\|handleMessage\|window.addEventListener('message'" app/src/app/\[market\]/develop/\[id\]/page.tsx | head -20
```

Confirm `handleMessage` is at ~1036 inside a `useEffect`.

- [ ] **Step 2: Add imports near the top of the file**

Add after the existing instrumentation imports (or grouped with other `@/utils/*` imports — match the file's existing import style):

```ts
import { dispatch as dispatchBusEvent } from '@/utils/eventBus';
import { registerTrackBus } from '@/utils/trackBus';
```

- [ ] **Step 3: Add module-scope registration call**

Place AFTER all imports and BEFORE the component definition. This is module-scope so it runs once at module load, not on every render:

```ts
// Register cross-iframe tracking events with the bus. Module-scope so it runs
// once at module load — never inside the useEffect, which would re-register on
// every render and trip the duplicate-registration guard.
registerTrackBus();
```

- [ ] **Step 4: Add the early-return inside `handleMessage`**

Inside the `useEffect` that defines `handleMessage`, immediately after the `if (!isFromIframe && !isFromSameWindow) return` guard and before the `switch`:

```ts
if (dispatchBusEvent(event.data)) return;
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter website typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/\[market\]/develop/\[id\]/page.tsx
git commit -m "[AIROBUILD-1970] Register trackBus on develop page; route bus events"
```

---

## Chunk 2: Dev-tools-side bus + sender

### Task 4: Dev-tools `eventBus.ts` + `trackBus.ts`

**Files:**
- Create: `app-templates/v8/dev-tools/src/utils/eventBus.ts`
- Create: `app-templates/v8/dev-tools/src/utils/trackBus.ts`
- Create: `app-templates/v8/dev-tools/src/utils/__tests__/trackBus.test.ts`

The dev-tools side is sender-only (no `on`/`dispatch` needed today). Its `eventBus.ts` is a one-line wrapper, so we test through `trackBus.ts`.

- [ ] **Step 1: Write failing test**

```ts
// app-templates/v8/dev-tools/src/utils/__tests__/trackBus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../postMessage', () => ({
  safePostMessage: vi.fn(),
}));

import { postTrackEvent } from '../trackBus';
import { safePostMessage } from '../postMessage';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('postTrackEvent', () => {
  it('sends a TRACK_EVENT message to window.parent with exact shape (click)', () => {
    postTrackEvent({
      kind: 'click',
      eid: 'devtools.toolbar.bold',
      properties: { surface: 'text' },
    });
    expect(safePostMessage).toHaveBeenCalledWith(window.parent, {
      type: 'TRACK_EVENT',
      kind: 'click',
      eid: 'devtools.toolbar.bold',
      properties: { surface: 'text' },
    });
  });

  it('sends a TRACK_EVENT message (impression, no properties)', () => {
    postTrackEvent({ kind: 'impression', eid: 'devtools.toolbar.view' });
    expect(safePostMessage).toHaveBeenCalledWith(window.parent, {
      type: 'TRACK_EVENT',
      kind: 'impression',
      eid: 'devtools.toolbar.view',
    });
  });
});
```

- [ ] **Step 2: Run test, see it fail**

```bash
pnpm --dir app-templates/v8/dev-tools test src/utils/__tests__/trackBus.test.ts
```

(Note: `app-templates/**` is excluded from the pnpm workspace, so we use `pnpm --dir <path>` to run scripts in that package directly. The package name is `@airo/dev-tools`, but it's not workspace-resolvable.)

Expected: FAIL — module not found.

- [ ] **Step 3: Implement dev-tools `eventBus.ts`**

```ts
// app-templates/v8/dev-tools/src/utils/eventBus.ts
import { safePostMessage } from './postMessage';

export function send<T extends { type: string }>(msg: T): void {
  safePostMessage(window.parent, msg);
}
```

- [ ] **Step 4: Implement dev-tools `trackBus.ts`**

```ts
// app-templates/v8/dev-tools/src/utils/trackBus.ts
import { send } from './eventBus';

const TRACK_EVENT_TYPE = 'TRACK_EVENT' as const;

export type TrackEventInput = {
  kind: 'click' | 'impression';
  eid: string;
  properties?: Record<string, string | number | boolean>;
};

export function postTrackEvent(payload: TrackEventInput): void {
  send({ type: TRACK_EVENT_TYPE, ...payload });
}
```

- [ ] **Step 5: Run test, see it pass**

```bash
pnpm --dir app-templates/v8/dev-tools test src/utils/__tests__/trackBus.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add app-templates/v8/dev-tools/src/utils/eventBus.ts \
        app-templates/v8/dev-tools/src/utils/trackBus.ts \
        app-templates/v8/dev-tools/src/utils/__tests__/trackBus.test.ts
git commit -m "[AIROBUILD-1970] Add dev-tools-side eventBus + trackBus"
```

---

## Chunk 3: Toolbar-view impression

### Task 5: Toolbar-view impression in `ElementHoverBar.tsx`

**Files:**
- Modify: `app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx`
- Modify: `app-templates/v8/dev-tools/src/components/__tests__/ElementHoverBar.test.tsx`

- [ ] **Step 1: Write failing tests**

Add these inside the existing test file. Mock the new `trackBus`:

```ts
// at top, with other vi.mock calls:
vi.mock('../../utils/trackBus', () => ({
  postTrackEvent: vi.fn(),
}));

// at the import group at bottom:
import { postTrackEvent } from '../../utils/trackBus';
```

Add a new `describe('toolbar-view impression', ...)` block. The existing test file already has helpers to render `ElementHoverBar` and trigger toolbar mode — reuse them. Tests:

```ts
describe('toolbar-view impression', () => {
  it('fires once with surface=text on toolbar reveal for a text element', () => {
    // Render with a text element, click to open toolbar
    // ...
    expect(postTrackEvent).toHaveBeenCalledWith({
      kind: 'impression',
      eid: 'devtools.toolbar.view',
      properties: { surface: 'text' },
    });
    expect(postTrackEvent).toHaveBeenCalledTimes(1);
  });

  it('fires with surface=image for an image element', () => {
    // Render with an image element (hoveredElement.type === 'image'), click to open
    expect(postTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ properties: { surface: 'image' } }),
    );
  });

  it('does not fire a second impression while toolbarMode stays true', () => {
    // Open toolbar, fire scroll/resize events, assert call count unchanged
    expect(postTrackEvent).toHaveBeenCalledTimes(1);
  });

  it('does not fire when only hoveredElement changes without toolbar opening', () => {
    // Render with element A, do NOT click; element changes
    expect(postTrackEvent).not.toHaveBeenCalled();
  });

  it('fires a fresh impression after toolbar closes and reopens on the same element', () => {
    // Open, close (e.g. via click outside), reopen
    expect(postTrackEvent).toHaveBeenCalledTimes(2);
  });
});
```

(Use the existing helpers in the test file — match its style. Look at the existing rendering tests to copy the click-to-open pattern.)

- [ ] **Step 2: Run tests, see them fail**

```bash
pnpm --dir app-templates/v8/dev-tools test src/components/__tests__/ElementHoverBar.test.tsx
```

Expected: FAIL on the new `toolbar-view impression` block.

- [ ] **Step 3: Implement the impression effect in `ElementHoverBar.tsx`**

Add the import:
```ts
import { postTrackEvent } from "../utils/trackBus";
```

Add a new `useEffect` after the existing `useEffect` blocks (a natural spot is right after the dismiss-on-click-outside effect, before the `barStyle` effect):

```ts
// Fire toolbar-view impression once per appearance. We can depend only on
// `toolbarMode`: while `toolbarMode || quickEditMode` is true, DevelopmentMode's
// `frozenElementRef` keeps the `element` prop stable for this component, so the
// impression cannot mis-fire from element mutation under the toolbar.
useEffect(() => {
  if (!toolbarMode) return;
  postTrackEvent({
    kind: "impression",
    eid: "devtools.toolbar.view",
    properties: { surface: isImage ? "image" : "text" },
  });
}, [toolbarMode]);
```

- [ ] **Step 4: Run tests, see them pass**

```bash
pnpm --dir app-templates/v8/dev-tools test src/components/__tests__/ElementHoverBar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx \
        app-templates/v8/dev-tools/src/components/__tests__/ElementHoverBar.test.tsx
git commit -m "[AIROBUILD-1970] Fire toolbar-view impression on reveal"
```

---

## Chunk 4: Per-button click EIDs

Each task in this chunk follows the same pattern: mock `trackBus`, click the button, assert `postTrackEvent` was called with the right widget token. Implementation is a one-liner inside the existing `onClick` / handler.

**Each task's TDD cycle:**
1. Add `vi.mock('../../utils/trackBus', () => ({ postTrackEvent: vi.fn() }))` to the test file (or extend existing mock block).
2. Add a focused test that asserts `postTrackEvent` was called with `{ kind: 'click', eid: 'devtools.toolbar.<widget>' }` after a click.
3. Run, see fail.
4. Add `import { postTrackEvent } from "../utils/trackBus";` and one call inside the handler.
5. Run, see pass.
6. Commit.

### Task 6: BoldButton — `bold`

**Files:**
- Modify: `app-templates/v8/dev-tools/src/components/BoldButton.tsx`
- Modify: `app-templates/v8/dev-tools/src/components/__tests__/BoldButton.test.tsx`

- [ ] **Step 1: Add mock + test in `BoldButton.test.tsx`**

```ts
vi.mock('../../utils/trackBus', () => ({
  postTrackEvent: vi.fn(),
}));

// at imports:
import { postTrackEvent } from '../../utils/trackBus';

// new test in the existing describe block:
it('fires devtools.toolbar.bold click event on toggle', () => {
  const paragraph = makeParagraph();
  render(createElement(BoldButton, { selectedElement: paragraph }));
  fireEvent.click(screen.getByRole('button', { name: 'Toggle bold' }));
  expect(postTrackEvent).toHaveBeenCalledWith({
    kind: 'click',
    eid: 'devtools.toolbar.bold',
  });
});
```

- [ ] **Step 2: Run, see fail**

```bash
pnpm --dir app-templates/v8/dev-tools test src/components/__tests__/BoldButton.test.tsx -t "devtools.toolbar.bold"
```

- [ ] **Step 3: Implement in `BoldButton.tsx`**

Add import: `import { postTrackEvent } from "../utils/trackBus";`

In `handleToggleBold`, as the very first line:
```ts
postTrackEvent({ kind: "click", eid: "devtools.toolbar.bold" });
```

- [ ] **Step 4: Run, see pass**
- [ ] **Step 5: Commit**

```bash
git add app-templates/v8/dev-tools/src/components/BoldButton.tsx \
        app-templates/v8/dev-tools/src/components/__tests__/BoldButton.test.tsx
git commit -m "[AIROBUILD-1970] Track BoldButton click"
```

---

### Task 7: ItalicButton — `italic`

**Files:**
- Modify: `app-templates/v8/dev-tools/src/components/ItalicButton.tsx`
- Modify: `app-templates/v8/dev-tools/src/components/__tests__/ItalicButton.test.tsx`

Same pattern as Task 6, with `eid: 'devtools.toolbar.italic'`. Expected button label: confirm via existing test (likely `"Toggle italic"`).

- [ ] Steps 1–5: identical TDD cycle.
- [ ] Commit:
```bash
git commit -m "[AIROBUILD-1970] Track ItalicButton click"
```

---

### Task 8: TextColorButton — `text_color` (on apply)

**Files:**
- Modify: `app-templates/v8/dev-tools/src/components/TextColorButton.tsx`
- Modify: `app-templates/v8/dev-tools/src/components/__tests__/TextColorButton.test.tsx`

Critical: fire on `onChangeEnd` (apply), NOT on `onChange` (live preview while dragging) — the spec says "on apply, not on open". Look at the existing implementation to find the apply hook.

- [ ] **Step 1: Read the file to find the apply hook**

```bash
grep -n "onChangeEnd\|onChange\|apply" app-templates/v8/dev-tools/src/components/TextColorButton.tsx | head -10
```

- [ ] **Step 2: Add test**

```ts
it('fires devtools.toolbar.text_color click event when a color is applied', () => {
  // Use existing test setup; trigger the apply path (likely a color-picker close
  // or onChangeEnd handler) and assert postTrackEvent called once with text_color
});
```

- [ ] **Steps 3–6: TDD cycle, commit**

```bash
git commit -m "[AIROBUILD-1970] Track TextColorButton color-apply click"
```

---

### Task 9: TextSizeStepperButton — `text_size_up` / `text_size_down`

**Files:**
- Modify: `app-templates/v8/dev-tools/src/components/TextSizeStepperButton.tsx`
- Create: `app-templates/v8/dev-tools/src/components/__tests__/TextSizeStepperButton.test.tsx`

Two widget tokens — one per direction. No existing test file, so this task creates one.

- [ ] **Step 1: Read the component**

```bash
grep -n "handleIncrement\|handleDecrement\|onClick\|step\|size" app-templates/v8/dev-tools/src/components/TextSizeStepperButton.tsx | head -15
```

Identify the up/down callback names.

- [ ] **Step 2: Create the new test file**

Mirror `BoldButton.test.tsx`'s structure but mock only what `TextSizeStepperButton.tsx` actually imports (likely a subset — typically `postMessage`, `element-helpers`, `translations`, plus `trackBus` for the new tracking call). Don't blindly copy `text-editing-helpers` if Stepper doesn't import it. Two tests:

```ts
it('fires text_size_up on increment', () => {
  // render, click the up button
  expect(postTrackEvent).toHaveBeenCalledWith({ kind: 'click', eid: 'devtools.toolbar.text_size_up' });
});

it('fires text_size_down on decrement', () => {
  // render, click the down button
  expect(postTrackEvent).toHaveBeenCalledWith({ kind: 'click', eid: 'devtools.toolbar.text_size_down' });
});
```

- [ ] **Steps 3–5: TDD cycle**
- [ ] **Step 6: Commit**

```bash
git add app-templates/v8/dev-tools/src/components/TextSizeStepperButton.tsx \
        app-templates/v8/dev-tools/src/components/__tests__/TextSizeStepperButton.test.tsx
git commit -m "[AIROBUILD-1970] Track TextSizeStepperButton up/down clicks"
```

---

### Task 10: TextAlignButton — `text_align` (on apply)

**Files:**
- Modify: `app-templates/v8/dev-tools/src/components/TextAlignButton.tsx`
- Modify: `app-templates/v8/dev-tools/src/components/__tests__/TextAlignButton.test.tsx`

Same caveat as TextColor — fire on apply, not popover-open. Single widget token regardless of which alignment is chosen (left/center/right/justify all → `text_align`).

- [ ] **TDD cycle, commit**

```bash
git commit -m "[AIROBUILD-1970] Track TextAlignButton apply click"
```

---

### Task 11: ListTypeButton — `list_type`

**Files:**
- Modify: `app-templates/v8/dev-tools/src/components/ListTypeButton.tsx`
- Modify: `app-templates/v8/dev-tools/src/components/__tests__/ListTypeButton.test.tsx`

Single widget token. Fire on apply (popover close after a list-type is selected).

- [ ] **TDD cycle, commit**

```bash
git commit -m "[AIROBUILD-1970] Track ListTypeButton apply click"
```

---

## Chunk 5: ElementHoverBar callbacks

### Task 12: ElementHoverBar click EIDs (8 callbacks)

**Files:**
- Modify: `app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx`
- Modify: `app-templates/v8/dev-tools/src/components/__tests__/ElementHoverBar.test.tsx`

Eight click EIDs in this single file:

| Callback | Widget token | Line (current) |
|---|---|---|
| `handleReplace` | `replace_image` | ~321 |
| `handleModify` | `modify_image` | ~342 |
| `handleEditWithAI` | `sparkles` | ~430 |
| `handleQuickEditSubmit` | `quick_edit_submit` | ~437 |
| `handleFixAccept` | `text_fix_accept` | ~474 |
| `fix.reject` (passed to `<TextFixPopover onReject>`) | `text_fix_reject` | ~526 |
| `handleReference` | `multi_select_add` | ~407 |
| numbered-overlay × callback (inside `addNumberedOverlay`) | `multi_select_remove` | ~416 |

Group these into one TDD cycle (eight tests, one implementation pass). The test additions are routine; implementation is one-line additions inside each callback.

- [ ] **Step 1: Add tests for all eight EIDs**

Inside the existing `describe`, add a new `describe('toolbar callback tracking', ...)` block. Each test renders the toolbar, simulates the relevant interaction, and asserts the right `postTrackEvent` call:

```ts
describe('toolbar callback tracking', () => {
  it('fires replace_image when Replace clicked on image element', () => { /* ... */ });
  it('fires modify_image when Modify clicked on image element', () => { /* ... */ });
  it('fires sparkles when Edit with AI clicked', () => { /* ... */ });
  it('fires quick_edit_submit when Quick Edit submitted', () => { /* ... */ });
  it('fires text_fix_accept when Fix Accept clicked', () => { /* ... */ });
  it('fires text_fix_reject when Fix Reject clicked', () => { /* ... */ });
  it('fires multi_select_add when Reference clicked (multi-select OFF)', () => { /* ... */ });
  it('fires multi_select_add when Reference clicked (multi-select ON)', () => { /* ... */ });
  it('fires multi_select_remove when overlay × is invoked', () => { /* ... */ });
});
```

(The `multi_select_add` test is duplicated across both multi-select states — both should fire the same widget per the spec.)

- [ ] **Step 2: Run, see all nine tests fail**

- [ ] **Step 3: Implement EIDs in each callback**

In `ElementHoverBar.tsx`:

```ts
// handleReplace, top of fn:
postTrackEvent({ kind: "click", eid: "devtools.toolbar.replace_image" });

// handleModify, top of fn:
postTrackEvent({ kind: "click", eid: "devtools.toolbar.modify_image" });

// handleEditWithAI, top of fn:
postTrackEvent({ kind: "click", eid: "devtools.toolbar.sparkles" });

// handleQuickEditSubmit, top of fn:
postTrackEvent({ kind: "click", eid: "devtools.toolbar.quick_edit_submit" });

// handleFixAccept, top of fn:
postTrackEvent({ kind: "click", eid: "devtools.toolbar.text_fix_accept" });

// handleReference, top of fn (fires regardless of multi-select state):
postTrackEvent({ kind: "click", eid: "devtools.toolbar.multi_select_add" });
```

For `text_fix_reject`: the current JSX passes `onReject={fix.reject}` to `<TextFixPopover>`. Wrap it:

```ts
const handleFixReject = useCallback(() => {
  postTrackEvent({ kind: "click", eid: "devtools.toolbar.text_fix_reject" });
  fix.reject();
}, [fix.reject]);

// then in JSX:
<TextFixPopover ... onReject={handleFixReject} ... />
```

For `multi_select_remove`: the current code has an inline callback inside `addNumberedOverlay`:

```ts
addNumberedOverlay(el, num, () => {
  removeNumberedOverlay(num);
  safePostMessage(window.parent, { type: "REMOVE_SELECTION_FROM_PREVIEW", data: { number: num } });
});
```

Add tracking as the first line of that callback:

```ts
addNumberedOverlay(el, num, () => {
  postTrackEvent({ kind: "click", eid: "devtools.toolbar.multi_select_remove" });
  removeNumberedOverlay(num);
  safePostMessage(window.parent, { type: "REMOVE_SELECTION_FROM_PREVIEW", data: { number: num } });
});
```

- [ ] **Step 4: Run, see all tests pass**

```bash
pnpm --dir app-templates/v8/dev-tools test src/components/__tests__/ElementHoverBar.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx \
        app-templates/v8/dev-tools/src/components/__tests__/ElementHoverBar.test.tsx
git commit -m "[AIROBUILD-1970] Track ElementHoverBar callback clicks"
```

---

## Chunk 6: Verification

### Task 13: Lint, typecheck, manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run lint on the builder package**

```bash
pnpm --filter website lint
```

Fix any errors related to the changes (typically unused imports if any). Don't fix unrelated warnings.

(Dev-tools package has no `lint` script in `app-templates/v8/dev-tools/package.json` — skipped.)

- [ ] **Step 2: Run typecheck on both packages**

```bash
pnpm --filter website typecheck
pnpm --dir app-templates/v8/dev-tools type-check
```

(Note: dev-tools script is `type-check` with a hyphen, not `typecheck`.)

Both: PASS.

- [ ] **Step 3: Run all touched test files**

```bash
pnpm --filter website test src/utils/eventBus.test.ts src/utils/trackBus.test.ts
pnpm --dir app-templates/v8/dev-tools test \
    src/utils/__tests__/trackBus.test.ts \
    src/components/__tests__/ElementHoverBar.test.tsx \
    src/components/__tests__/BoldButton.test.tsx \
    src/components/__tests__/ItalicButton.test.tsx \
    src/components/__tests__/TextColorButton.test.tsx \
    src/components/__tests__/TextSizeStepperButton.test.tsx \
    src/components/__tests__/TextAlignButton.test.tsx \
    src/components/__tests__/ListTypeButton.test.tsx
```

All: PASS.

- [ ] **Step 4: Manual smoke (per spec)**

Per `/execute-jira` Phase 3, this is the user's responsibility. After all automated checks pass, hand off to the user for manual testing in the browser.

- [ ] **Step 5: No commit needed for this task** (verification only).

---

## Done Criteria

- All 13 tasks complete with green tests.
- Lint + typecheck pass on both packages.
- Manual smoke (handed off to user): every toolbar button produces an `add_click` entry in `_expDataLayer` with `appbuilder.devtools.toolbar.<widget>.click`; toolbar reveal produces `appbuilder.devtools.toolbar.view.impression` with `surface: 'text' | 'image'`; `appId` present; existing flows (Edit-with-AI, multi-select, screenshots, theme/font preview, scroll updates) unchanged.
- Follow-up JIRA ticket filed for migrating remaining ~30 `postMessage` types to the bus (handled outside this plan, after PR merges).


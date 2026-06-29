# Inbox Empty-State CTA Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inbox empty-state CTAs send a localized, pre-written prompt to the develop chat as an action request (agent takes over), and surface the chat on mobile.

**Architecture:** Keep the pure descriptor (`inboxEmptyState.ts`) — add a `promptKey` per CTA. Add one React hook (`useInboxEmptyPrompt`) that owns the chat-send + mobile-switch + click-logging wiring and exposes `{ handleCtaClick, isProcessing }`. `InboxConversationList` calls the hook and wires each button.

**Tech Stack:** React + TypeScript, Vitest (jsdom), `@testing-library/react` (`render`, `renderHook`), UXCore `@ux/button`, develop chat via `useChatContext` (`@/contexts/ChatContext`), `useDevelopPageStore`, streaming selectors.

> **Correction (post-implementation):** Task 2 below was originally authored against
> `useSendUserMessage` from `@/app/[market]/develop/components/chat/ChatContext`. That context's
> provider is rendered **only inside `ChatPane`**, but the inbox lives in `PreviewPane` (a
> sibling), so the hook resolved to `null` at runtime. The shipped code instead uses
> `useChatContext()` from `@/contexts/ChatContext` (the page-level provider that wraps
> `PreviewPane`) and sends via `sendMessage({ content, isActionRequest: true })`. The Task 2
> code blocks have been updated to the shipped approach.

---

## CRITICAL: local test runner is broken (read before any test step)

The canonical `pnpm --filter website test` cannot run locally — a pre-existing CDS-deps global-setup bug (`app/scripts/generate-cds-deps.js`) hard-exits before any website test. It is unrelated to this work. To run tests, use this throwaway temp config (NEVER git-add or commit it):

```bash
cd /Users/ytsuji/Development/airo-app-builder/app
cat > vitest.tmp-nosetup.config.ts <<'EOF'
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
EOF
pnpm exec vitest run <PATTERN> --config vitest.tmp-nosetup.config.ts
rm -f vitest.tmp-nosetup.config.ts
```

Always `rm -f vitest.tmp-nosetup.config.ts` after each run and confirm `git status` never shows it before committing. Files with a `@vitest-environment jsdom` docblock still get jsdom (per-file override wins over the `node` default).

## i18n keys (create in portal before the Task 1 commit — pre-commit `t()` scan blocks on missing keys)

| Key | English |
| --- | --- |
| `builder_inbox_empty_prompt_add_chat` | Add a chat widget to my site so visitors can message me and I can reply to them in real time. |
| `builder_inbox_empty_prompt_add_form` | Add a contact form to my site so visitors can send me their questions and contact details. |

Note: the descriptor in Task 1 stores these as plain string *data* (not `t()` calls), so Task 1's commit will not trip the i18n scan. The `t(promptKey)` call is introduced in Task 2 (the hook). Both keys must exist before Task 2's commit.

## File Structure

- **Modify:** `app/src/app/[market]/develop/components/preview/inbox/inboxEmptyState.ts` — add `promptKey` to `InboxEmptyStateCta` and the two CTA constants.
- **Modify:** `app/src/app/[market]/develop/components/preview/inbox/inboxEmptyState.test.ts` — assert `promptKey` per CTA.
- **Create:** `app/src/app/[market]/develop/components/preview/inbox/useInboxEmptyPrompt.ts` — integration hook.
- **Create:** `app/src/app/[market]/develop/components/preview/inbox/useInboxEmptyPrompt.test.ts` — hook unit tests.
- **Modify:** `app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.tsx` — call the hook, wire buttons.
- **Modify:** `app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.test.tsx` — mock the hook, assert wiring + disabled.

---

## Task 1: Add `promptKey` to the CTA descriptor

**Files:**
- Modify: `app/src/app/[market]/develop/components/preview/inbox/inboxEmptyState.ts`
- Test: `app/src/app/[market]/develop/components/preview/inbox/inboxEmptyState.test.ts`

- [ ] **Step 1: Update the test to assert the new field (write failing test first)**

In `inboxEmptyState.test.ts`, the first test (`'returns setup title with both CTAs when both pointers are absent'`) currently asserts `state.ctas.map((cta) => cta.eid)`. Add prompt-key assertions to it. Replace that test body with:

```ts
  it('returns setup title with both CTAs when both pointers are absent', () => {
    const state = getInboxEmptyState(null, null);

    expect(state.titleKey).toBe('builder_inbox_empty_setup_title');
    expect(state.bodyKey).toBe('builder_inbox_empty_body_no_channels');
    expect(state.ctas.map((cta) => cta.eid)).toEqual([
      'inbox.empty.cta.add_chat',
      'inbox.empty.cta.add_form',
    ]);
    expect(state.ctas.map((cta) => cta.promptKey)).toEqual([
      'builder_inbox_empty_prompt_add_chat',
      'builder_inbox_empty_prompt_add_form',
    ]);
  });
```

Also extend the chat-only and form-only tests to assert the single CTA's `promptKey`. In `'offers only the contact form CTA when the chat widget exists but the category is absent'`, add after the existing `eid` assertion:
```ts
    expect(state.ctas.map((cta) => cta.promptKey)).toEqual(['builder_inbox_empty_prompt_add_form']);
```
In `'offers only the chat widget CTA when the category exists but the chat widget is absent'`, add after the existing `eid` assertion:
```ts
    expect(state.ctas.map((cta) => cta.promptKey)).toEqual(['builder_inbox_empty_prompt_add_chat']);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/ytsuji/Development/airo-app-builder/app
# (use the temp-config recipe from the top of this plan)
pnpm exec vitest run inboxEmptyState --config vitest.tmp-nosetup.config.ts
rm -f vitest.tmp-nosetup.config.ts
```
Expected: FAIL — `promptKey` is `undefined` on the CTAs (type error in TS or assertion mismatch).

- [ ] **Step 3: Add `promptKey` to the descriptor**

In `inboxEmptyState.ts`:

Add the field to the interface:
```ts
export interface InboxEmptyStateCta {
  labelKey: string;
  eid: string;
  testId: string;
  promptKey: string;
}
```

Add `promptKey` to each constant:
```ts
const ADD_CHAT_CTA: InboxEmptyStateCta = {
  labelKey: 'builder_inbox_empty_cta_add_chat',
  eid: 'inbox.empty.cta.add_chat',
  testId: 'inbox-empty-cta-add-chat',
  promptKey: 'builder_inbox_empty_prompt_add_chat',
};

const ADD_FORM_CTA: InboxEmptyStateCta = {
  labelKey: 'builder_inbox_empty_cta_add_form',
  eid: 'inbox.empty.cta.add_form',
  testId: 'inbox-empty-cta-add-form',
  promptKey: 'builder_inbox_empty_prompt_add_form',
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/ytsuji/Development/airo-app-builder/app
# (recreate temp config per recipe)
pnpm exec vitest run inboxEmptyState --config vitest.tmp-nosetup.config.ts
rm -f vitest.tmp-nosetup.config.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

Confirm `git status` does not show `vitest.tmp-nosetup.config.ts`. Then:
```bash
git add "app/src/app/[market]/develop/components/preview/inbox/inboxEmptyState.ts" "app/src/app/[market]/develop/components/preview/inbox/inboxEmptyState.test.ts"
git commit -m "Add promptKey to inbox empty-state CTA descriptor"
```

---

## Task 2: Integration hook `useInboxEmptyPrompt`

**Files:**
- Create: `app/src/app/[market]/develop/components/preview/inbox/useInboxEmptyPrompt.ts`
- Test: `app/src/app/[market]/develop/components/preview/inbox/useInboxEmptyPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `useInboxEmptyPrompt.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { MobileMode, ChatTab } from '@/app/[market]/develop/components/types';
import type { InboxEmptyStateCta } from './inboxEmptyState';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  logClickEvent: vi.fn(() => vi.fn()),
  isStreaming: false,
  isLoading: false,
  isMobile: false,
  handleMobileModeChange: vi.fn(),
  setActiveChatTab: vi.fn(),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}));

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: mocks.logClickEvent,
}));

vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({ sendMessage: mocks.sendMessage }),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => mocks.isStreaming,
  useIsLoading: () => mocks.isLoading,
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: unknown) => unknown) =>
    selector({
      isMobile: mocks.isMobile,
      handleMobileModeChange: mocks.handleMobileModeChange,
      setActiveChatTab: mocks.setActiveChatTab,
    }),
}));

import { useInboxEmptyPrompt } from './useInboxEmptyPrompt';

const chatCta: InboxEmptyStateCta = {
  labelKey: 'builder_inbox_empty_cta_add_chat',
  eid: 'inbox.empty.cta.add_chat',
  testId: 'inbox-empty-cta-add-chat',
  promptKey: 'builder_inbox_empty_prompt_add_chat',
};

describe('useInboxEmptyPrompt', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.isStreaming = false;
    mocks.isLoading = false;
    mocks.isMobile = false;
  });

  it('sends the localized prompt as an action request and logs the click', () => {
    const { result } = renderHook(() => useInboxEmptyPrompt());

    act(() => result.current.handleCtaClick(chatCta));

    expect(mocks.logClickEvent).toHaveBeenCalledWith('inbox.empty.cta.add_chat');
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      content: 't:builder_inbox_empty_prompt_add_chat',
      isActionRequest: true,
    });
  });

  it('does not switch the view on desktop', () => {
    const { result } = renderHook(() => useInboxEmptyPrompt());

    act(() => result.current.handleCtaClick(chatCta));

    expect(mocks.handleMobileModeChange).not.toHaveBeenCalled();
    expect(mocks.setActiveChatTab).not.toHaveBeenCalled();
  });

  it('switches to the chat tools on mobile', () => {
    mocks.isMobile = true;
    const { result } = renderHook(() => useInboxEmptyPrompt());

    act(() => result.current.handleCtaClick(chatCta));

    expect(mocks.handleMobileModeChange).toHaveBeenCalledWith(MobileMode.TOOLS);
    expect(mocks.setActiveChatTab).toHaveBeenCalledWith(ChatTab.CHAT);
  });

  it('is a no-op while a stream is processing', () => {
    mocks.isStreaming = true;
    const { result } = renderHook(() => useInboxEmptyPrompt());

    expect(result.current.isProcessing).toBe(true);

    act(() => result.current.handleCtaClick(chatCta));

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.logClickEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/ytsuji/Development/airo-app-builder/app
# (recreate temp config per recipe)
pnpm exec vitest run useInboxEmptyPrompt --config vitest.tmp-nosetup.config.ts
rm -f vitest.tmp-nosetup.config.ts
```
Expected: FAIL — cannot resolve `./useInboxEmptyPrompt`.

- [ ] **Step 3: Implement the hook**

Create `useInboxEmptyPrompt.ts`:

```ts
import { useCallback } from 'react';

import { ChatTab, MobileMode } from '@/app/[market]/develop/components/types';
import { useChatContext } from '@/contexts/ChatContext';
import { useTranslations } from '@/hooks/useTranslations';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore';
import { logClickEvent } from '@/utils/instrumentation';
import { type InboxEmptyStateCta } from './inboxEmptyState';

interface UseInboxEmptyPrompt {
  handleCtaClick: (cta: InboxEmptyStateCta) => void;
  isProcessing: boolean;
}

export function useInboxEmptyPrompt(): UseInboxEmptyPrompt {
  const t = useTranslations();
  const { sendMessage } = useChatContext();
  const isStreaming: boolean = useIsActivelyStreaming();
  const isLoading: boolean = useIsLoading();
  const isProcessing: boolean = isStreaming || isLoading;
  const isMobile: boolean = useDevelopPageStore((state) => state.isMobile);
  const handleMobileModeChange = useDevelopPageStore((state) => state.handleMobileModeChange);
  const setActiveChatTab = useDevelopPageStore((state) => state.setActiveChatTab);

  const handleCtaClick = useCallback(
    (cta: InboxEmptyStateCta): void => {
      if (isProcessing) return;
      logClickEvent(cta.eid)();
      void sendMessage({ content: t(cta.promptKey), isActionRequest: true });
      if (isMobile) {
        handleMobileModeChange(MobileMode.TOOLS);
        setActiveChatTab(ChatTab.CHAT);
      }
    },
    [isProcessing, sendMessage, t, isMobile, handleMobileModeChange, setActiveChatTab],
  );

  return { handleCtaClick, isProcessing };
}
```

Notes for the implementer:
- `useChatContext()` (from `@/contexts/ChatContext`) returns `{ sendMessage, loadHistory, stopGeneration, cancelLogoGeneration }` and **throws** if used outside its provider. The inbox is always under the page-level `ChatProvider` (which wraps `PreviewPane`), so no null guard is needed. `sendMessage(options)` takes a single options object; the message text goes in `options.content`. Do NOT use `useSendUserMessage` from `@/app/[market]/develop/components/chat/ChatContext` — that context is provided only inside `ChatPane` and is null from the inbox.
- `useIsActivelyStreaming` and `useIsLoading` are exported from `@/stores/useStreamingConversationStore` (same imports `InputActionsPanel` uses for its `isProcessing`).
- `MobileMode` and `ChatTab` are enums in `@/app/[market]/develop/components/types`.
- All locals carry explicit type annotations per repo rules. `handleMobileModeChange` / `setActiveChatTab` are store action functions — their inferred types from the store are fine; do not add `any`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/ytsuji/Development/airo-app-builder/app
# (recreate temp config per recipe)
pnpm exec vitest run useInboxEmptyPrompt --config vitest.tmp-nosetup.config.ts
rm -f vitest.tmp-nosetup.config.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

```bash
cd /Users/ytsuji/Development/airo-app-builder
pnpm --filter website typecheck 2>&1 | grep -iE "useInboxEmptyPrompt" || echo "no typecheck errors in the hook"
```
(Pre-existing ~20 `@airo-ux/pattern-library` errors are not ours. If the grep matches our file, fix the reported type issue.)

- [ ] **Step 6: Commit**

Both i18n prompt keys must exist in the portal now (this commit introduces the `t(cta.promptKey)` call). Confirm `git status` does not show the temp config. Then:
```bash
git add "app/src/app/[market]/develop/components/preview/inbox/useInboxEmptyPrompt.ts" "app/src/app/[market]/develop/components/preview/inbox/useInboxEmptyPrompt.test.ts"
git commit -m "Add useInboxEmptyPrompt hook to send empty-state CTA prompts to chat"
```
If pre-commit blocks on the missing i18n keys, STOP and report BLOCKED with the exact error and which keys it flagged — do not use --no-verify and do not remove the keys.

---

## Task 3: Wire the hook into `InboxConversationList`

**Files:**
- Modify: `app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.tsx`
- Test: `app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.test.tsx`

- [ ] **Step 1: Update the component test (write failing tests first)**

In `InboxConversationList.test.tsx`:

(a) Add a hoisted spy and a mock for the hook. Add this near the other `vi.hoisted` blocks (after the existing `instrumentation` hoisted block):
```ts
const emptyPrompt = vi.hoisted(() => ({
  handleCtaClick: vi.fn(),
  isProcessing: false,
}));

vi.mock('./useInboxEmptyPrompt', () => ({
  useInboxEmptyPrompt: () => emptyPrompt,
}));
```

(b) The existing `@ux/button` stub does not forward the `disabled` prop. Update it to forward `disabled` so the disabled-state test can assert it. Replace the existing `vi.mock('@ux/button', ...)` block with:
```ts
vi.mock('@ux/button', () => ({
  default: ({
    children,
    onClick,
    disabled,
    'data-testid': dataTestid,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    'data-testid'?: string;
  }) => (
    <button data-testid={dataTestid} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
```

(c) Replace the existing `'logs a click event when an empty-state CTA is clicked'` test with these two:
```ts
  it('routes an empty-state CTA click through the prompt hook', () => {
    render(
      <InboxConversationList brandId={brandId} embeddableId={null} categoryId={null} onConversationClick={vi.fn()} consumeEntryRef={() => null} />,
    );

    fireEvent.click(screen.getByTestId('inbox-empty-cta-add-chat'));

    expect(emptyPrompt.handleCtaClick).toHaveBeenCalledWith(
      expect.objectContaining({ eid: 'inbox.empty.cta.add_chat' }),
    );
  });

  it('disables the empty-state CTAs while the chat is processing', () => {
    emptyPrompt.isProcessing = true;

    render(
      <InboxConversationList brandId={brandId} embeddableId={null} categoryId={null} onConversationClick={vi.fn()} consumeEntryRef={() => null} />,
    );

    expect(screen.getByTestId('inbox-empty-cta-add-chat')).toBeDisabled();
    expect(screen.getByTestId('inbox-empty-cta-add-form')).toBeDisabled();

    emptyPrompt.isProcessing = false;
  });
```

(d) The previous click test asserted `instrumentation.logClickEvent`. Click logging now lives in the hook (covered by the hook's own test), so the component test no longer asserts it. Leave the `logClickEvent` entry in the instrumentation hoisted mock / factory in place (harmless; other parts of the component — the status filter — still call it).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ytsuji/Development/airo-app-builder/app
# (recreate temp config per recipe)
pnpm exec vitest run "InboxConversationList.test" --config vitest.tmp-nosetup.config.ts
rm -f vitest.tmp-nosetup.config.ts
```
Expected: FAIL — component still wires `onClick={logClickEvent(cta.eid)}` and has no `disabled`, so `handleCtaClick` is never called and buttons aren't disabled.

- [ ] **Step 3: Implement the component changes**

In `InboxConversationList.tsx`:

(a) Add the hook import alongside the sibling imports (after the `getInboxEmptyState` import line):
```ts
import { useInboxEmptyPrompt } from './useInboxEmptyPrompt';
```

(b) Call the hook in the component body. Add it right after the existing `emptyState` line (currently `const emptyState: InboxEmptyState = getInboxEmptyState(embeddableId, categoryId);`):
```ts
  const { handleCtaClick, isProcessing } = useInboxEmptyPrompt();
```

(c) Update the CTA `Button` in the `all`-filter empty branch. Change its `onClick` and add `disabled`. The current button is:
```tsx
                    <Button
                      key={cta.eid}
                      design='secondary'
                      size='sm'
                      data-testid={cta.testId}
                      onClick={logClickEvent(cta.eid)}
                    >
                      {t(cta.labelKey)}
                    </Button>
```
Replace it with:
```tsx
                    <Button
                      key={cta.eid}
                      design='secondary'
                      size='sm'
                      data-testid={cta.testId}
                      disabled={isProcessing}
                      onClick={() => handleCtaClick(cta)}
                    >
                      {t(cta.labelKey)}
                    </Button>
```

Do NOT remove the `logClickEvent` import — it is still used by `handleFilterChange` for `'inbox.filter.status'`. Leave it.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ytsuji/Development/airo-app-builder/app
# (recreate temp config per recipe)
pnpm exec vitest run "InboxConversationList.test" --config vitest.tmp-nosetup.config.ts
rm -f vitest.tmp-nosetup.config.ts
```
Expected: PASS (all tests in the file: the rendering/variation tests plus the two new wiring/disabled tests).

- [ ] **Step 5: Typecheck and lint**

```bash
cd /Users/ytsuji/Development/airo-app-builder
pnpm --filter website typecheck 2>&1 | grep -iE "InboxConversationList|useInboxEmptyPrompt|inboxEmptyState" || echo "no typecheck errors in our files"
pnpm --filter website lint > /tmp/lint.out 2>&1; echo "lint exit=$?"; tail -3 /tmp/lint.out
```
Expected: no typecheck errors referencing our files; lint exit=0.

- [ ] **Step 6: Commit**

Confirm `git status` does not show the temp config. Then:
```bash
git add "app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.tsx" "app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.test.tsx"
git commit -m "Wire inbox empty-state CTAs to send prompts via useInboxEmptyPrompt"
```

---

## Final verification (after all tasks)

```bash
cd /Users/ytsuji/Development/airo-app-builder/app
# (recreate temp config per recipe)
pnpm exec vitest run inbox --config vitest.tmp-nosetup.config.ts
rm -f vitest.tmp-nosetup.config.ts
```
Expected: the inbox suites pass. Pre-existing unrelated failures in `InboxReplyComposer.test.tsx` and `InboxConversationDetail.test.tsx` (a `@airo-ux/pattern-library/surfaces/floating-footer` resolution error) may remain — they are not part of this work.

## Notes / out of scope

- The agent's actual handling of the prompt (building a chat widget / contact form) is existing behavior — we only send the prompt text with `isActionRequest: true`.
- Desktop view is unchanged (both panes already visible); only mobile switches to the chat tools.
- No changes to the empty-state copy/variations themselves.

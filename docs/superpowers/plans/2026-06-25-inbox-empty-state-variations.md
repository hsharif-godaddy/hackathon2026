# Inbox Empty-State Variations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render title/body/CTA variations for the inbox `all`-filter empty state based on the presence of `embeddableId` (chat widget) and `categoryId` (contact form).

**Architecture:** A pure descriptor function `getInboxEmptyState(embeddableId, categoryId)` returns `{ titleKey, bodyKey, ctas }`. `InboxConversationList` wires its already-declared `embeddableId`/`categoryId` props into the `statusFilter === 'all'` empty branch, rendering the title, body, illustration (unchanged), and a row of secondary UXCore buttons that fire click analytics but are otherwise no-ops.

**Tech Stack:** React + TypeScript, Vitest (jsdom), `@testing-library/react`, UXCore `@ux/button`, i18n via `useTranslations()`.

---

## File Structure

- **Create:** `app/src/app/[market]/develop/components/preview/inbox/inboxEmptyState.ts` — pure descriptor function + types.
- **Create:** `app/src/app/[market]/develop/components/preview/inbox/inboxEmptyState.test.ts` — unit tests for the descriptor (node env).
- **Modify:** `app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.tsx` — destructure props, render variations + CTA buttons.
- **Modify:** `app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.test.tsx` — update broken assertions, add combination + CTA coverage.

**i18n keys (create in portal before commit — pre-commit blocks on missing keys):**

| Key | English |
| --- | --- |
| `builder_inbox_empty_setup_title` | Set up your first channel |
| `builder_inbox_empty_ready_title` | Ready for your first message |
| `builder_inbox_empty_body_no_channels` | Set up a contact form or chat widget to start receiving messages from your customers. Once they reach out, you'll be able to view and respond to everything in one place. |
| `builder_inbox_empty_body_all_channels` | Contact forms and customer chats will show up here. Once someone reaches out, you'll be able to view and respond to all their messages in one place. |
| `builder_inbox_empty_body_chat_only` | Customer chats will show up here. Want to capture leads too? Set up a contact form so customers can reach you anytime. Once someone reaches out, you'll be able to view and respond to all their messages in one place. |
| `builder_inbox_empty_body_form_only` | Contact form submissions will show up here. Want real-time conversations? Set up a chat widget so customers can get instant answers. Once someone reaches out, you'll be able to view and respond to all their messages in one place. |
| `builder_inbox_empty_cta_add_chat` | Add Chat Widget |
| `builder_inbox_empty_cta_add_form` | Add Contact Form |

---

## Task 1: Pure descriptor helper `getInboxEmptyState`

**Files:**
- Create: `app/src/app/[market]/develop/components/preview/inbox/inboxEmptyState.ts`
- Test: `app/src/app/[market]/develop/components/preview/inbox/inboxEmptyState.test.ts`

- [ ] **Step 1: Write the failing test**

Create `inboxEmptyState.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { getInboxEmptyState } from './inboxEmptyState';

describe('getInboxEmptyState', () => {
  it('returns setup title with both CTAs when both pointers are absent', () => {
    const state = getInboxEmptyState(null, null);

    expect(state.titleKey).toBe('builder_inbox_empty_setup_title');
    expect(state.bodyKey).toBe('builder_inbox_empty_body_no_channels');
    expect(state.ctas.map((cta) => cta.eid)).toEqual([
      'inbox.empty.cta.add_chat',
      'inbox.empty.cta.add_form',
    ]);
  });

  it('returns ready title with no CTAs when both pointers are present', () => {
    const state = getInboxEmptyState(789, 'support');

    expect(state.titleKey).toBe('builder_inbox_empty_ready_title');
    expect(state.bodyKey).toBe('builder_inbox_empty_body_all_channels');
    expect(state.ctas).toEqual([]);
  });

  it('offers only the contact form CTA when the chat widget exists but the category is absent', () => {
    const state = getInboxEmptyState(789, null);

    expect(state.titleKey).toBe('builder_inbox_empty_ready_title');
    expect(state.bodyKey).toBe('builder_inbox_empty_body_chat_only');
    expect(state.ctas.map((cta) => cta.eid)).toEqual(['inbox.empty.cta.add_form']);
  });

  it('offers only the chat widget CTA when the category exists but the chat widget is absent', () => {
    const state = getInboxEmptyState(null, 'support');

    expect(state.titleKey).toBe('builder_inbox_empty_ready_title');
    expect(state.bodyKey).toBe('builder_inbox_empty_body_form_only');
    expect(state.ctas.map((cta) => cta.eid)).toEqual(['inbox.empty.cta.add_chat']);
  });

  it('treats falsy-but-present category values (0, empty string) as present', () => {
    expect(getInboxEmptyState(0, '').bodyKey).toBe('builder_inbox_empty_body_all_channels');
    expect(getInboxEmptyState(0, '').ctas).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter website test inboxEmptyState`
Expected: FAIL — cannot resolve `./inboxEmptyState` / `getInboxEmptyState is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `inboxEmptyState.ts`:

```ts
export interface InboxEmptyStateCta {
  labelKey: string;
  eid: string;
  testId: string;
}

export interface InboxEmptyState {
  titleKey: string;
  bodyKey: string;
  ctas: InboxEmptyStateCta[];
}

const ADD_CHAT_CTA: InboxEmptyStateCta = {
  labelKey: 'builder_inbox_empty_cta_add_chat',
  eid: 'inbox.empty.cta.add_chat',
  testId: 'inbox-empty-cta-add-chat',
};

const ADD_FORM_CTA: InboxEmptyStateCta = {
  labelKey: 'builder_inbox_empty_cta_add_form',
  eid: 'inbox.empty.cta.add_form',
  testId: 'inbox-empty-cta-add-form',
};

export function getInboxEmptyState(
  embeddableId: number | null,
  categoryId: number | string | null,
): InboxEmptyState {
  const hasChatWidget: boolean = embeddableId !== null;
  const hasContactForm: boolean = categoryId !== null;

  const ctas: InboxEmptyStateCta[] = [
    ...(hasChatWidget ? [] : [ADD_CHAT_CTA]),
    ...(hasContactForm ? [] : [ADD_FORM_CTA]),
  ];

  if (!hasChatWidget && !hasContactForm) {
    return {
      titleKey: 'builder_inbox_empty_setup_title',
      bodyKey: 'builder_inbox_empty_body_no_channels',
      ctas,
    };
  }

  const bodyKey: string = hasChatWidget
    ? hasContactForm
      ? 'builder_inbox_empty_body_all_channels'
      : 'builder_inbox_empty_body_chat_only'
    : 'builder_inbox_empty_body_form_only';

  return { titleKey: 'builder_inbox_empty_ready_title', bodyKey, ctas };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter website test inboxEmptyState`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/[market]/develop/components/preview/inbox/inboxEmptyState.ts" "app/src/app/[market]/develop/components/preview/inbox/inboxEmptyState.test.ts"
git commit -m "Add inbox empty-state descriptor helper"
```

---

## Task 2: Wire variations + CTAs into `InboxConversationList`

**Files:**
- Modify: `app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.tsx`
- Test: `app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.test.tsx`

- [ ] **Step 1: Update the component test (write the failing tests first)**

In `InboxConversationList.test.tsx`:

(a) Add `logClickEvent` to the hoisted instrumentation mock. Replace the existing `instrumentation` hoisted block (lines 26-28) with:

```ts
const instrumentation = vi.hoisted(() => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
  logClickEvent: vi.fn(() => vi.fn()),
}));
```

And extend the `@/utils/instrumentation` mock return (lines 32-35) to include it:

```ts
  return {
    ...actual,
    logImpressionEvent: instrumentation.logImpressionEvent,
    logClickEvent: instrumentation.logClickEvent,
  };
```

(b) Add a UXCore Button stub alongside the other `vi.mock` child stubs (after the `framer-motion` mock, around line 88) so the buttons render as queryable elements and forward `data-testid`/`onClick`:

```ts
vi.mock('@ux/button', () => ({
  default: ({
    children,
    onClick,
    'data-testid': dataTestid,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    'data-testid'?: string;
  }) => (
    <button data-testid={dataTestid} onClick={onClick}>
      {children}
    </button>
  ),
}));
```

(c) Replace the existing `'renders the rich empty state with illustration for the "all" filter'` test (lines 105-113) with:

```ts
  it('renders the setup empty state with both CTAs when both pointers are absent', () => {
    const { container } = render(
      <InboxConversationList brandId={brandId} embeddableId={null} categoryId={null} onConversationClick={vi.fn()} consumeEntryRef={() => null} />,
    );

    expect(screen.getByText('builder_inbox_empty_setup_title')).toBeInTheDocument();
    expect(screen.getByText('builder_inbox_empty_body_no_channels')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-empty-cta-add-chat')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-empty-cta-add-form')).toBeInTheDocument();
  });

  it('renders the ready empty state with no CTAs when both pointers are present', () => {
    render(
      <InboxConversationList brandId={brandId} embeddableId={789} categoryId='support' onConversationClick={vi.fn()} consumeEntryRef={() => null} />,
    );

    expect(screen.getByText('builder_inbox_empty_ready_title')).toBeInTheDocument();
    expect(screen.getByText('builder_inbox_empty_body_all_channels')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-empty-cta-add-chat')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inbox-empty-cta-add-form')).not.toBeInTheDocument();
  });

  it('shows only the contact form CTA when the chat widget exists but the category is absent', () => {
    render(
      <InboxConversationList brandId={brandId} embeddableId={789} categoryId={null} onConversationClick={vi.fn()} consumeEntryRef={() => null} />,
    );

    expect(screen.getByText('builder_inbox_empty_body_chat_only')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-empty-cta-add-chat')).not.toBeInTheDocument();
    expect(screen.getByTestId('inbox-empty-cta-add-form')).toBeInTheDocument();
  });

  it('shows only the chat widget CTA when the category exists but the chat widget is absent', () => {
    render(
      <InboxConversationList brandId={brandId} embeddableId={null} categoryId='support' onConversationClick={vi.fn()} consumeEntryRef={() => null} />,
    );

    expect(screen.getByText('builder_inbox_empty_body_form_only')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-empty-cta-add-chat')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-empty-cta-add-form')).not.toBeInTheDocument();
  });

  it('logs a click event when an empty-state CTA is clicked', () => {
    render(
      <InboxConversationList brandId={brandId} embeddableId={null} categoryId={null} onConversationClick={vi.fn()} consumeEntryRef={() => null} />,
    );

    fireEvent.click(screen.getByTestId('inbox-empty-cta-add-chat'));

    expect(instrumentation.logClickEvent).toHaveBeenCalledWith('inbox.empty.cta.add_chat');
  });
```

(d) In the remaining tests that assert on `'builder_inbox_empty_all_title'` (the `'shows the single-line message for a non-"all" filter'` test at line 121 and the `'renders conversation rows...'` test at line 148), replace `'builder_inbox_empty_all_title'` with `'builder_inbox_empty_setup_title'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter website test InboxConversationList`
Expected: FAIL — new title/body keys not found and CTA testids absent (component still renders old keys, no buttons).

- [ ] **Step 3: Implement the component changes**

In `InboxConversationList.tsx`:

(a) Add the UXCore Button import near the top with the other `@ux` imports:

```ts
import Button from '@ux/button';
```

`logClickEvent` is already imported at line 10 (`import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';`) — leave that line unchanged.

Add the helper import alongside the sibling component imports:

```ts
import { getInboxEmptyState } from './inboxEmptyState';
```

(b) Destructure the two props (currently declared but not destructured) — update the function signature (lines 35-39):

```ts
export function InboxConversationList({
  brandId,
  embeddableId,
  categoryId,
  onConversationClick,
  consumeEntryRef,
}: InboxConversationListProps) {
```

(c) Replace the `statusFilter === 'all'` empty-state block (lines 123-131) with the variation-driven render. The new block:

```tsx
            (() => {
              const emptyState = getInboxEmptyState(embeddableId, categoryId);
              return (
                <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
                  <InboxEmptyIllustration className='text-ux-text-tertiary' />
                  <div className='text-sm font-medium text-ux-text-primary'>
                    {t(emptyState.titleKey)}
                  </div>
                  <p className='max-w-[260px] text-xs leading-snug text-ux-text-secondary'>
                    {t(emptyState.bodyKey)}
                  </p>
                  {emptyState.ctas.length > 0 && (
                    <div className='flex flex-wrap items-center justify-center gap-2'>
                      {emptyState.ctas.map((cta) => (
                        <Button
                          key={cta.eid}
                          design='secondary'
                          size='sm'
                          data-testid={cta.testId}
                          onClick={logClickEvent(cta.eid)}
                        >
                          {t(cta.labelKey)}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()
```

Note: `logClickEvent(cta.eid)` returns the `() => void` handler thunk (matching the existing `logClickEvent('inbox.filter.status', {...})()` usage pattern, where the inner thunk is the click handler).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter website test InboxConversationList`
Expected: PASS (all tests, including the 5 new/updated empty-state tests).

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter website typecheck && pnpm --filter website lint`
Expected: no errors. (If the inline IIFE trips a lint rule, extract `const emptyState = getInboxEmptyState(embeddableId, categoryId);` to the top of the component body and inline the JSX without the IIFE wrapper.)

- [ ] **Step 6: Commit**

```bash
git add "app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.tsx" "app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.test.tsx"
git commit -m "Render inbox empty-state variations by embeddable/category presence"
```

---

## Task 3: Update the prop comment + full verification

**Files:**
- Modify: `app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.tsx:27-30`

- [ ] **Step 1: Update the now-stale prop comment**

The comment at lines 27-28 says the pointers are "Declared (and passed via JSX) but not yet consumed." They are now consumed. Replace the comment above `embeddableId`/`categoryId` in `InboxConversationListProps` with:

```ts
  // Reamaze provisioning pointers driving the empty-state variations:
  // embeddableId → chat widget present; categoryId → contact form present.
```

- [ ] **Step 2: Run the full inbox test suite + typecheck**

Run: `pnpm --filter website test inbox && pnpm --filter website typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.tsx"
git commit -m "Update inbox pointer prop comment now that variations consume them"
```

---

## Notes / Out of scope

- CTAs are intentionally not wired to any "add chat widget" / "add contact form" flow — `onClick` only fires `logClickEvent`.
- The non-`all` filtered empty states (`unresolved`/`pending`/`resolved`) are unchanged.
- The now-unused `builder_inbox_empty_all_title` / `builder_inbox_empty_all_body` portal keys are left in place (no portal deletion required).
- **i18n prerequisite:** the 8 new keys above must exist in the portal before the commits in Task 2 reach pre-commit, or the hook will block. Create them at https://i18n.int.gdcorp.tools/org/airo-app-builder/app/aab.

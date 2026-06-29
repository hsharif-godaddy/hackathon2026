# Inbox Empty-State Variations — Design

**Date:** 2026-06-25
**Component:** `app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.tsx`

## Goal

Render different title, body, and CTAs for the inbox empty state depending on whether
the Reamaze provisioning pointers `embeddableId` (chat widget) and `categoryId`
(contact form) are present. CTAs are buttons that fire click analytics but are **not
otherwise wired up** for now.

## Scope

- Applies **only** to the `statusFilter === 'all'` empty state (the rich empty state
  with the illustration), at `InboxConversationList.tsx:122-131`.
- The non-`all` filtered empty states (`unresolved` / `pending` / `resolved`) are
  unchanged — they keep their existing single-line messages.
- `InboxConversationList` currently declares `embeddableId` / `categoryId` in its props
  but does not destructure them. They are already passed via JSX from `Inbox.tsx`. This
  change wires them into the render path.

## Presence semantics

- `embeddableId: number | null` — present ⟺ not `null`.
- `categoryId: number | string | null` — present ⟺ not `null`. (`0` and `''` count as
  present; only `null` is absent.)

## Variation matrix

| `embeddableId` | `categoryId` | Title | Body key | CTAs |
| --- | --- | --- | --- | --- |
| null | null | Set up your first channel | `builder_inbox_empty_body_no_channels` | Add Chat Widget, Add Contact Form |
| present | present | Ready for your first message | `builder_inbox_empty_body_all_channels` | (none) |
| present | null | Ready for your first message | `builder_inbox_empty_body_chat_only` | Add Contact Form |
| null | present | Ready for your first message | `builder_inbox_empty_body_form_only` | Add Chat Widget |

Derived rules (used to keep the logic simple):

- **Title** = `builder_inbox_empty_setup_title` when both are absent, else
  `builder_inbox_empty_ready_title`.
- **"Add Chat Widget" CTA** shown ⟺ `embeddableId` is absent.
- **"Add Contact Form" CTA** shown ⟺ `categoryId` is absent.
- **Body** = per-combination lookup (4 distinct strings).

## Copy (English source)

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

These keys must be created in the i18n portal before commit (pre-commit blocks on
missing keys). The existing keys `builder_inbox_empty_all_title` and
`builder_inbox_empty_all_body` become unused in code; their portal entries are left in
place.

## Implementation

### 1. Pure descriptor helper — `inboxEmptyState.ts` (colocated)

```ts
interface InboxEmptyStateCta {
  labelKey: string;
  eid: string;
  testId: string;
}

interface InboxEmptyState {
  titleKey: string;
  bodyKey: string;
  ctas: InboxEmptyStateCta[];
}

export function getInboxEmptyState(
  embeddableId: number | null,
  categoryId: number | string | null,
): InboxEmptyState;
```

- Pure function, no React. Encapsulates the 4-way branching so it can be unit-tested
  directly.
- CTA descriptors:
  - Add Chat Widget → `labelKey: 'builder_inbox_empty_cta_add_chat'`,
    `eid: 'inbox.empty.cta.add_chat'`, `testId: 'inbox-empty-cta-add-chat'`.
  - Add Contact Form → `labelKey: 'builder_inbox_empty_cta_add_form'`,
    `eid: 'inbox.empty.cta.add_form'`, `testId: 'inbox-empty-cta-add-form'`.

### 2. `InboxConversationList` render path

- Destructure `embeddableId` and `categoryId` from props.
- In the `statusFilter === 'all'` empty branch, call `getInboxEmptyState(...)` and render
  `t(titleKey)`, `t(bodyKey)`, the illustration (unchanged), and a CTA row.
- CTAs render as UXCore `Button` `design="secondary"` `size="sm"`, side by side, each with
  `data-testid` and a no-op `onClick` that fires `logClickEvent(cta.eid)()`.
- When `ctas` is empty, render no CTA row.

## Testing

- **Unit:** new `inboxEmptyState.test.ts` covering all 4 `(embeddableId, categoryId)`
  combinations — asserts title key, body key, and CTA set.
- **Component:** update `InboxConversationList.test.tsx`:
  - The existing `builder_inbox_empty_all_title` / `_all_body` assertions break — replace
    with `builder_inbox_empty_setup_title` / `builder_inbox_empty_body_no_channels` for the
    `embeddableId={null} categoryId={null}` default already used in those tests.
  - Add coverage for the other 3 prop combinations (title, body, CTA presence).
  - Assert CTA `onClick` fires `logClickEvent` with the expected eid.

## Out of scope

- Wiring the CTAs to any real "add chat widget" / "add contact form" flow.
- Changes to the non-`all` filtered empty states.
- Removing the now-unused `builder_inbox_empty_all_*` portal keys.

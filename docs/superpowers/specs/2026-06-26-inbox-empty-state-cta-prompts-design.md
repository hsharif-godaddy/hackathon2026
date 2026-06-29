# Inbox Empty-State CTA Prompts — Design

**Date:** 2026-06-26
**Builds on:** `2026-06-25-inbox-empty-state-variations-design.md` (the empty-state variations + CTA buttons already shipped).

## Goal

Make the inbox empty-state CTAs actionable: clicking "Add Chat Widget" or "Add Contact
Form" sends a pre-written prompt to the develop chat as an action request, so the AI agent
takes over and builds the channel. On mobile, also surface the chat so the user sees the
agent respond.

> **Correction (post-implementation):** the original draft of this spec wired the chat send
> through `useSendUserMessage` from `@/app/[market]/develop/components/chat/ChatContext`. That
> was wrong: there are two same-named `ChatContext` modules, and that one's provider is
> rendered **only inside `ChatPane`**. The inbox lives in `PreviewPane` — a sibling under the
> page-level `ChatProvider` — so the hook resolved to `null`. The shipped implementation uses
> `useChatContext()` from `@/contexts/ChatContext` (the page-level provider that actually wraps
> `PreviewPane`, the same one `DesignKitWizard`/`EventModal` use). This document has been
> updated to reflect the shipped approach.

## Decisions (confirmed)

- **Send immediately** — clicking fires `sendMessage({ content: prompt, isActionRequest: true })`
  right away (matches how other preview-pane components, e.g. `EventModal`, send to chat). No
  composer prefill.
- **Localized prompts** — prompt text comes from new i18n keys, so the agent receives the
  prompt in the user's language.
- **Switch to chat on mobile** — after sending, if `isMobile`, switch the mobile view to the
  chat. Desktop shows both panes already, so no switch there.
- **Disable while processing** — the buttons are `disabled` while a stream is actively
  processing (clearer than a silent no-op for these prominent CTAs).

## Layout facts grounding the design

- The inbox renders in the preview pane (`ViewMode.INBOX`). The develop chat is a separate
  pane. On desktop both are visible simultaneously.
- On mobile, `mobileMode` toggles between `MobileMode.PREVIEW` (preview pane, where the inbox
  lives) and `MobileMode.TOOLS` (which hosts the chat). `activeChatTab` (default
  `ChatTab.CHAT`) selects the tools tab.
- The inbox preview subtree is mounted under the page-level `ChatProvider`
  (`@/contexts/ChatContext`, rendered at `page.tsx` wrapping both `ChatPane` and
  `PreviewPane`), so `useChatContext()` and `useDevelopPageStore` hooks are reachable with no
  prop threading. Note: the *other* `ChatContext` (`@/app/[market]/develop/components/chat/
  ChatContext`, with `useSendUserMessage`) is provided only inside `ChatPane` and is NOT
  reachable from the inbox.

## Architecture

Three units, each with one responsibility:

### 1. Pure descriptor — `inboxEmptyState.ts` (modify)

Add a `promptKey: string` field to `InboxEmptyStateCta`. Values:

| CTA | `eid` | `promptKey` |
| --- | --- | --- |
| Add Chat Widget | `inbox.empty.cta.add_chat` | `builder_inbox_empty_prompt_add_chat` |
| Add Contact Form | `inbox.empty.cta.add_form` | `builder_inbox_empty_prompt_add_form` |

Stays a pure function with no React dependency. Existing unit tests extend by asserting the
new `promptKey` per CTA.

### 2. Integration hook — `useInboxEmptyPrompt.ts` (new, colocated)

Encapsulates all chat/store wiring so the list component and the pure descriptor stay clean.

```ts
function useInboxEmptyPrompt(): {
  handleCtaClick: (cta: InboxEmptyStateCta) => void;
  isProcessing: boolean;
}
```

Internals:
- `{ sendMessage } = useChatContext()` — from `@/contexts/ChatContext` (the page-level
  provider that wraps `PreviewPane`). Its `sendMessage(options)` takes a single options object
  whose `content` field carries the message text.
- `isProcessing = useIsActivelyStreaming() || useIsLoading()` — from
  `@/stores/useStreamingConversationStore` (mirrors `InputActionsPanel`'s `isProcessing`).
- `isMobile`, `handleMobileModeChange`, `setActiveChatTab` — from `useDevelopPageStore`.
- `t = useTranslations()`.

`handleCtaClick(cta)` behavior:
```ts
if (isProcessing) return;                            // guard (page-level provider always present)
logClickEvent(cta.eid)();                             // preserve existing analytics
void sendMessage({ content: t(cta.promptKey), isActionRequest: true });
if (isMobile) {
  handleMobileModeChange(MobileMode.TOOLS);
  setActiveChatTab(ChatTab.CHAT);
}
```
(No `!sendMessage` guard: `useChatContext()` throws if used outside its provider, and the
inbox is always under the page-level `ChatProvider`.)

`isProcessing` is returned so the component can disable the buttons.

### 3. List component — `InboxConversationList.tsx` (modify)

- Call `const { handleCtaClick, isProcessing } = useInboxEmptyPrompt();`.
- Each CTA `Button`: `onClick={() => handleCtaClick(cta)}`, `disabled={isProcessing}`.
- Buttons remain `design='secondary'`, `size='sm'`, side by side, keeping their `data-testid`.
- The bare `logClickEvent(cta.eid)` onClick is removed (the hook now owns click logging).

## Prompt copy (new i18n keys — create in portal before commit)

| Key | English |
| --- | --- |
| `builder_inbox_empty_prompt_add_chat` | Add a chat widget to my site so visitors can message me and I can reply to them in real time. |
| `builder_inbox_empty_prompt_add_form` | Add a contact form to my site so visitors can send me their questions and contact details. |

## Testing

- **`inboxEmptyState.test.ts`** — extend existing assertions to check each CTA carries the
  correct `promptKey`.
- **`useInboxEmptyPrompt.test.ts`** (new) — render the hook with mocked `useChatContext`,
  `useDevelopPageStore`, and streaming selectors. Assert:
  - clicking a CTA calls `sendMessage` with `{ content: t(promptKey), isActionRequest: true }`,
    and fires `logClickEvent` with the eid;
  - when `isProcessing` is true, `handleCtaClick` is a no-op (no send);
  - when `isMobile` is true, `handleMobileModeChange(MobileMode.TOOLS)` and
    `setActiveChatTab(ChatTab.CHAT)` are called; when false, neither is.
- **`InboxConversationList.test.tsx`** — mock `useInboxEmptyPrompt` to a spy `handleCtaClick`.
  Replace the old "logs a click event" assertion with: clicking `inbox-empty-cta-add-chat`
  calls `handleCtaClick` with the add-chat cta; buttons are `disabled` when the hook reports
  `isProcessing`. (Behavioral send/switch logic is covered by the hook's own test, keeping
  this suite focused on rendering/wiring.)

## Out of scope

- Any change to how the agent actually builds a chat widget / contact form — we only send the
  prompt; the agent's handling is existing behavior.
- Changes to the empty-state copy/variations themselves (shipped previously).
- Desktop view changes (both panes already visible).

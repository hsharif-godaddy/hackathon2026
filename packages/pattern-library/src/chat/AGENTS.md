# AGENTS.md — `src/chat/`

Chat-surface components — the pieces that render inside an AI conversation.
Root [`AGENTS.md`](../../AGENTS.md) and
[`src/AGENTS.md`](../AGENTS.md) already cover the repo-wide and
component-authoring rules; this file captures what is specific to chat
components.

## What belongs here

Anything a conversational UI renders inside a message thread:

- `thinker/` — "the model is working" indicator + optional collapsible
  reasoning/chain-of-thought panel.
- Future: message bubbles, tool-call renderers, citation cards, cancel/regen
  controls, etc.

If a component is *about* chat infrastructure (transports, reducers, prompt
plumbing) it does **not** belong here. This repo is UI only.

## Streaming-safe children

Chat components routinely render content that is being appended token-by-token.
Any child slot that may stream must:

- Accept `children` as-is and render it without deep copying.
- Avoid layout that re-measures on every append (e.g. do not pair
  `transition: max-height` with dynamic content that keeps growing).
- Announce new content politely for AT users — `aria-live="polite"` on the
  streaming region, `aria-atomic="false"` so only the added text is read.
- Never auto-scroll without a user-intent affordance (respect a "stick to
  bottom" toggle; don't yank the viewport).

## Accessibility baseline

Every interactive chat component must pass:

- Roving `tabIndex` or explicit `role="button"` + keyboard handler for any
  non-`<button>` clickable.
- `aria-expanded` on disclosure toggles (e.g. Thinker's reasoning panel).
- `aria-label` overrideable via props for screen-reader context
  ("Generating response", "Show reasoning steps", etc.).

## Composition hints

- **`SecretsForm`** dismisses (renders nothing) after a successful **`onSubmit`** so the thread or composer can advance; follow-up status belongs in sibling **`Thinker`** / **`AgentMessage`** (or equivalent) in the **host**—see [`../input/secrets-form/README.md`](../input/secrets-form/README.md).
- Use `@ux/box` for surfaces with gap/padding — don't hand-roll flex containers
  when a box variant will do.
- Use `@ux/text-lockup` for any heading + body pair (including single-line
  "thinking…" copy). It handles text style + weight correctly.
- **Chat surface header titles use `size="sm"` on `TextLockup`.** Surfaces
  hosting an agent conversation (`FloatingPanel`, the chat-mode `Panel` /
  `FullscreenDialog` configurations, etc.) should size their header lockup
  one step down from the generic `PanelChrome` default (`size="lg"`). The
  agent chat reads as in-thread chrome — closer to a message row than a
  page-section heading — so the smaller lockup keeps it from dominating
  the conversation.
- Animations for "working" states go through keyframes in the component's
  `styles.css`; never inline-style-driven JS animation.

# PromptBox

The text-entry surface for a chat agent drawer (side panel). It always includes an auto-expanding multiline field and the built-in **send / stop** primary control. Optional **microphone**, **attach**, **token budget**, and any other chrome are composed with **`beforeSubmit`** and **`toolbarStart`** (`appearance="borderless"`) using `@ux/button`, **`TokenBudgetButton`**, and peers — see Storybook **Default + microphone**, **Borderless + toolbar**, **Borderless + typeahead**, and **Surfaces / FloatingFooter** (borderless + typeahead). The **expansion area** (`expansionContent`) reveals a collapsible panel above the field for staged content such as file previews and context chips.

Default appearance wraps the field in `@ux/field-frame`. `appearance="borderless"` is a frameless field plus a bottom toolbar row: optional **`toolbarStart`** (left), optional **`beforeSubmit`** (before send), then the built-in send/stop.

## When to use

- As the input area at the bottom of a chat drawer or AI side panel.
- When you want a single component to own the textarea, keyboard submit, suggestions flyout, and send/stop — while you own the tertiary actions.

## When not to use

- Single-line search inputs — use `@ux/text-input` directly.
- Forms — `PromptBox` is optimised for conversational, single-submission entry, not structured form data.

## Appearances

| `appearance` | Layout |
|--------------|--------|
| `default` | Bordered `@ux/field-frame`, textarea + optional **`beforeSubmit`** + **send/stop**. |
| `borderless` | Frameless textarea, then **`toolbarStart`** (optional) + toolbar end: optional **`beforeSubmit`** + **send/stop**. |

Use **`TokenBudgetButton`** for the token donut control — the BEM wrapper and (by default) the `componentAiro` theme partial are built in. Import **`@airo-ux/pattern-library/input/prompt-box/styles`** wherever you render it.

## TokenBudgetButton

Tertiary **token budget** control: donut gauge as the `@ux/button` icon and the BEM wrapper used in borderless toolbars. The wrapper carries the **`componentAiro`** theme partial when no emphasis is set (so the default highlight accent flows from the partial); when `emphasis` is provided the partial is dropped and the active arc takes its color directly from the emphasis intent. Pass **`percent`** (0–100, clamped for the ring), **`aria-label`**, and optional **`onPress`** — the button stays **disabled** until `onPress` is provided (same affordance pattern as optional actions on `PromptBox`).

The donut track is always the neutral `feedbackPassive` ring; only the active (remaining) arc takes on the accent. Pass **`emphasis`** (`"critical"`, `"warning"`, `"success"`, `"info"`, `"highlight"`, `"neutral"`, `"internal"`, `"passive"`, `"premium"`) to switch the active arc to the matching high-contrast feedback intent — useful for surfacing budget pressure (`"warning"` / `"critical"`) without changing the icon shape. Omit it to keep the default highlight accent.

To float the whole borderless composer with **raised elevation** (radius and theme shadow from `@ux/box`), wrap it in **`FloatingFooter`** and import **`@airo-ux/pattern-library/surfaces/floating-footer/styles`** alongside `prompt-box` styles (Storybook **Surfaces / FloatingFooter → Borderless PromptBox**).

## Usage

```tsx
import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
import { PromptBox, TokenBudgetButton } from '@airo-ux/pattern-library/input/prompt-box';
import '@airo-ux/pattern-library/input/prompt-box/styles';

// Minimal — built-in send only
<PromptBox
  placeholder="Ask anything…"
  onSubmit={(text) => sendMessage(text)}
  pending={isGenerating}
  onStop={() => stopGeneration()}
/>

// Default + microphone (before send)
<PromptBox
  placeholder="Ask anything…"
  onSubmit={handleSubmit}
  beforeSubmit={
    <span className="airo-input-prompt-box__mic">
      <Button
        design="tertiary"
        size="small"
        icon={<AsyncIcon icon="mic" />}
        aria-label="Voice input"
        type="button"
        onClick={startVoice}
      />
    </span>
  }
/>

// Borderless — attach + TokenBudgetButton + mic (see Storybook **Borderless + toolbar**)
const tokenPct = 72;
<PromptBox
  appearance="borderless"
  placeholder="Message…"
  onSubmit={handleSubmit}
  toolbarStart={
    <>
      <span className="airo-input-prompt-box__attach">
        <Button
          design="tertiary"
          size="small"
          icon={<AsyncIcon icon="plus" />}
          aria-label="Attach files"
          type="button"
          onClick={() => fileInputRef.current?.click()}
        />
      </span>
      <TokenBudgetButton
        percent={tokenPct}
        aria-label={`Token budget ${tokenPct}% remaining`}
        onPress={openTokenUsageDialog}
      />
    </>
  }
  beforeSubmit={
    <span className="airo-input-prompt-box__mic">
      <Button
        design="tertiary"
        size="small"
        icon={<AsyncIcon icon="mic" />}
        aria-label="Voice input"
        type="button"
        onClick={startVoice}
      />
    </span>
  }
/>
```

## Keyboard

| Key | Action |
|-----|--------|
| `Enter` | Submit the prompt (fires `onSubmit`) |
| `Shift+Enter` | Insert a newline |
| `ArrowUp` / `ArrowDown` | Navigate suggestions (when flyout is open). Otherwise calls `onArrowUp` / `onArrowDown` with a "caret at edge" flag — return `true` to consume the keypress (typical use: prompt-history navigation). |
| `Tab` | Accept first / active suggestion in **edit** mode (keeps focus in field) |
| `Enter` (suggestion highlighted) | Accept highlighted suggestion in **accept** mode |
| `Escape` | Dismiss suggestions flyout |

## Submit / Stop states

- **`pending={false}`** — send button (arrow-up). Enter or click submits.
- **`pending={true}`** — stop button (square). Click fires `onStop` and resets the field.

### Future: prompt queueing

The `onQueue` prop is reserved for a future "queue" feature. When `pending` is `true` and `onQueue` is provided, pressing **Enter** (without Shift) calls `onQueue(value)` instead of being a no-op. While pending the action button in the UI is Stop (not Send), so `onQueue` currently has no dedicated click affordance — it is keyboard-only until a visible Queue button ships. This lets callers opt in to queue semantics today without any breaking changes when the visible affordance lands.

## Typeahead suggestions

Wire `onSuggestionsRequest` to a service that returns `PromptSuggestion[]`. The component fires this callback on every keystroke — **debounce at the call site**. When `suggestions` is non-empty a `@ux/flyout` popover appears above the field with `role="listbox"` semantics. The textarea gains `role="combobox"` when `onSuggestionsRequest` is provided **or** when `suggestions` is non-empty.

```tsx
const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);

<PromptBox
  placeholder="Ask anything…"
  suggestions={suggestions}
  onSuggestionsRequest={debounce((q) => fetchSuggestions(q).then(setSuggestions), 200)}
  onSuggestionAccept={(suggestion, mode) => {
    setSuggestions([]);
  }}
  onSubmit={(text) => {
    sendMessage(text);
    setSuggestions([]);
  }}
/>
```

## Accessibility

- The textarea carries `role="combobox"`, `aria-expanded`, `aria-controls`, and `aria-autocomplete="list"` when suggestions are active, implementing the ARIA 1.2 combobox pattern.
- `aria-activedescendant` on the textarea tracks the highlighted option — focus never leaves the field.
- A visually-hidden `role="status"` region with `aria-live="polite"` announces suggestion-count changes to screen readers.
- **Send/stop** is icon-only; names come from `submitLabel` / `stopLabel` (defaults: `"Send"` / `"Stop"`).
- **`beforeSubmit`** / **`toolbarStart`** are yours — give each interactive control an accessible name (`aria-label` on icon buttons, etc.). **`TokenBudgetButton`** owns the donut SVG (`aria-hidden`); pass a clear **`aria-label`** for the control.

## Auto-expand

The editor is a Lexical `contenteditable`, so its height naturally tracks the rendered paragraph count up to a CSS `max-height` cap. Past the cap the surface scrolls instead of growing — same UX as the legacy textarea, no `field-sizing` quirks.

## Editor (Lexical)

`PromptBox` ships a Lexical-backed editor so it can host inline element-mention badges, decorator nodes (ghost text), and richer paste handling. Three new **peer dependencies** must be installed alongside `@airo-ux/pattern-library`:

```jsonc
{
  "peerDependencies": {
    "@lexical/react": "^0.42.0",
    "lexical": "^0.42.0",
    "lexical-beautiful-mentions": "^0.1.48"
  }
}
```

Consumers that already install these (e.g. via another Lexical-based composer) get them deduped automatically.

## Imperative handle

`PromptBox` forwards a `PromptBoxHandle` ref (a typed object), **not** the `HTMLTextAreaElement` it forwarded before this release. Callers that previously stored the textarea ref to call `.focus()` keep working — `handle.focus()` and `handle.blur()` are 1:1 replacements — but anyone reaching into the DOM for `.value` / `.setSelectionRange()` must migrate to the controlled `value` / `onChange` props.

```tsx
import { useRef } from 'react';
import { PromptBox, type PromptBoxHandle } from '@airo-ux/pattern-library/input/prompt-box';

const ref = useRef<PromptBoxHandle>(null);

<PromptBox ref={ref} placeholder="Ask anything…" onSubmit={handleSubmit} />;
ref.current?.focus();
ref.current?.insertElementMention(3, 'h1'); // inserts `#3 <Title>` badge
ref.current?.removeElementMention(3);
ref.current?.clearAllElementMentions();
```

## Element mentions

Element mentions are inline contenteditable atoms that visually represent a selected page element (e.g. `#3 <Title>`). They render via the [`MentionChip`](../../primitives/mention-chip/README.md) primitive, which binds to the same three-state `actionControl` token family as `@ux/chip` — `ux.actionControl.*` (resting), `ux.actionControlHovered.*` (hover), and `ux.actionControlFocused.*` (keyboard focus) — and ship a built-in ✕ remove affordance.

- Insert via the handle: `ref.current?.insertElementMention(3, 'h1')`.
- Remove via the handle: `ref.current?.removeElementMention(3)` or clear all via `clearAllElementMentions()`.
- Listen for removal via `onMentionRemoved`. Fires whenever a previously-tracked mention number disappears from the document — this includes ✕ clicks, Backspace, **and** programmatic removals via `removeElementMention()` / `clearAllElementMentions()` and external `value=""` clears. If you need to distinguish user-driven from imperative removals, suppress reentry with a flag at the call site of the imperative methods.

The badge dispatches a `CustomEvent('scroll-to-mention', { detail: { number, editorInstanceId } })` on the document when clicked, so callers can scroll the mentioned element into view. The `editorInstanceId` is a per-`PromptBox` token; if you only have one editor, ignore it. The same scoping applies to the badge's ✕-driven `remove-mention` event so two PromptBoxes on the same page never erase each other's mentions. This contract is fixed for now and may move to a Lexical-scoped command/prop in a future release.

## Paste interception

Paste handling routes through three opt-in props. Each requires its gating boolean to fire — without the gate the paste falls through to Lexical's default plain-text insertion.

| Prop | Gate | What it receives | Typical use |
|------|------|------------------|-------------|
| `onLargePasteDetected` | text exceeds `maxInlinePasteLength` (default 4000) | the pasted string | Stage as an attachment instead of inlining a wall of text. |
| `onStageFiles` | `canStageFiles={true}` | the `File[]` from the clipboard | Wire into your file-upload pipeline. |
| `onScreenshotCaptured` | `canAddAsset={true}` | a JPEG data URL, longest edge ≤ 1024px | Attach a screenshot without an extra round-trip. |

## Listening / streaming

- `isListening={true}` makes the editor read-only (no typing, no paste) so a speech-to-text recognizer can write into the field via `value` without competing with user keystrokes.
- `isBudgetExceeded={true}` makes the editor read-only — both typing and paste are blocked. Use this when the host has detected that any additional input would be discarded server-side anyway, so silently dropping the input is more honest than accepting it.

Pair `pending={true}` with `onStop` for the stop-button affordance during model generation.

## History navigation

`onArrowUp` and `onArrowDown` give callers a hook for prompt-history navigation (cycle to the previously sent prompt). They fire on caret movement and pass `true` when the caret is at the very start (ArrowUp) / end (ArrowDown) of the editor; return `true` from the handler to consume the keypress, return `false` to let Lexical move the caret normally.

## Expansion area

A collapsible panel sits above the textarea when `expansionContent` is provided. Use it to surface staged content — file attachment previews, context chips, selected-text snippets, etc. — before the user submits.

```tsx
// Controlled: caller derives `expanded` from external state (here, "do we
// have any staged files?") and updates that state on `onExpandedChange`.
const [files, setFiles] = useState<File[]>([]);

<PromptBox
  placeholder="Ask about these files…"
  expansionContent={<FileChipList files={files} />}
  expanded={files.length > 0}
  onExpandedChange={(open) => {
    if (!open) setFiles([]);
  }}
  onSubmit={handleSubmit}
/>
```

For the uncontrolled flavour, drop both `expanded` and `onExpandedChange`
and let `PromptBox` manage open/closed state internally — pass
`defaultExpanded` if you want it to start open.

The panel animates open / closed with a CSS `grid-template-rows` transition (respects `prefers-reduced-motion`). When collapsed the content is both `aria-hidden` and `inert`, so screen readers skip it and keyboard users can't tab into focusable descendants of `expansionContent`.

The PromptBox renders **two built-in toggle affordances** depending on `expansionTitle`:

- **Without `expansionTitle`** — a chevron-down corner-action button overlays the expanded panel and calls `onExpandedChange(false)`. The panel hides entirely when collapsed.
- **With `expansionTitle`** — a header **band** is rendered above `expansionContent` in both states, with the title and a chevron toggle (chevron-up to expand, chevron-down to collapse). The band stays visible when collapsed so the staged interaction is still addressable from the composer.

Set `expansionThinking` alongside `expansionTitle` to render a `ThinkingIndicator` next to the title in the band — used to signal in-progress agent work whose checklist / timeline lives in the expanded content. Strings passed to `expansionTitle` are wrapped in a `TextLockup size="xs"` for canonical caption-scale typography; `ReactNode` titles render as-is so callers can pass their own lockup with custom emphasis / icon / size.

Refer to the TypeScript prop extraction (via `ts-morph` in the codex) for the canonical prop reference; the highlights are: `expansionContent`, `expansionTitle`, `expansionThinking`, `expanded` / `defaultExpanded` / `onExpandedChange` (controlled / uncontrolled triplet), `collapseLabel`, `expandLabel`.

### Nested `ChoiceList` number-key shortcuts

`PromptBox` publishes its textarea ref via `ChoiceListShortcutScopeContext`, so any `ChoiceList` rendered as a descendant (typically inside `expansionContent`) auto-scopes its `1`–`9` shortcut to the textarea. Pressing a number key while typing focuses the matching option without the consumer having to wire a ref. See [the ChoiceList README](../choice-list/README.md#inside-a-promptbox-auto-wired) for the full picture.

## Gotchas

- **`@ux/field-frame` button alignment** (default appearance): trailing actions use `align-self: flex-end` and uniform `margin` so extras + **send** stay pinned to the bottom-inline-end as the textarea grows.
- **Borderless + suggestions**: the flyout anchors to the textarea shell (`@ux/flyout`), not the footer surface — placement matches the field block.
- **Debouncing**: `onSuggestionsRequest` fires on every change event. Wrap it with a debounce in the consumer to avoid excessive service calls.
- **Controlled reset on stop**: in controlled mode the component calls `onChange('')` when the stop button is clicked to signal that the field should be cleared. The parent must handle this update.
- **`TokenBudgetButton` stroke scales with font-size**: the donut stroke is `0.25em`, calibrated for the default 16px root font-size; consumers with a much larger root font will get a slightly chunkier ring. The SVG sets `overflow: visible` so the outer edge does not clip.

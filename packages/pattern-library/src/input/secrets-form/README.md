# SecretsForm

Inline secret capture for conversational AI: one field, masked by default,
optional show/hide, validation, and submit. Two **placements** via **`variant`**:

| `variant` | Use when | Chrome |
|-----------|----------|--------|
| **`composer`** (default) | Replaces the **chat input / prompt box** | Root **`@ux/box`** with **`elevation="raised"`** (theme drop-shadow from UXCore, same family as **`FloatingFooter`**). Header **close (X)** is always shown — pass **`onClose`** (required in **`variant="composer"`**) so the user can reject the agent’s request without submitting. Icon **send**; helper + errors in the **bottom toolbar** (same row as send). **`data-partial="componentAiro"`** wraps the send control whenever **`pending`** is false — same **`PromptBox`** rule so Airo theming applies even while send is disabled (empty/invalid). |
| **`conversation`** | Renders **inside the message stream** next to other bubbles | Root **`@ux/box`** with **`elevation="base"`** (flat card). No header close; **Save** (`@ux/button` **`design="primary"`**, standard UXCore intents — no **`componentAiro`** partial) + **Cancel** (`onClose`); compact **TextEntry** row (`visualSize` is already **`sm`** — smallest supported); helper + errors **below the field**; visible **border** (no raised shadow). |

Same core pieces in both: **locked** icon + eyebrow, **label**, **password `TextEntry`**, **helper**, **validation**, **`onSubmit`**.

The root is **`@ux/box`** with **`elevation="raised"`** (composer) or **`base`** (conversation); register **`@ux/box`** styles with your UXCore2 theme like other elevated surfaces (**`FloatingFooter`**, **`ChoiceList`** card, etc.). **`@airo-ux/pattern-library/input/secrets-form/styles`** adds layout and field chrome only — it does not duplicate Box’s shadow stack. In **`variant="composer"`**, the card’s horizontal cap is **`max-width: min(var(--airo-input-secrets-form-max-width), 100%)`** with default **`--airo-input-secrets-form-max-width: calc(var(--airo-input-secrets-form-density) * 83)`** (scales with **`ux.box.density`** — no raw **`px`**). Set that custom property on a wrapper (or **`:root`**) to match your column (e.g. **`44rem`** like **`ChatLayout`**’s **`--airo-chat-layout-chat-max-width`**), same pattern as **`ChatLayout`**’s **`--airo-chat-layout-*`** variables. The eyebrow is a real **`h3`** (caption-scale type from **`@ux/text`**); UA heading margins are normalized to **`0`** on **`.airo-input-secrets-form__eyebrow`**. To add vertical space around that line without raw **`px`**, set **`--airo-input-secrets-form-eyebrow-margin-block`** on **`.airo-input-secrets-form`** (it inherits), e.g. **`calc(var(--airo-input-secrets-form-density) * 0.25)`** — **`--airo-input-secrets-form-density`** is already defined on the form root from **`ux.box.density`**.

All async work stays in the consumer via **`onSubmit`** / **`onClose`**. This component does **not** render **`Thinker`**, **`AgentMessage`**, or any post-submit status UI—the host adds those after **`onSubmit`** returns.

```tsx
import { SecretsForm } from '@airo-ux/pattern-library/input/secrets-form';
import '@airo-ux/pattern-library/input/secrets-form/styles';

async function saveSecret(_value: string) {
  /* Persist via your BFF; do not log the raw value. */
}

/** Replaces the composer (default). `SecretsForm` dismisses after a successful `onSubmit`—restore your prompt surface in that callback (or when handling `onClose`). */
export function ComposerExample() {
  return (
    <SecretsForm
      label="DISCOGS_TOKEN:"
      helperText="Personal access token from discogs.com/settings/developers"
      onSubmit={(value) => {
        void saveSecret(value);
        // e.g. setState to show PromptBox again; optional Thinker / AgentMessage in host
      }}
      onClose={() => {
        dismissSecretPrompt();
      }}
    />
  );
}

/** In-thread card. Same dismiss-on-submit; host removes the message row or appends status siblings. */
export function ConversationExample() {
  return (
    <SecretsForm
      variant="conversation"
      label="DISCOGS_TOKEN:"
      helperText="Personal access token from discogs.com/settings/developers"
      onSubmit={(value) => {
        void saveSecret(value);
        // e.g. stop rendering this row; show Thinker / AgentMessage from host state — not from SecretsForm
      }}
      onClose={() => {
        dismissSecretPrompt();
      }}
    />
  );
}
```

This mirrors the idea behind **`ChoiceList`**’s **`variant="minimal"`** ([`ChoiceList` README](../../chat/choice-list/README.md)): the host owns the outer frame; the component adjusts chrome for **in-thread** vs **dedicated surface**. Like **`ChoiceList`** after **`onDecision`**, **`SecretsForm`** **dismisses** (renders **`null`**) once **`onSubmit`** runs successfully (**sync** or **`Promise`** resolved) when a handler **is** provided; if **`onSubmit`** is omitted, a valid submit is a **no-op** and the form stays mounted. The host should be prepared to swap the composer back, pop the inline row, and/or append **`Thinker`** / **`AgentMessage`** (or equivalent) **outside** this component for persistence status. A **rejected** **`Promise`** or **thrown** error leaves the form mounted for retry.

## When to use

- **`composer`** — The agent asked for a secret and the product **replaces the composer** with this card until the user submits or dismisses.
- **`conversation`** — The agent asked for a secret and the product **keeps the transcript** and renders this card **below the agent message** (or equivalent).

### `borderless`

Set **`borderless`** to drop the form's outer card chrome (background, border, radius, elevation, focus ring) when nesting it inside a host that already provides a surface — e.g. a **`PromptBox`** expansion area or a **`PromptStage`** swap slot. The internal lockup, input row, and toolbar / footer stay intact; only the outer shell becomes invisible. Composes with both **`variant="composer"`** and **`variant="conversation"`**.

## When not to use

- Full secrets management UI (listing, deleting, rotating). Use a dedicated settings page.
- Collecting multiple secrets at once (one instance = one secret).
- Auto-submit without user interaction—handle in the consumer without this UI.

## Actions & hooks

| User action | `composer` (default) | `conversation` |
|-------------|----------------------|----------------|
| Submit | **Send** (icon) or **Enter** in the field (not **Shift+Enter**) | **Save** or **Enter** in the field (same rules) |
| Dismiss | Header **X** → **`onClose()`** (always available in **`composer`**) | **Cancel** → **`onClose()`** — **Cancel** is omitted when **`onClose`** is omitted |
| Typing | **`onChange(raw)`** on every change; submit uses **trimmed** value | Same |

| Callback | When it runs |
|----------|----------------|
| **`onChange(value)`** | Each change to the field; **`value`** is the raw string (not trimmed). |
| **`onSubmit(trimmed)`** | When **`onSubmit`** is set: runs after a valid submit path (not **`pending`**), **before** dismiss. If **`onSubmit`** **throws** or returns a **rejected `Promise`**, the form **stays mounted** for retry. When **`onSubmit`** is **omitted**, valid submit does **not** dismiss (no-op). |
| **`onClose()`** | **X** or **Cancel** click. Does **not** auto-dismiss the form (host may still unmount in this callback). |

**After successful `onSubmit`:** the component renders **`null`** until it is **remounted** (e.g. new React **`key`** when the agent asks for another secret). It does **not** render **`Thinker`**, **`AgentMessage`**, or any other follow-up UI.

**Controlled `value`:** the parent owns the string. After **`onSubmit`**, the field is gone (dismissed); remount or change **`key`** to collect again. **Uncontrolled:** internal value is cleared before dismiss.

## Validation

- **`minLength`** (default `1`) applies to the **trimmed** value before **`onSubmit`**. Optional **`maxLength`** limits the **raw** character count (matches the native **`maxLength`** attribute). The primary control stays disabled until valid.
- Optional **`validate(trimmed)`** returns an error string to block submit and show it in a native **`<output>`** live region (**`aria-live="polite"`**), or `undefined` when valid.
- Optional **`validationMessages`** overrides the English defaults for **`empty`**, **`minLength(n)`**, and **`maxLength(n)`** (localization).
- **Regex / disclosure:** client rules do not leak the typed value; very specific patterns in public bundles can hint format. Prefer generic messages and **server-side** checks; never log secrets on validation failure.

## Accessibility

| Key | `composer` | `conversation` |
|-----|--------------|----------------|
| `Tab` | Close → field → show/hide (if value) → Send | Field → show/hide (if value) → Save → Cancel (if `onClose` is set) |
| `Enter` | Submits when valid | Same |

- The **locked** icon is decorative (`aria-hidden`); the eyebrow (**`h3`**, default **"New Secret"**) carries the cue visually (title case, short heading, no terminal period).
- The secret name is a **`<label htmlFor={…}>`** for the field (accessible name); **`aria-describedby`** includes helper and error ids when present.
- **`variant="composer"`** always renders the header **X**; it uses **`closeLabel`** (default “Close”). **`showSecretLabel`** / **`hideSecretLabel`** override the visibility toggle’s **`aria-label`** (defaults **“Show value”** / **“Hide value”**). **`variant="conversation"`** uses **`submitLabel`** / **`cancelLabel`** for visible Save/Cancel text (defaults **“Save”** / **“Cancel”** when omitted).

## Gotchas

- **`pending`** disables submit; the consumer owns any saving spinner or copy (this component does not change the button label or icon for loading).
- **`onSubmit`** should be wired in production: when omitted, a valid submit **does not** dismiss the form (no-op).
- **Show/hide** only appears when the raw field has characters.
- **Visibility** resets when the value becomes empty (including after submit in uncontrolled mode).
- **`forwardRef`** targets the **`TextEntry`** `<input>` while the form is mounted; after submit the input unmounts and the ref clears like any unmounted child.
- **`variant="conversation"`** omits the header **X**; provide **`onClose`** so users can dismiss via **Cancel** (Cancel is omitted if `onClose` is not passed).
- **`variant="composer"`** — while the field has focus, the card’s transparent border shows **`ux.box.foregroundColor`** on **`:focus-within`** so the edge matches the borderless chat input in Airo Builder (the **`TextEntry`** shell outline is suppressed so the ring is not doubled).
- **`variant="conversation"`** — the outer card keeps a normal **`ux.box.borderColor`** edge when the field is focused; keyboard focus uses the **`@ux/text-entry`** shell’s built-in outline (the outer card does not switch to a high-contrast border on `:focus-within`).
- **Stylesheet contract:** padding, placeholder tone, plaintext ellipsis, and composer shell-outline suppression target the **native `input` / `textarea`** under our **`airo-input-secrets-form__entry`** `className` (not `.ux-text-entry-*` UXCore class names). That still assumes **`TextEntry`** keeps a single native control in the shell—prefer a future **`@ux/text-entry`** padding/chromeless API when available.

**`SecretsFormProps`** is a discriminated union: **`onClose`** is **required** for **`variant="composer"`** (default) and **optional** for **`variant="conversation"`**. The root is layout-only (no **`children`**). Props are documented on **`SecretsFormProps`** / **`SecretsFormComposerProps`** / **`SecretsFormConversationProps`** and in Storybook autodocs.

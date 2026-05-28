# CtaButton

Call-to-action widget for the chat input area. Replaces the composer with a focused prompt for external actions (e.g., OAuth authentication, approvals, confirmations).

## When to use

- An AI agent needs the user to complete an external action before continuing (e.g., authenticate with a third-party service, approve a request).
- The action is blocking — the conversation cannot proceed until the user acts or dismisses the prompt.
- The action is simple enough to be represented by a single button (not a form with multiple fields).

Use **`CtaButton`** when the agent's next step depends on user action *outside* the chat (opening a popup, navigating to another tab, granting permission). It replaces the chat input to focus attention on the required action.

## When not to use

- The agent needs structured input from the user (text, selection, file upload) — use **`SecretsForm`**, **`ChoiceList`**, or **`PromptBox`** instead.
- The action is informational or optional — show it as an in-thread message with a button, not as an input-area replacement.
- The user is already in an error or loading state — layer status feedback on the existing UI instead of swapping it out.

## Accessibility

- The **title** is rendered as an **`<h3>`** so assistive technology announces the widget as a heading.
- The **close (X)** button has an `aria-label` (default **"Close"**, overrideable via `closeLabel`) so keyboard and screen-reader users can dismiss the prompt without taking action.
- The component does not move focus automatically; hosts can manage focus (for example, focusing the primary action) when swapping the widget into view.
- **Status messages** (success, error) use semantic color + text so they're perceivable without color vision.
- The **error state** includes a **retry** button and a **cancel** button so users can recover or exit without reloading.

## Variants

### Status states

The **`status`** prop controls the UI:

- **`pending`** (default): Shows helper text and the primary action button. Close (X) is visible.
- **`processing`**: Shows "Processing..." message. All buttons are disabled.
- **`success`**: Shows a success checkmark and message. Widget typically dismisses shortly after (host controls timing).
- **`error`**: Shows an error icon, optional error message, and **Retry** / **Cancel** buttons.

### Borderless mode

Set **`borderless={true}`** to strip the outer card chrome (background, border, radius, elevation). Use when nesting inside a host surface (e.g., **`PromptBox`** expansion area) that already provides a container.

## Usage

### Basic authentication prompt

```tsx
import { CtaButton } from '@airo-ux/pattern-library/input/cta-button';
import AsyncIcon from '@ux/icon/async-icon.js';
import '@airo-ux/pattern-library/input/cta-button/styles';

<CtaButton
  icon={<AsyncIcon icon="user-locked" />}
  title="Authentication Required"
  description="This action requires GoDaddy OAuth permission."
  helperText="A popup window will open for secure authentication."
  actionLabel="Authenticate with GoDaddy"
  onAction={async () => {
    await openAuthPopup();
  }}
  onClose={() => {
    dismissAuthPrompt();
  }}
/>
```

### Controlled status with error handling

```tsx
const [status, setStatus] = useState<CtaButtonStatus>('pending');
const [error, setError] = useState<string | null>(null);

<CtaButton
  icon={<AsyncIcon icon="shield-check" />}
  title="Approval Required"
  description="This action requires your approval to proceed."
  actionLabel="Approve"
  status={status}
  errorMessage={error}
  onAction={async () => {
    setStatus('processing');
    try {
      await submitApproval();
      setStatus('success');
      // Dismiss widget after brief delay
      setTimeout(() => dismissWidget(), 1500);
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  }}
  onClose={() => {
    dismissWidget();
  }}
/>
```

### Borderless inside PromptBox

```tsx
<PromptBox expansion={expanded}>
  <CtaButton
    borderless
    icon={<AsyncIcon icon="external-link" />}
    title="External Action Required"
    description="Continue in the new window to complete this step."
    actionLabel="Open Window"
    onAction={() => {
      openExternalFlow();
      collapsePromptBox();
    }}
    onClose={() => {
      collapsePromptBox();
    }}
  />
</PromptBox>
```

## Props

See [`CtaButton.tsx`](./CtaButton.tsx) for the full **`CtaButtonProps`** interface. Key props:

- **`icon`** (required): React node, typically a UXCore `<AsyncIcon>`.
- **`title`**: Heading text (default **"Action Required"**).
- **`description`** (required): Explanation of what action is needed.
- **`helperText`**: Optional supplementary text (e.g., "A popup will open...").
- **`actionLabel`**: Label for the primary button (default **"Continue"**).
- **`closeLabel`**: Label for the close (X) button (default **"Close"**).
- **`onAction`**: Callback when the user clicks the primary button (sync or async).
- **`onClose`** (required): Callback when the user clicks close (X).
- **`status`**: Current state — **`pending`** | **`processing`** | **`success`** | **`error`**.
- **`processingMessage`**: Text shown when **`status="processing"`** (default **"Processing..."**).
- **`successMessage`**: Text shown when **`status="success"`** (default **"Action completed successfully"**).
- **`errorLabel`**: Label shown in error state header (default **"Action failed"**).
- **`errorMessage`**: Additional error details shown when **`status="error"`**.
- **`retryLabel`**: Label for the retry button in error state (default **"Try Again"**).
- **`cancelLabel`**: Label for the cancel button in error state (default **"Cancel"**).
- **`borderless`**: Drop outer card chrome (default **`false`**).

### i18n / Localization

All text strings are overridable via props. For localized applications, pass translated strings for:
**`title`**, **`description`**, **`helperText`**, **`actionLabel`**, **`closeLabel`**, **`processingMessage`**, **`successMessage`**, **`errorLabel`**, **`errorMessage`**, **`retryLabel`**, and **`cancelLabel`**. See the **`CustomMessages`** story for an example.

## Gotchas

- **Host must manage dismissal timing.** In **`success`** state, the widget shows the success message but does not auto-dismiss — the host should set a timeout or immediately remove the widget based on the user flow.
- **`onAction` can be async but the component does not track its promise state.** If you need to control the UI during the action (e.g., show "Processing..."), pass **`status="processing"`** explicitly when your async work starts and **`status="success"`** or **`status="error"`** when it completes. The component has an internal guard against double-submission, but status control is the host's responsibility.
- **The close (X) button only appears in `pending` state.** In **`processing`**, **`success`**, or **`error`** states, the user cannot close the widget via the (X) — they must use the error-state **Cancel** button or wait for the host to dismiss it.
- **Icon color** defaults to **`intent('ux.figure.figureColor4')`** (theme figure slot). Override **`--airo-input-cta-button-icon-color`** on an ancestor element to customize without editing the package (e.g., `style={{ '--airo-input-cta-button-icon-color': 'var(--custom-brand-color)' }}`).
- **Max width** defaults to **`~83× ux.box.density`** (same as **`SecretsForm`**). Override **`--airo-input-cta-button-max-width`** on a wrapper when the input strip has a different width cap.

## Related

- **`SecretsForm`** — when the agent needs a text secret (API key, token).
- **`ChoiceList`** — when the agent offers multiple options to choose from.
- **`PromptBox`** — expandable input area for richer interactions.

---
name: conversations
description: Install the GoDaddy Conversations chat/messaging widget on the site.
whenToUse: User wants a chat widget, live chat, customer messaging, contact widget, or support chat on their site. Phrases like "add chat", "live chat", "customer support widget", "Conversations", "chat with customers", "messaging widget".
enablementId: conversations
intents:
  - chat widget/live chat/customer messaging/support chat/contact widget/chat bubble
---

# GoDaddy Conversations Widget

Installs the GoDaddy Conversations chat widget on the site.

## Architecture

- **`src/lib/conversations.config.json` drives rendering.** The CDN script reads `window._support` to determine what to show. `ConversationsWidget.tsx` merges config into `window._support` from the JSON file.
- **Tools own the config file.** The `setup_widget` and `update_widget_config` tools read, merge, and write `src/lib/conversations.config.json` directly. The agent never edits the config file manually.
- **The backend is kept in sync.** The tools update the Reamaze embeddable so that widget settings stay consistent when the user edits the widget from other surfaces (e.g. the Conversations dashboard).
- **Account** — the Conversations tenant for this site. Discovered via `conversations__discover_account` and selected via `conversations__select_account`.
- **Embeddable** — the backend widget config. Holds position, colors, icon. We use the first (default) one per account, or create one if none exist.
- **Auth** — tools dispatch calls via `ClientActionService` through the browser to `/api/conversations` (BFF). The BFF validates the user's `auth_idp` cookie and forwards the request. The authenticated builder user is the identity.

## Step 0: Discover Account

Before setting up the widget, ensure a Conversations account is configured:

```typescript
conversations__discover_account({});
```

Outcomes:
- **`alreadyConfigured: true`** — account is already linked, proceed to Step 1.
- **`accountCreated: true`** — a new account was provisioned automatically, proceed to Step 1.
- **`noAccounts: true`** — user has no Conversations accounts and no entitlements available. Inform them they need a Conversations subscription.
- **`error`** — display the error to the user.

No user interaction is needed at this step — the tool resolves the account automatically.

## Step 1: Install Templates

**First-time install:**

```typescript
skill({ action: 'install', skill: 'conversations' });
```

**Re-installing** (e.g., after a template update): pass `overwrite: true`, otherwise the skill loader skips existing files:

```typescript
skill({ action: 'install', skill: 'conversations', overwrite: true });
```

Installs:
- `src/lib/conversations.config.json` — widget configuration (managed by tools)
- `src/components/ConversationsWidget.tsx` — side-effect component that reads the config and mounts the CDN script

## Step 2: Wire Up the Widget

```typescript
conversations__setup_widget({ color: '#90ee90' });
```

What it does:

1. Reads `brandId` from memory (errors with `brandNotProvisioned` if missing).
2. Lists embeddables for the brand; reuses the first, or creates one if none exist.
3. Updates the embeddable with the webChat icon + color provided (backend sync).
4. Caches `embeddableId` to memory.
5. **Writes `src/lib/conversations.config.json`** with account and color.

Idempotent — re-running is safe. Color is optional (defaults to the account's existing color).

## Step 3: Mount the Widget at the App Root

After `setup_widget` succeeds, edit `src/App.tsx` (or the top-level layout) and render `<ConversationsWidget />` once, outside any route switch:

```tsx
import ConversationsWidget from './components/ConversationsWidget';

function App() {
  return (
    <>
      <Router>
        <Routes>...</Routes>
      </Router>
      <ConversationsWidget />
    </>
  );
}
```

The component is side-effect only (renders `null`). It reads config from `conversations.config.json`, sets `window._support`, and injects the CDN script.

**Cookie consent:** The widget only loads after the visitor accepts cookies via the CookieBanner (reads `c2_analytics_consent` from localStorage). If consent hasn't been granted, the chat bubble won't appear.

---

## Updating Widget Configuration

To change widget settings after initial setup, call the tool:

```typescript
conversations__update_widget_config({ color: '#1e40af', position: 'bottom-right', labelText: 'Ask us a question!' });
```

The tool syncs to the Conversations backend and writes the config file — no manual file editing needed. Omit a field to leave it unchanged.

---

## Common Mistakes

- **Manually editing `conversations.config.json`.** The tools own this file. Always use `update_widget_config` to change settings — it keeps the backend and config in sync.
- **Modifying existing page content when adding the widget.** Adding the widget is additive — mount `<ConversationsWidget />` at the app root and call the setup/config tools. Do NOT rewrite or restructure the existing page/layout.
- **Re-installing without `overwrite: true`.** The skill loader skips existing files by default.
- **Skipping `discover_account`.** Always call `discover_account` before `setup_widget` — it ensures the account is configured.
- **Using `select_account` unnecessarily.** The normal flow uses `discover_account` which handles creation automatically. Only use `select_account` for manual overrides (e.g., linking a specific existing account).
- **Mounting inside `<Routes>`.** The widget must be at the app root so the script loads on every page.
- **Removing the cookie consent check.** The Conversations script sets third-party cookies and must not load until the visitor opts in.
- **Writing widget visual settings to memory.** Don't — the backend is the source of truth. The only things we store are the pointer IDs.

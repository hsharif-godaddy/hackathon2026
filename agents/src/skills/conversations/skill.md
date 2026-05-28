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

- **`src/lib/conversations.config.ts` drives rendering.** The CDN script reads `window._support` to determine what to show. `ConversationsWidget.tsx` sets `window._support = config.support` from the config file — the agent edits the config, never the component.
- **The agent is the sole writer of the config file.** The `setup_widget` tool returns `brandId` — the agent writes it (along with color/position) into `src/lib/conversations.config.ts`. Tools never write to this file.
- **The backend is for sync only.** The tools update the embeddable so that widget settings stay consistent when the user edits the widget from other surfaces (e.g. the Conversations dashboard). The agent must always update BOTH the config file (page rendering) and the backend (sync).
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
- `src/lib/conversations.config.ts` — widget configuration (the agent edits this file)
- `src/components/ConversationsWidget.tsx` — side-effect component that reads the config and mounts the CDN script

## Step 2: Wire Up the Widget

```typescript
conversations__setup_widget({ color: '#90ee90', position: 'bottom-left' });
```

What it does:

1. Reads `brandId` from memory (errors with `brandNotProvisioned` if missing).
2. Lists embeddables for the brand; reuses the first, or creates one if none exist.
3. Updates the embeddable with the webChat icon + any color/position provided (backend sync).
4. Caches `embeddableId` to memory.
5. Returns `brandId` for you to write into the config file.

Idempotent — re-running is safe. Color and position are optional (defaults to bottom-right, default color).

**After this tool succeeds**, edit `src/lib/conversations.config.ts` to set `account` (brandId) and color/position:

```typescript
export const config = {
  support: {
    account: '<brandId from tool response>',
    ui: {
      widget: {
        icon: 'webChat',
        color: '#90ee90',
        position: 'bottom-left',
      },
    },
  },
};
```

Only apply the file edit if the tool call succeeded. The tool syncs to the backend; the config edit makes the page render correctly. Both must always match.

## Step 3: Mount the Widget at the App Root

Edit `src/App.tsx` (or the top-level layout) and render `<ConversationsWidget />` once, outside any route switch:

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

The component is side-effect only (renders `null`). It reads `config.support` from `conversations.config.ts`, sets `window._support`, and injects the CDN script.

**Cookie consent:** The widget only loads after the visitor accepts cookies via the CookieBanner (reads `c2_analytics_consent` from localStorage). If consent hasn't been granted, the chat bubble won't appear.

---

## Updating Widget Configuration

To change color or position after initial setup:

1. **Call the tool first** (syncs to Conversations backend):

```typescript
conversations__update_widget_config({ color: '#1e40af', position: 'bottom-right' });
```

2. **Only if the tool succeeds**, edit `src/lib/conversations.config.ts` to update `config.support.ui.widget` with the same values:

```typescript
export const config = {
  support: {
    account: '...',
    ui: {
      widget: {
        icon: 'webChat',
        color: '#1e40af',
        position: 'bottom-right',
      },
    },
  },
};
```

Omit a field to leave it unchanged (keep the existing value in both the tool call and the file).

**IMPORTANT:** Always call the backend tool first, then apply file changes. Never edit the file without a successful backend call — this ensures the page and backend stay in sync. If the tool fails, do not edit the file.

---

## Common Mistakes

- **Modifying existing page content when adding the widget.** Adding the widget is additive — mount `<ConversationsWidget />` at the app root and call the setup/config tools. Do NOT rewrite or restructure the existing page/layout.
- **Re-installing without `overwrite: true`.** The skill loader skips existing files by default.
- **Skipping `discover_account`.** Always call `discover_account` before `setup_widget` — it ensures the account is configured.
- **Using `select_account` unnecessarily.** The normal flow uses `discover_account` which handles creation automatically. Only use `select_account` for manual overrides (e.g., linking a specific existing account).
- **Mounting inside `<Routes>`.** The widget must be at the app root so the script loads on every page.
- **Removing the cookie consent check.** The Conversations script sets third-party cookies and must not load until the visitor opts in.
- **Writing widget visual settings to memory.** Don't — the backend is the source of truth. The only things we store are the pointer IDs.

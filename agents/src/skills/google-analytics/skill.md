---
name: google-analytics
description: Add Google Analytics 4 (GA4) to track page views and user behavior
whenToUse: >-
  User wants to add analytics, track visitors, measure website traffic, or
  understand user behavior. Phrases like "add analytics", "track visitors",
  "Google Analytics", "GA4", "website stats", "page view tracking",
  "visitor tracking", "analytics dashboard", "track user behavior",
  "website metrics", "measure conversions", "how many visitors",
  "traffic analytics", "track clicks", "user tracking", "site statistics".
  NOT for SEO optimization or search rankings — use the seo skill for those.
intents:
  - add analytics
  - Google Analytics
  - GA4
  - track visitors
  - website analytics
  - visitor stats
  - page view tracking
  - track user behavior
  - website metrics
  - how many visitors
  - traffic analytics
---

# Google Analytics Skill

Add Google Analytics 4 (GA4) to track page views and visitor behavior. Tracking only activates after the visitor accepts the cookie consent banner (GDPR compliant).

> **Note:** This skill uses `checkConfiguration` and `installAnalytics` tools with stateful workflow tracking. State persists across interruptions and conversation summarization.

---

## Flow

### Step 1: Check configuration

Call `google-analytics__checkConfiguration()` to verify the GA_MEASUREMENT_ID secret exists.

**Possible outcomes:**

- **Configured** (`configured: true`) → Skip to Step 3
- **Not configured** (`action: 'requiresSecret'`) → Proceed to Step 2
- **Error** (`error: string`) → Relay error to user, suggest retry

### Step 2: Request the Measurement ID

```typescript
requestSecrets({
  title: 'Google Analytics Measurement ID',
  description: 'Get from Google Analytics → Admin → Data Streams → your stream.',
  secrets: [
    {
      name: 'GA_MEASUREMENT_ID',
      label: 'GA4 Measurement ID',
      placeholder: 'G-XXXXXXXXXX',
      required: true,
    },
  ],
  mode: 'add',
});
```

Wait for user to save the secret, then proceed to Step 3.

### Step 3: Install analytics

Call `google-analytics__installAnalytics()`. This deterministically:

- Installs `src/components/GoogleAnalytics.tsx` — consent-gated GA4 component
- Installs `src/server/api/analytics/config/GET.ts` — serves Measurement ID securely (and registers the API route)
- Patches `src/layouts/RootLayout.tsx` to include `<GoogleAnalytics />`

### Step 4: Confirm to user

Tell the user:
> "Google Analytics is set up. Tracking will activate once visitors accept the cookie banner. To verify: open GA4 → Reports → Realtime while browsing your published site."

---

## Resuming After Interruption

**This skill uses stateful workflow tracking.** If the workflow is interrupted (secret form, errors, conversation summarization), the agent can resume from the last checkpoint.

**On skill load, always check `current_state` in the applied_skills context:**

| State | Next Step | Action |
|-------|-----------|--------|
| `unconfigured` | `request-secret` | Secret not found → call requestSecrets |
| `configured` | `install-analytics` | Secret exists → call installAnalytics |
| `check-failed` | `retry-check` | Previous check errored → retry checkConfiguration |
| `install-failed` | `retry-install` | Installation errored → retry installAnalytics |
| `installed` | `confirm-to-user` | Everything done → confirm success to user |

---

## Cookie Consent

The `GoogleAnalytics` component uses `getAnalyticsConsent` and `onConsentChange` from `src/lib/analytics-consent.ts` (included in every v8 app). It only loads `gtag.js` after the visitor accepts the cookie banner — no changes to the banner are needed.

---

## Important Notes

- The Measurement ID (`G-XXXXXXXXXX`) is served via `/api/analytics/config` at runtime — no rebuild needed if the ID changes
- The component tracks SPA page changes automatically using React Router's `useLocation`
- Analytics failures are silently swallowed — GA must never break the app
- The `installAnalytics` tool is idempotent — safe to call if analytics is already installed
- Do NOT manually edit RootLayout.tsx — the tool handles patching automatically
- Do NOT create custom API endpoints for analytics — the template provides the correct one

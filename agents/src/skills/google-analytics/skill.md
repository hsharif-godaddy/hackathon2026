---
name: google-analytics
description: Add Google Analytics 4 (GA4) to track page views and user behavior
whenToUse: >-
  User wants to add analytics, track visitors, or measure website traffic.
  Phrases like "add analytics", "track visitors", "Google Analytics", "GA4",
  "website stats", "page view tracking", "visitor tracking", "analytics dashboard".
  NOT for SEO optimization or search rankings — use the seo skill for those.
intents:
  - google analytics/GA4/track visitors/website analytics/visitor stats/page view tracking
---

# Google Analytics Skill

Add Google Analytics 4 (GA4) to track page views and visitor behavior. Tracking only activates after the visitor accepts the cookie consent banner (GDPR compliant).

---

## When to Use

User mentions: "analytics", "Google Analytics", "GA4", "track visitors", "website stats", "page views"

---

## Flow - FOLLOW THIS ORDER

### Step 1: Request the Measurement ID

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

### Step 2: Install template files

```typescript
skill({ action: 'install', skill: 'google-analytics' });
```

This installs:
- `src/components/GoogleAnalytics.tsx` — consent-gated GA4 component
- `src/server/api/analytics/config/GET.ts` — serves the Measurement ID securely

### Step 3: Add to RootLayout

Open `src/layouts/RootLayout.tsx` and add the import and component:

```tsx
import GoogleAnalytics from '@/components/GoogleAnalytics';

// Inside the JSX, before </Website> or before <ScrollRestoration />:
<GoogleAnalytics />
```

### Step 4: Confirm to user

Tell the user:
> "Google Analytics is set up. Tracking will activate once visitors accept the cookie banner. To verify: open GA4 → Reports → Realtime while browsing your published site."

---

## Cookie Consent

The `GoogleAnalytics` component uses `getAnalyticsConsent` and `onConsentChange` from `src/lib/analytics-consent.ts` (included in every v8 app). It only loads `gtag.js` after the visitor accepts the cookie banner — no changes to the banner are needed.

---

## Notes

- The Measurement ID (`G-XXXXXXXXXX`) is served via `/api/analytics/config` at runtime — no rebuild needed if the ID changes
- The component tracks SPA page changes automatically using React Router's `useLocation`
- Analytics failures are silently swallowed — GA must never break the app

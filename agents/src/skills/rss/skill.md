---
name: rss
description: Add an RSS 2.0 feed endpoint for blog content with autodiscovery
whenToUse: User wants an RSS feed, blog feed, content syndication, or subscribe functionality. Phrases like "add RSS", "RSS feed", "blog feed", "syndication", "content feed", "subscribe to blog", "add a feed", "XML feed".
intents:
  - add RSS feed/blog feed/XML feed
---

# RSS Feed Skill

**Purpose:** Install an RSS 2.0 feed endpoint at `/feed.xml` for blog content, with autodiscovery via `<link rel="alternate">` in the HTML `<head>`.

---

## When to Use This Skill

**User says:**

- "Add an RSS feed"
- "Add a blog feed"
- "I want people to subscribe to my blog"
- "Add syndication"
- "Create an XML feed"
- "Content feed"

**Invocation:** User-request only. This skill is NOT loaded proactively or automatically. The agent loads it only when the user explicitly asks for an RSS/blog feed.

---

## Prerequisites

**Required:** Blog system must be installed.

Check: Does `src/lib/blog.ts` exist?

- **Yes** → proceed with installation
- **No** → tell the user: "RSS requires a blog. Let me set up the blog first." Then: `skill({ action: 'load', skill: 'blog' })`

**Check for existing RSS:** Does `src/server/entry.ts` already contain `/feed.xml`?

- **Yes** → tell the user: "RSS feed is already installed at `/feed.xml`." STOP.
- **No** → proceed with installation

---

## Step-by-Step Installation

### Step 0: Install RSS Template (REQUIRED FIRST STEP)

```typescript
skill({
  action: 'install',
  skill: 'rss',
});
```

This copies the RSS route handler to `src/server/rss.ts`.

### Step 1: Register Route in `src/server/entry.ts`

**Read `src/server/entry.ts` first.**

Add the import near the top of the file (OUTSIDE the `<api-imports>` markers — RSS is a top-level resource like sitemap.xml, not an API route):

```typescript
import { rssHandler } from "./rss";
```

Add the route registration AFTER the `/sitemap.xml` handler and BEFORE static file serving:

```typescript
app.get("/feed.xml", rssHandler);
```

**⚠️ CRITICAL: Do NOT place inside `<api-imports>` or `<api-registrations>` markers.** Those are managed by auto-sync and will overwrite your changes. Place adjacent to the existing `/robots.txt` and `/sitemap.xml` handlers.

### Step 2: Add Autodiscovery Link to `src/layouts/RootLayout.tsx`

**Read `src/layouts/RootLayout.tsx` first.**

Inside the `<Helmet>` block, add:

```tsx
<link rel="alternate" type="application/rss+xml" title="Blog Feed" href="/feed.xml" />
```

### Step 3: Update Feed Metadata in `src/server/rss.ts`

**Read the installed `src/server/rss.ts` and read `src/layouts/RootLayout.tsx`.**

At the top of `rss.ts`, update the constants to match the site's identity:

```typescript
const FEED_TITLE = "Site Name - Blog";  // Use the site's actual name from Helmet
const FEED_DESCRIPTION = "Description matching the site";  // From Helmet meta description
const FEED_LANGUAGE = "en";  // Match site locale if non-English
```

Rules:
- If Helmet title is "App Template" or empty → use "Blog"
- If Helmet description is generic or empty → use "Latest blog posts"
- If title doesn't contain "blog" → append " - Blog" (e.g., "FitFlow Studio - Blog")
- If site targets a non-English audience → update `FEED_LANGUAGE` (e.g., "es", "fr", "de")
- Match the site's brand and tone

### Step 4: STOP — Confirm to User

Tell the user:

> "RSS feed installed at `/feed.xml`! Feed readers and search engines can now discover and subscribe to your blog. The feed auto-updates whenever you publish new posts."

---

## Technical Notes

- The handler uses `import.meta.glob` to embed blog `.md` files at build time (same pattern as the blog content loader)
- Only published posts with `publishedAt` in the past are included
- Feed is limited to 100 most recent posts
- Cache-Control is 1 hour (`max-age=3600`)
- Feed is only served in production builds (same as sitemap.xml — Vite dev mode only proxies `/api/*`)
- No external dependencies required

---

## Summary

**What this skill does:**

- ✅ Installs RSS route handler at `src/server/rss.ts`
- ✅ Registers `/feed.xml` route in Express server
- ✅ Adds `<link rel="alternate">` autodiscovery to all pages
- ✅ Customizes feed title/description to match site brand

**What this skill does NOT do:**

- ❌ Modify blog content or posts
- ❌ Add any UI components
- ❌ Install npm dependencies
- ❌ Create database tables

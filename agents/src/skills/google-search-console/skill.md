---
name: google-search-console
description: Connect Google Search Console to submit sitemaps and improve Google indexing
whenToUse: User wants to connect Google Search Console, submit their sitemap to Google, help Google find their site, improve Google indexing, or set up GSC.
intents:
  - Google Search Console/GSC/submit sitemap to Google/help Google find my site/Google indexing
---

# Google Search Console Skill

**Purpose:** Connect Google Search Console so the user's sitemap is automatically submitted to Google on every publish, helping Google discover and index their pages faster.

> **Current scope:** The agent triggers OAuth via `social-platform__socialConnect`. The chat widget handles OAuth and tag injection automatically. The user then needs to **publish their site** and click **"Verify with Google" in Settings → SEO** to complete ownership verification.

---

## When to Use This Skill

**User says:**

- "Connect Google Search Console"
- "Submit my sitemap to Google"
- "Help Google find my site"
- "Set up GSC"
- "Improve my Google indexing"
- "How do I get my site on Google?"

---

## Flow

### Step 1: Check connection

Call `google-search-console__checkGscConnection()` to verify GSC is already connected.

**Possible outcomes:**

- **Connected** (`connected: true`) → Tell the user GSC is active and their sitemap is submitted automatically on publish. Offer to open Settings → SEO for the dashboard link.
- **Not connected** (`action: 'requiresConnection'`) → Proceed to Step 2
- **Pending verification** (`action: 'pendingVerification'`) → Tag was injected but Google hasn't verified yet. Tell user: publish the site, then click "Verify with Google" in Settings → SEO.
- **Error** (`error: string`) → Relay error to user, suggest retry

### Step 2: Initiate OAuth (not connected path)

Load the social-platform skill, then call socialConnect:

```typescript
skill({ action: 'load', skill: 'social-platform' })
```

Then call:

```typescript
social-platform__socialConnect({ platform: 'GOOGLE_SEARCH_CONSOLE' })
```

**Stay silent** — let the UI handle the OAuth popup. Do not narrate what is happening.

### Step 3: After OAuth completes

The chat widget automatically injects the Google verification tag into the site's HTML after OAuth. Once the widget confirms the tag was injected, tell the user:

> "The Google verification tag has been added to your site! To finish:
> 1. **Publish your site** — makes the tag live so Google can find it
> 2. **Click 'Verify with Google' in Settings → SEO**
>
> Once verified, your sitemap will be submitted to Google automatically every time you publish."

### Step 4: Resume after interruption

**If this skill loads with `current_state` showing:**

- `workflowState: "pending-gsc-connection"` with `nextStep: "guide-publish-and-verify"`
  → OAuth was initiated; user may have authorized but not yet finished in Settings → SEO
  → Call `checkGscConnection` — if it returns `pendingVerification`, remind user to open Settings → SEO and publish

- `workflowState: "pending-verification"` with `nextStep: "guide-verify-in-settings"`
  → Tag has been injected but Google hasn't verified yet
  → Tell user: open Settings → SEO, publish the site, then click "Verify with Google"

- `workflowState: "connection-check-failed"` with `nextStep: "retry-connection-check"`
  → Previous check failed
  → Retry `checkGscConnection`

**Always check `current_state` before starting a new workflow** to avoid repeating completed steps.

---

## State Tracking

| State | Next Step | Action |
|-------|-----------|--------|
| `pending-gsc-connection` | `guide-publish-and-verify` | OAuth initiated → tell user to open Settings → SEO, publish, then verify |
| `pending-verification` | `guide-verify-in-settings` | Tag injected, waiting for publish + verify → remind user to go to Settings → SEO |
| `connection-check-failed` | `retry-connection-check` | Check failed → retry |
| `connected` | `inform-user` | Already connected → tell user |

---

## Important Notes

- After OAuth, the user **must publish their site** before Google can verify ownership (the tag needs to be live)
- After publishing, the user **must click 'Verify with Google' in Settings → SEO** to complete the connection
- Once verified, sitemaps are submitted **automatically on every publish** — no ongoing action needed
- The Google Search Console dashboard link is available in Settings → SEO once connected

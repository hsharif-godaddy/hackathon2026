---
name: google-reviews
description: Display Google Business Profile reviews on the site
whenToUse: User wants to show Google reviews, customer testimonials from Google, or star ratings from their Google Business Profile on their site. Do NOT use for connecting/syncing the listing or correcting business info (name, address, phone, hours, website, description), or for matching the site to the listing — that is google-business-profile-sync.
intents:
  - Google reviews/star ratings/Google Business Profile reviews
---

# Google Reviews Skill

**Purpose:** Fetch the user's Google Business Profile reviews and embed them as a reviews section on their site.

> **Note:** This skill provides Google reviews guidance and uses the `checkConnection` and `fetchReviews` tools with stateful workflow tracking. State persists across OAuth interruptions and conversation summarization.

---

## When to Use This Skill

**User says:**

- "Add my Google reviews to the site"
- "Show my Google reviews"
- "Display customer reviews from Google"
- "Add a reviews section from Google"
- "Show my star ratings"

---

## Flow

### Step 1: Check connection and handle OAuth

Call `google-reviews__checkConnection()` to verify Google Business Profile is connected.

**Possible outcomes:**

- **Connected** (`connected: true`) → Proceed to Step 2
- **Not connected** (`action: 'requiresConnection'`) → Load social-platform skill, then connect:
  ```typescript
  skill({ action: 'load', skill: 'social-platform' })
  ```
  Then call socialConnect (now active):
  ```typescript
  social-platform__socialConnect({ platform: 'GOOGLE_BUSINESS_PROFILE' })
  ```
  Then **stay silent** and let the UI handle OAuth. Wait for user to confirm completion.
- **Error** (`error: string`) → Relay error to user, suggest retry

> **Why load social-platform first:** Skill tools are only exposed via `activeTools` for loaded skills. Since google-reviews doesn't declare social-platform as a skill-dep, we must explicitly load it to activate `social-platform__socialConnect`.

**State tracking:** This tool always updates workflow state (even on errors), so if OAuth is interrupted or times out, the agent can resume from this step on the next turn.

### Step 2: Resume after OAuth (automatic)

**If this skill loads with `current_state` showing:**

- `workflowState: "pending-gbp-connection"` with `nextStep: "fetch-reviews-and-install"`
  → User was adding Google reviews but needed to connect GBP first
  → Check connection again, then proceed to fetch reviews

- `workflowState: "connection-check-failed"` with `nextStep: "retry-connection-check"`
  → Previous connection check failed
  → Retry checkConnection

**Always check `current_state` in the applied_skills context before starting a new workflow.** If state exists, resume from the recorded step instead of starting over.

### Step 3: Fetch reviews

Call `google-reviews__fetchReviews()`. This works in **two passes**:

1. **Pass 1:** Tool returns `action: 'fetchReviews'` signal → frontend fetches reviews via authenticated browser session → sends back context attachment
2. **Pass 2:** Call the tool again → it reads reviews from context attachment and returns the data

**Error handling:**

- `workflowState: "fetch-failed"` with `nextStep: "reconnect-gbp"` → Connection issue, load social-platform skill and reconnect:
  ```typescript
  skill({ action: 'load', skill: 'social-platform' })
  social-platform__socialConnect({ platform: 'GOOGLE_BUSINESS_PROFILE' })
  ```
- `workflowState: "fetch-failed"` with `nextStep: "retry-fetch"` → API error, retry fetchReviews
- `workflowState: "no-reviews-found"` → Valid response but no reviews, inform user

### Step 4: Install skill and generate component

Once reviews are successfully fetched (`workflowState: "reviews-fetched"`):

```typescript
skill({ action: 'install', skill: 'google-reviews' })
```

Then generate the `GoogleReviews` component with the fetched data:

```tsx
import GoogleReviews from '@/components/GoogleReviews';

// Place in the page where the user wants the reviews section
<GoogleReviews
  reviews={[
    // paste the reviews array returned by fetchReviews tool
  ]}
  title="What Our Customers Say"
  maxVisible={6}
/>
```

---

## Component Props

| Prop         | Type       | Default                    | Description                            |
| ------------ | ---------- | -------------------------- | -------------------------------------- |
| `reviews`    | `Review[]` | required                   | Array of review objects from the tool  |
| `title`      | `string`   | `"What Our Customers Say"` | Section heading                        |
| `maxVisible` | `number`   | `6`                        | Max reviews to display (1–10)          |
| `className`  | `string`   | `""`                       | Additional CSS classes for the section |

---

## Resuming After Interruption

**This skill uses stateful workflow tracking.** If the workflow is interrupted (OAuth, errors, conversation summarization), the agent can resume from the last checkpoint.

**On skill load, always check `current_state` in the applied_skills context:**

| State | Next Step | Action |
|-------|-----------|--------|
| `pending-gbp-connection` | `fetch-reviews-and-install` | User was adding reviews but needed OAuth → verify connection now exists, then fetch reviews |
| `connection-check-failed` | `retry-connection-check` | Previous check failed → retry checkConnection |
| `connected` | `fetch-reviews` | Connection verified → proceed to fetchReviews |
| `fetching-reviews` | `wait-for-context-attachment` | Waiting for frontend → context attachment should arrive next turn |
| `fetch-failed` (reconnect-gbp) | `reconnect-gbp` | Token expired → reconnect via socialConnect |
| `fetch-failed` (retry-fetch) | `retry-fetch` | API error → retry fetchReviews |
| `reviews-fetched` | `install-component` | Reviews retrieved → install skill and generate component |
| `no-reviews-found` | `inform-user` | No reviews available → tell user |

**Error recovery principle:** Each tool updates state on EVERY execution (success or failure). This creates a checkpoint system - you can always resume from the last known step without repeating successful earlier steps.

---

## Important Notes

- Reviews are **embedded at the time the agent runs** — they won't update automatically. Tell the user: *"Ask me to 'refresh my Google reviews' any time you want to update this section with your latest reviews."*
- The tool returns up to 10 reviews. Tell the user: *"I can display up to 10 of your most recent Google reviews."*
- The component displays reviewer name, star rating, comment, date, and a Google attribution badge.
- **State persistence:** Workflow state survives conversation summarization and OAuth interruptions. Always check `current_state` before starting a new workflow.

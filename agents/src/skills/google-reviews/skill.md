---
name: google-reviews
description: Display Google Business Profile reviews on the site
whenToUse: User wants to show Google reviews, customer testimonials from Google, or star ratings from their Google Business Profile on their site. Do NOT use for connecting/syncing the listing or correcting business info (name, address, phone, hours, website, description), or for matching the site to the listing — that is google-business-profile-sync.
intents:
  - Google reviews/ratings/testimonials
  - show customer reviews from Google
  - Google Business Profile reviews widget
  - star ratings from Google
  - social proof/review section
  - detach/switch/change Google Business Profile for reviews
---

# Google Reviews Skill

Fetch the user's Google Business Profile reviews and embed them as a reviews section. Reviews are embedded at build time — they won't auto-update. Tell the user they can ask to "refresh my Google reviews" anytime.

---

## Important: Switching / Detaching Business

**You CAN switch businesses.** If the user asks to detach, disconnect, switch, or change their connected Google Business Profile — call `executeWorkflow({ forceReconnect: true })`. This re-triggers OAuth even when a business is already connected, letting the user authenticate with a different account or select a different business. Never tell the user to contact support or that switching is impossible.

---

## Flow

Call `executeWorkflow`. The tool handles connection checking, OAuth signaling, and review fetching deterministically. Outcomes:

### Connected (phase: "complete", installSkill: true)

Reviews returned directly. Install the component, then inline the reviews JSON as a literal prop in the page source — no API route, no runtime fetch:

```typescript
skill({ action: 'install', skill: 'google-reviews' })
```

```tsx
import GoogleReviews from '@/components/GoogleReviews';

// Paste the reviews array from executeWorkflow output as a JSON literal here.
// This is static data baked into the source — not fetched at runtime.
<GoogleReviews
  reviews={[
    { reviewId: "abc1", reviewer: { displayName: "Jane D." }, starRating: "FIVE", comment: "Amazing service!", createTime: "2025-03-15T10:00:00Z", updateTime: "2025-03-15T10:00:00Z" },
    // ... remaining reviews from executeWorkflow result
  ]}
  title="What Our Customers Say"
  maxVisible={6}
/>
```

### OAuth Needed (phase: "awaiting-oauth")

Google Business Profile is not connected. The frontend renders an OAuth widget automatically. **Stay silent** — let the user complete authentication, then call `executeWorkflow` again.

### No Reviews (phase: "complete", installSkill: false)

Account is connected but has no reviews. Inform the user and suggest they ask again once they have reviews.

### Error (phase: "error")

If `recoverable: true`, call `executeWorkflow` again. Otherwise relay the error.

---

## Resuming After Interruption

Check `current_state` in applied_skills context before calling the tool:

- `phase: "awaiting-oauth"` → User was connecting GBP. Call `executeWorkflow` to re-check connection status.
- `phase: "error"` → Previous attempt failed. Call `executeWorkflow` to retry.
- `phase: "complete"` → Reviews already fetched. Install the skill and generate the component.

---

## Component Props

| Prop         | Type       | Default                    | Description                           |
| ------------ | ---------- | -------------------------- | ------------------------------------- |
| `reviews`    | `Review[]` | required                   | Array of review objects from the tool |
| `title`      | `string`   | `"What Our Customers Say"` | Section heading                       |
| `maxVisible` | `number`   | `6`                        | Max reviews to display (1–10)         |
| `className`  | `string`   | `""`                       | Additional CSS classes                |

---

## Constraints

- Reviews are **static data** — pass the array from `executeWorkflow` directly as a component prop. Do not create an API route to fetch reviews at runtime. Do not access OAuth tokens, `#airo/secrets`, or Google APIs from customer code. The tool already handled all authentication and fetching.
- Returns up to 10 reviews. Tell the user: "I can display up to 10 of your most recent Google reviews."
- Component shows reviewer name, star rating, comment, date, and Google attribution badge.

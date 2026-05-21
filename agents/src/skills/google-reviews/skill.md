---
name: google-reviews
description: Display Google Business Profile reviews on the site
whenToUse: User wants to show Google reviews, customer testimonials from Google, or star ratings from their Google Business Profile.
enablementId: googleReviews
intents:
  - Google reviews/star ratings/Google Business Profile reviews
---

# Google Reviews Skill

**Purpose:** Fetch the user's Google Business Profile reviews and embed them as a reviews section on their site.

> **Note:** This skill provides Google reviews guidance and uses the `googleReviews` and `socialRead` tools.

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

### Step 1: Check if Google Business Profile is connected

```typescript
socialRead({ platform: 'GOOGLE_BUSINESS_PROFILE' })
```

- If **no connections found**: load `social-platform` skill and connect GBP first, then return here.
- If **connected**: proceed to Step 2.

### Step 2: Fetch reviews

```typescript
googleReviews()
```

- On success: proceed to Step 3 with the returned reviews array.
- On error: relay the error message to the user. If the error mentions an expired token, ask them to reconnect.

### Step 3: Install skill and generate component

```typescript
skill({ action: 'install', skill: 'google-reviews' })
```

Then generate the `GoogleReviews` component with the fetched data:

```tsx
import GoogleReviews from '@/components/GoogleReviews';

// Place in the page where the user wants the reviews section
<GoogleReviews
  reviews={[
    // paste the reviews array returned by googleReviews tool
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

## Important Notes

- Reviews are **embedded at the time the agent runs** — they won't update automatically. Tell the user: *"Ask me to 'refresh my Google reviews' any time you want to update this section with your latest reviews."*
- The tool returns up to 10 reviews. Tell the user: *"I can display up to 10 of your most recent Google reviews."*
- The component displays reviewer name, star rating, comment, date, and a Google attribution badge.

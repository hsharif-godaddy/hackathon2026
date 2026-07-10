# Airo Pulse — Feature Specification
## GoDaddy Intern Hackathon Summer 2026

---

## Overview

Airo Pulse is an AI-powered site improvement tool built into Airo Builder. Once a site is
published, the owner taps a single button. The AI reads the site's codebase, identifies the
number one problem hurting conversions, and presents a plain-English fix with a screenshot of
the current site for visual context. The owner taps "Fix it" and the site updates and
republishes automatically.

No code. No dashboard. No technical knowledge required.

---

## The Problem Being Solved

Airo Builder is excellent at helping small business owners create and publish websites. But
once a site goes live, owners are completely on their own. The platform has analytics
infrastructure but it is hidden behind feature flags and requires technical knowledge to
interpret. The AI never proactively helps after launch.

Small business owners do not understand bounce rates or session durations. They want to know:
why aren't more people contacting me, and what should I change?

---

## Core User Flow

```
1. Owner opens Airo Builder (site must already be published)
2. Taps the "⚡ Pulse" button in the builder toolbar
3. AI reads the site's frontend codebase to find the problem
4. AI takes a screenshot of the published site (visual context for the owner only)
5. AI identifies the top problem from a defined list of three problem types
6. Pulse insight card appears in the chat panel
7. Owner reads the plain-English problem and fix description
8. Owner taps "Fix it"
9. Agent uses the already-read file context to make the targeted code change
10. Preview pane updates — owner sees the new version
11. Owner taps "Publish now"
12. Site goes live
```

---

## What Claude Does vs What the Owner Sees

These are two separate concerns and must not be confused.

### What Claude does (backend analysis)

Claude reads the site's frontend codebase to understand the structure and locate the problem
in actual code. It does NOT rely on screenshots for analysis — screenshots are unreliable for
determining things like CTA position relative to the fold.

Files Claude reads during analysis:
- `src/pages/index.tsx` — finds the CTA location
- `src/components/Hero.tsx` — understands the hero structure
- `src/components/Contact.tsx` — understands the contact form
- `src/layouts/RootLayout.tsx` — understands the overall page layout

Claude uses the codebase to determine exactly which file and which component needs to change.
This is reliable, deterministic, and gives the agent a precise fix target.

### What the owner sees (frontend UI)

The screenshot is purely for the owner. They cannot read code. They need to see their actual
site to understand what is being discussed. The screenshot confirms: "yes, that is my site,
I recognize it."

The screenshot is captured from the published URL using `websiteScraperAITool` which renders
the site headlessly without requiring a browser session.

---

## Problem Types

Scoped to three for the hackathon. The AI classifies which one applies based on reading the
codebase. It does not freestyle an open-ended analysis.

### `cta_buried`

**What it means:** The primary call-to-action button (Contact Us, Shop Now, Book Now, Get a
Quote) is so far down the page that most visitors leave before they ever see it. They land on
the site, scroll a little, get confused about what to do, and leave.

**Detection:** Claude reads the homepage component and identifies whether the primary CTA
element is rendered below other content that pushes it out of the initial viewport.

**Fix Option A:** Move the CTA button into the hero section above the fold.
**Fix Option B:** Add a sticky floating CTA button fixed to the bottom of the screen.

---

### `contact_hidden`

**What it means:** The contact form or contact information is hard to find or has too much
friction. Visitors who actually want to reach the business owner cannot figure out how. They
see a complicated form with too many required fields, get frustrated, and leave.

**Detection:** Claude reads the contact page component and identifies whether the form has
more than 3 required fields or whether the contact section is not prominently placed.

**Fix Option A:** Reduce the contact form to 2 fields — name and message.
**Fix Option B:** Move the contact form to the top of the contact page.

---

### `no_social_proof`

**What it means:** There are no reviews, testimonials, or star ratings visible on the site.
When a visitor sees no evidence that anyone else has used this business, they do not trust it
and leave. Social proof is one of the highest-impact additions to any small business site.

**Detection:** Claude reads the homepage and checks whether any testimonial, review, or
rating component exists anywhere in the component tree.

**Fix Option A:** Add a testimonials section with 3 placeholder reviews.
**Fix Option B:** Add a star rating badge near the primary CTA button.

---

## Data and Privacy

Per hackathon rules, no real customer or production data is used at any point.

### Analytics input

Fully synthetic mock data seeded with realistic visitor patterns. The mock matches the exact
schema of the real ClickHouse analytics system already in the platform — only the numbers are
synthetic. Claude receives realistic data and performs genuine analysis. The AI reasoning is
real, only the input numbers are mocked.

Mock data is seeded from `appId` so numbers vary between apps and feel realistic:

```typescript
const mockAnalytics = {
  totalHostPageViews: 28 + (seed % 20),
  totalHostUniqueVisitors: 24 + (seed % 15),
  bounceRate: '72%',
  avgSessionDuration: '0m 48s',
  clicksByElementData: [
    { element: 'Contact Button', clicks: 3 },
    { element: 'Hero Image', clicks: 12 },
    { element: 'Learn More', clicks: 8 },
  ],
  topCTALabelsData: [
    { label: 'Learn More', clicks: 8 },
    { label: 'Contact Us', clicks: 3 },
  ],
  exitRateData: [
    { page: '/contact', exitRate: 0.87 },
    { page: '/', exitRate: 0.74 },
  ],
  sessionsByDeviceData: [
    { device: 'Mobile', sessions: 21 },
    { device: 'Desktop', sessions: 7 },
  ],
}
```

### Screenshot input

The owner's own published Airo site rendered headlessly by `websiteScraperAITool`. Not
customer data — it is the same site the owner can visit publicly in any browser.

### Codebase read

The site's own source files stored in the app's working directory. Not customer data — this
is the code the owner built and owns.

---

## Technical Architecture

### Analysis flow

```
Owner taps ⚡ Pulse
          │
          ▼
POST /api/pulse/analyze
  { appId: string, publishedUrl: string }
          │
          ├── Claude reads frontend codebase files
          │     src/pages/index.tsx
          │     src/components/Hero.tsx
          │     src/components/Contact.tsx
          │     src/layouts/RootLayout.tsx
          │
          ├── getMockAnalytics(appId)
          │     returns seeded synthetic visitor data
          │
          ├── websiteScraperAITool(publishedUrl)
          │     returns base64 screenshot of live site
          │
          ▼
  Claude classifies problem using codebase + mock analytics
  Returns structured PulseInsight:
  {
    problemType: 'cta_buried' | 'contact_hidden' | 'no_social_proof',
    headline: string,
    description: string,
    suggestedFix: string,
    confidence: number,
    screenshotBase64: string,
    filesRead: string[],
  }
          │
          ▼
  Pulse insight card renders in chat panel
  Owner sees: screenshot + plain English problem + fix
          │
          ▼
  Owner taps "Fix it"
          │
          ▼
  PulseContextAttachment created:
  { type: 'pulse_insight', insight: PulseInsight }
          │
          ▼
  Develop agent receives context attachment
  Already has file context from analysis step — no re-reading
  Makes targeted code change to the identified file
          │
          ▼
  Preview pane updates
  Owner sees the visual change
          │
          ▼
  Owner taps "Publish now"
  Existing publish flow deploys the site
```

---

### Reliability and error handling

**Claude returns wrong problem type:**
Constrain Claude with Zod enum validation. If the response does not match one of the three
valid strings, fall back to `cta_buried` as the safe default. If confidence is below 0.5, do
not show a card — show "Your site looks good this week" instead.

```typescript
const VALID_TYPES = ['cta_buried', 'contact_hidden', 'no_social_proof'] as const
if (!VALID_TYPES.includes(result.problemType)) {
  result.problemType = 'cta_buried'
}
if (result.confidence < 0.5) {
  return { status: 'healthy', message: 'Your site looks good this week.' }
}
```

**Screenshot fails:**
If `websiteScraperAITool` fails or returns an empty image, show the card without a screenshot.
The plain-English description is the primary content. The screenshot is visual confirmation
only and its absence does not block the flow.

**Site not published:**
Disable the Pulse button if the site has no published URL. Show a tooltip: "Publish your site
first to run a Pulse check."

**Agent fix fails:**
Surface the error in the chat panel with a fallback message: "I couldn't apply this fix
automatically. Here's what I was trying to do: [suggestedFix]. You can ask me to make this
change manually."

---

### Key TypeScript types

```typescript
type ProblemType = 'cta_buried' | 'contact_hidden' | 'no_social_proof'

type PulseInsight = {
  problemType: ProblemType
  headline: string         // e.g. "31 people visited, only 1 contacted you"
  description: string      // plain English problem description
  suggestedFix: string     // plain English fix description
  confidence: number       // 0–1, must be >= 0.5 to show card
  screenshotBase64: string // base64 PNG of published site
  filesRead: string[]      // files Claude read during analysis
}

type PulseContextAttachment = {
  type: 'pulse_insight'
  insight: PulseInsight
}

type PulseAnalyzeRequest = {
  appId: string
  publishedUrl: string
}

type PulseAnalyzeResponse =
  | { status: 'insight'; insight: PulseInsight }
  | { status: 'healthy'; message: string }
  | { status: 'error'; message: string }
```

---

### Fix strategies per problem type

Options are pre-defined — not AI-generated from scratch. This makes variant generation
reliable and fast.

```typescript
const FIX_STRATEGIES: Record<ProblemType, {
  optionA: { label: string; prompt: string }
  optionB: { label: string; prompt: string }
}> = {
  cta_buried: {
    optionA: {
      label: 'CTA in hero',
      prompt: 'Move the primary CTA button into the hero section above the fold',
    },
    optionB: {
      label: 'Sticky button',
      prompt: 'Add a sticky floating CTA button fixed to the bottom of the screen',
    },
  },
  contact_hidden: {
    optionA: {
      label: 'Simplify form',
      prompt: 'Reduce the contact form to 2 fields: name and message',
    },
    optionB: {
      label: 'Move form higher',
      prompt: 'Move the contact form to the top of the contact page',
    },
  },
  no_social_proof: {
    optionA: {
      label: 'Testimonials section',
      prompt: 'Add a testimonials section with 3 placeholder reviews',
    },
    optionB: {
      label: 'Star rating badge',
      prompt: 'Add a star rating badge near the primary CTA button',
    },
  },
}
```

---

## New Files to Create

```
app/
  src/
    app/
      api/
        pulse/
          analyze/
            route.ts          ← POST endpoint: codebase read + mock analytics + Claude analysis
    components/
      pulse/
        PulseInsightCard.tsx  ← insight card UI component
        PulseInsightCard.test.tsx
    hooks/
      usePulseAnalysis.ts     ← React hook: calls analyze endpoint, manages loading/error state
    lib/
      pulse/
        mock-analytics.ts     ← synthetic analytics data seeded from appId
        fix-strategies.ts     ← pre-defined fix option pairs per problem type
        types.ts              ← PulseInsight, PulseContextAttachment, PulseAnalyzeResponse

agents/
  src/
    skills/
      pulse/
        skill.md              ← pulse skill: handles pulse_insight context attachment
```

---

## UI Design

### Toolbar button

```
┌─────────────────────────────────────────────────┐
│  [Chat]  [Preview]  [Inbox]  [Media]  [⚡ Pulse] │
└─────────────────────────────────────────────────┘
```

Button is disabled with tooltip if site is not published.
Button shows a spinner while analysis is running.

### Phase 1 — Single fix insight card

```
┌─────────────────────────────────────────┐
│  ⚡ Airo Pulse                           │
│                                         │
│  31 people visited this week            │
│  Only 1 contacted you                   │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │   [screenshot of current site]  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Your contact button is buried 4        │
│  scrolls down. Most visitors never      │
│  see it.                                │
│                                         │
│  I can move it to the top of your       │
│  homepage.                              │
│                                         │
│  [ Fix it ]        [ Not now ]          │
└─────────────────────────────────────────┘
```

### After tapping Fix it

```
┌─────────────────────────────────────────┐
│  ✓ Pulse insight received               │
│                                         │
│  Moving your contact button to the      │
│  hero section...                        │
│                                         │
│  [agent builds in real time]            │
│                                         │
│  Done. Your preview is updated.         │
│  Ready to publish?                      │
│                                         │
│  [ Publish now ]   [ Keep editing ]     │
└─────────────────────────────────────────┘
```

### Healthy state (no problem found)

```
┌─────────────────────────────────────────┐
│  ⚡ Airo Pulse                           │
│                                         │
│  Your site looks good this week ✓       │
│                                         │
│  No major issues found. Keep            │
│  publishing content to grow             │
│  your traffic.                          │
└─────────────────────────────────────────┘
```

---

## UI Design Principles

- Plain language only — "31 visited, 1 contacted you" not "67% bounce rate"
- Screenshot of their actual site — not a generic illustration
- One problem, one fix, two buttons — never more than that
- Fits the existing Airo Builder design system using UXCore components
- Matches the visual style of the existing InsightsBanner component

---

## Team Tasks

### Person 1 — Analysis Endpoint and Problem Detection

**Goal:** Build the backend API route that reads the site codebase, loads mock analytics,
calls Claude, and returns a structured PulseInsight.

**Tasks:**

- [ ] Define all shared types in `app/src/lib/pulse/types.ts`
      Share on day 1 — everyone else mocks against this

- [ ] Write mock analytics generator in `app/src/lib/pulse/mock-analytics.ts`
      Seed numbers from appId so they vary per app but always tell the same story

- [ ] Create `app/src/app/api/pulse/analyze/route.ts`
      - Accepts POST `{ appId, publishedUrl }`
      - Validates both fields are present
      - Calls `websiteScraperAITool` with publishedUrl for screenshot
      - Reads key frontend files: index.tsx, Hero.tsx, Contact.tsx, RootLayout.tsx
      - Loads mock analytics
      - Sends codebase content + mock analytics to Claude with classification prompt
      - Validates response with Zod enum
      - Returns `PulseAnalyzeResponse`

- [ ] Write the Claude classification prompt
      - Give Claude the three problem type definitions
      - Tell Claude to return strict JSON matching PulseInsight shape
      - Test against 3 different demo app codebases to verify consistent output

- [ ] Add confidence threshold logic
      - If confidence < 0.5 return `{ status: 'healthy' }`
      - If problemType invalid fall back to `cta_buried`

- [ ] Write unit tests for the Claude response parser

**Day 1 deliverable — share this with the whole team:**
```typescript
// app/src/lib/pulse/types.ts
export type ProblemType = 'cta_buried' | 'contact_hidden' | 'no_social_proof'

export type PulseInsight = {
  problemType: ProblemType
  headline: string
  description: string
  suggestedFix: string
  confidence: number
  screenshotBase64: string
  filesRead: string[]
}

export type PulseAnalyzeResponse =
  | { status: 'insight'; insight: PulseInsight }
  | { status: 'healthy'; message: string }
  | { status: 'error'; message: string }
```

---

### Person 2 — Fix Strategies, Pulse Skill, and Variant Screenshots

**Goal:** Define how the agent fixes each problem type. Wire the pulse skill into the develop
agent. Build the screenshot pipeline for Phase 2 variants.

**Tasks:**

- [ ] Create `app/src/lib/pulse/fix-strategies.ts`
      Pre-defined option pairs for each problem type (see Fix Strategies section above)

- [ ] Create `agents/src/skills/pulse/skill.md`
      - Describe when the skill activates: when `pulse_insight` context attachment is present
      - Tell the agent to read `problemType` and `suggestedFix` from the attachment
      - Tell the agent the files most likely to need editing per problem type
      - Constrain the agent to make only one targeted change — not a full rebuild

- [ ] Add `pulse_insight` context attachment handling to develop agent prompt
      - Agent reads the attachment and goes directly to editing
      - Skips broad codebase exploration since files were already read in analysis

- [ ] Verify agent makes a clean targeted fix for each problem type
      - Test with `cta_buried` — confirm CTA moves to hero
      - Test with `contact_hidden` — confirm form simplifies or moves
      - Test with `no_social_proof` — confirm testimonials section added

- [ ] Phase 2 — variant screenshot pipeline (only after core flow works)
      - After generating variant A code call `screenshotAITool` to capture it
      - Restore original, generate variant B, capture screenshot
      - Return both as base64 strings alongside the insight

---

### Person 3 — Pulse Insight Card UI Component

**Goal:** Build the visual card that shows the insight. Build the toolbar button. This person
is the most independent — use placeholder data from day 1, no upstream dependencies needed.

**Tasks:**

- [ ] Create `app/src/components/pulse/PulseInsightCard.tsx`
      Props: `insight: PulseInsight`, `onFixIt: () => void`, `onDismiss: () => void`
      - Headline stat: plain English visitor summary
      - Screenshot of current site (show placeholder image if screenshotBase64 is empty)
      - Problem description: one sentence
      - Suggested fix: one sentence
      - Two buttons: Fix it (primary) and Not now (tertiary)
      - Use UXCore components: `@ux/card`, `@ux/button`, `@ux/text`, `@ux/box`
      - Match visual style of existing InsightsBanner component

- [ ] Add loading state
      - "Analyzing your site..." spinner while API call is in progress

- [ ] Add healthy state
      - "Your site looks good this week ✓" card when no problem found

- [ ] Add error state
      - "Something went wrong. Try again." with retry button

- [ ] Add `⚡ Pulse` button to the builder toolbar
      - Find the existing toolbar in `app/src/app/[market]/develop/`
      - Disabled with tooltip if site is not published
      - Spinner while analysis is running

- [ ] Wire the card into the chat panel
      - Card renders at top of chat panel when insight is ready
      - Dismisses when owner taps Not now
      - Transitions to fix flow when owner taps Fix it

- [ ] Write component tests for PulseInsightCard
      - Renders correctly with mock insight data
      - Fix it button calls onFixIt
      - Not now button calls onDismiss
      - Screenshot placeholder renders when base64 is empty

**Placeholder data for day 1 (no dependencies):**
```typescript
const mockInsight: PulseInsight = {
  problemType: 'cta_buried',
  headline: '31 people visited this week, only 1 contacted you',
  description: 'Your contact button is buried 4 scrolls down. Most visitors never see it.',
  suggestedFix: 'Move your contact button to the top of your homepage.',
  confidence: 0.89,
  screenshotBase64: '',
  filesRead: ['src/pages/index.tsx', 'src/components/Hero.tsx'],
}
```

- [ ] Phase 2 — upgrade card to side-by-side variant picker (only after core flow works)
      - Show two screenshots side by side
      - Pick A / Pick B / Not now buttons
      - Pass chosen option back to onFixIt handler

---

### Person 4 — Context Attachment Wiring and Apply/Publish Flow

**Goal:** Connect the Fix it button to the agent. Build the React hook. Wire the publish
flow. Own end-to-end integration.

**Tasks:**

- [ ] Add `pulse_insight` to the context attachment type union in `@airo/shared`
      Find `packages/shared/src/context-attachment.ts`
      Add `PulseContextAttachment` type

- [ ] Build `app/src/hooks/usePulseAnalysis.ts`
      - Calls `POST /api/pulse/analyze` with appId and publishedUrl
      - Returns `{ response, isLoading, error, analyze }`
      - Person 3 uses this hook in the toolbar button and insight card

- [ ] Build the `onFixIt` handler
      - Creates `PulseContextAttachment` from the current insight
      - Sends a chat message with the attachment pre-loaded
      - The develop agent picks it up via the pulse skill

- [ ] Connect the post-fix publish prompt
      - After agent completes the fix surface "Ready to publish?" message
      - Wire Publish now button to the existing publish flow

- [ ] Handle the disabled state
      - If publishedUrl is null or empty, return a flag from the hook
      - Person 3 uses this flag to disable the toolbar button

- [ ] End-to-end integration (days 8–10)
      - Swap Person 3's mock insight for Person 1's real API response
      - Swap hardcoded fix for Person 2's real agent skill
      - Verify the full loop: Pulse → insight card → Fix it → preview → Publish

- [ ] Write integration test
      - Mock the analyze endpoint response
      - Verify context attachment reaches the agent
      - Verify agent makes a code change
      - Verify publish flow completes

---

## Build Order

```
Day 1
  All four agree on types in app/src/lib/pulse/types.ts
  Everyone builds against mocks — no blocking

Days 1–7  (parallel)
  Person 1: analysis endpoint + Claude prompt
  Person 2: fix strategies + pulse skill (mock PulseInsight input)
  Person 3: PulseInsightCard + toolbar button (mock data)
  Person 4: usePulseAnalysis hook + context attachment wiring

Days 8–10  (integration)
  Person 4 owns integration
  Swap Person 1 mock → real endpoint
  Swap Person 2 mock → real skill
  Swap Person 3 mock → real hook
  Full end-to-end loop tested and working

Days 11–12
  Bug fixes from integration
  Demo app prepared — 3 apps each showing a different problem type
  If loop is solid → Person 2 + 3 add side-by-side variant picker

Days 13–14
  Demo polish
  Pre-record video as backup per hackathon rules
  Practice the 4-minute presentation
```

---

## Demo Script (4 minutes)

| Time | What happens |
|---|---|
| 0:00–0:30 | Show a published Airo site — a simple small business, looks decent |
| 0:30–1:00 | Tap ⚡ Pulse in the toolbar — "Analyzing your site..." |
| 1:00–2:00 | Insight card appears: "31 people visited, only 1 contacted you. Your contact button is buried. Want me to fix it?" |
| 2:00–2:30 | Tap Fix it — chat shows the agent making the change |
| 2:30–3:00 | Preview pane updates — show before vs after |
| 3:00–3:30 | Tap Publish now — site goes live |
| 3:30–4:00 | "This is what every small business owner deserves — a website that improves itself" |

---

## Potential Idea — Side-by-Side Visual Variant Picker

After the core flow is complete and stable, the insight card upgrades to a full visual
comparison experience. Instead of one fix, the AI generates two different code approaches and
screenshots both. The owner picks the one they like visually — no code, no explanation, just
a choice.

```
┌─────────────────────────────────────────┐
│  ⚡ Airo Pulse                           │
│                                         │
│  31 people visited, 1 contacted you     │
│  Your CTA is buried. Pick a fix:        │
│                                         │
│  ┌─────────────┐    ┌─────────────┐     │
│  │             │    │             │     │
│  │  [Option A] │    │  [Option B] │     │
│  │             │    │             │     │
│  └─────────────┘    └─────────────┘     │
│  CTA in hero        Sticky button       │
│                                         │
│  [ Pick A ]  [ Pick B ]  [ Not now ]    │
└─────────────────────────────────────────┘
```

Fix options are pre-defined per problem type — not AI-generated from scratch — making
generation reliable and fast. The core card component is built from day one to support this
upgrade so adding the side-by-side is a layout change, not a rebuild.

**Build order:** Core flow first. Side-by-side only after end-to-end loop is working.
Person 2 generates both variant code changes and screenshots. Person 3 upgrades the card
layout to show them side by side.

---

## Hackathon Category

**AI-Forward — Best Use of AI**

The pitch to judges:

> "Your website now has an AI co-pilot that watches it, finds what's hurting your business,
> and fixes it with one tap — without you ever touching code."

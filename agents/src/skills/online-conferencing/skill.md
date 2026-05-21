---
name: online-conferencing
description: Add automatic video meeting link generation (Google Meet, Zoom, or Microsoft Teams — any one, any combination, or all three) to any scheduled feature in a customer's app such as appointments, bookings, consultations, events, interviews, coaching sessions, tutoring, telehealth, or any flow where an end user schedules a time to meet online. Generates meeting links for one-on-one or small group sessions. Handles provider OAuth setup with step-by-step credential walkthroughs, integration code generation, database schema for meeting metadata, and composition with the email skill for confirmation links.
whenToUse: 'Load when user wants VIDEO CONFERENCING PROVIDER integration (Google Meet/Zoom/Teams) or AUTO-GENERATE MEETING LINKS. Keywords: "Google Meet", "Zoom", "Teams", "Microsoft Teams", "video conferencing", "meeting link", "Zoom link", "Meet link", "Teams link", "generate meeting link", "automatically create meeting", "video integration", "conferencing provider", "telehealth", "telemedicine", "video [consultations|appointments|calls|sessions|meetings]", "online meeting", "virtual meeting", "conference call", "remote video", "send meeting link". This skill adds VIDEO MEETING LINK GENERATION to existing features. Use online-appointments for booking/scheduling. DO NOT load for: scheduling without video, booking calendars, time slots, date pickers, webinars, live streaming.'
enablementId: onlineConferencing
dependencies: []
# Provider-specific packages are installed per-provider in Step 3:
# - googleapis@latest (Google Meet)
# - @microsoft/microsoft-graph-client@latest (Teams)
# Other dependencies (axios, etc.) are already in the v8 app template.
---

# Online Conferencing Skill

Generate a video meeting link whenever something scheduled happens in the customer's app — a new appointment, a consultation booking, an event registration — and persist the link alongside the record so it can be emailed, rendered on pages, or used to cancel the meeting later.

**This skill is guidance-first.** Nothing is installed as a template — the types, enums, error class, credential helpers, and provider integrations are all generated from this document into the customer's app. Step 1 describes the shared types and config to generate first; Step 3 covers each provider's integration. Generating from live docs each time means a Google/Zoom/Teams API change never breaks the skill.

**All three providers are first-class.** A customer can enable any single provider, any combination, or all three. The skill supports four multi-provider wiring patterns (single default, per-feature hardcoding, end-user-picks on the booking form, and fallback chain). You always present the full menu to the customer — even when they named one provider explicitly — and you always ask about extending to the others **before** any setup begins.

---

## How to Load Detailed Sections

Detailed implementation content lives in `templates/sections/`. Each `## §` section is a separate file named `NN-name.md`. Load only the section you need.

```text
Read agents/src/skills/online-conferencing/templates/sections/02-zoom.md
```

When this skill.md says **"→ Read `templates/sections/NN-name.md`"**, read that file directly.
`templates/IMPLEMENTATION.md` is now a thin index pointing to each section file.

| Section | When to load |
|---|---|
| `01-google-meet.md` | Customer chose Google Meet |
| `02-zoom.md` | Customer chose Zoom |
| `03-teams.md` | Customer chose Microsoft Teams |
| `04-dispatcher-examples.md` | Generating `create-meeting.ts` |
| `05-multi-provider-patterns.md` | Customer chose multiple providers OR needs re-entry flow |
| `06-feature-integration.md` | Wiring into an appointment, event, or consultation feature |
| `07-error-handling-testing.md` | Implementing error handling, testing, or troubleshooting |

---

## When to Use This Skill

Load when the user wants any of:

- Appointment bookings that automatically include a meeting link (any provider)
- Event registrations with a shared virtual attendance link
- Paid or free consultations that need a video call
- A scheduling feature that should let end users pick their preferred meeting platform
- A one-off meeting link the user wants emailed or pasted somewhere
- Any feature that needs "when X is booked / created, make a meeting link"

Do NOT load for:

- Video tutorials or embedded YouTube (static video content)
- Customer wants a meeting link *manually pasted* rather than generated from an API
- Screen recording or webinar-streaming features (out of scope — this skill creates meetings, it doesn't host them)

---

## How This Skill Composes With Others

This skill is a capability enabler, not a full feature. It creates meeting links and defines where to store them — nothing else.

| If the user is building...    | Load                                             | This skill provides                                                          |
| ----------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Appointment booking           | `online-appointments` + `online-conferencing`    | `createMeeting()` call + DB columns to store the link                        |
| Event registration            | whatever handles events + `online-conferencing`  | `createMeeting()` call + DB columns on the event                             |
| Consultations (paid)          | `stripe` + booking skill + `online-conferencing` | `createMeeting()` call (only after payment confirms)                         |
| Emailing the link             | `email`                                          | Nothing — email skill handles SMTP; this skill just produces the `joinUrl`   |

**Never implement email sending inside this skill.** Load the `email` skill and follow its patterns. This skill's job ends at returning `{ joinUrl, id, ... }`.

---

## 🚨 CRITICAL: Implementation Style

**Present options → Collect credentials → Implement.** Ask the customer which provider(s) they want, collect credentials, then generate code.

- **Do NOT discuss technical details** with the user (API endpoints, file edits, schemas, dispatcher patterns, discriminated unions, etc.)
- **Assume users are NOT technical** — they don't need to know about OAuth flows, token caching, or error mapping strategies.
- **Only explain what they need to set up** (where to create OAuth apps, which credentials to copy).

**What to show users:**
- ✅ Provider options menu (Google Meet / Zoom / Teams)
- ✅ Credential collection steps (where to find Client ID, Secret, etc.)
- ✅ Progress updates: "Setting up Zoom integration...", "Generating meeting dispatcher..."
- ✅ Final result: "Zoom integration ready — meetings will auto-generate when customers book"

**What NOT to show users:**
- ❌ Technical implementation: "I'll create src/lib/zoom-integration.ts with cached tokens..."
- ❌ Code explanations: "The dispatcher uses discriminated unions on provider..."
- ❌ File-by-file narration: "Now editing the createMeeting dispatcher..."
- ❌ Section file reads: Don't surface tool calls for reading templates/sections/*.md files

**Section files:** When you need provider-specific implementation details, read the relevant section file silently (don't show the tool call to the user). For example, before setting up Zoom, read `agents/src/skills/online-conferencing/templates/sections/02-zoom.md` to get the full setup walkthrough.

---

## Database Setup (Do This First)

**CRITICAL: Install database skill and add meeting columns to your booking table(s) before implementing providers.**

Required columns (all nullable to support graceful degradation):
- `meetingLink` (varchar(500)) - The join URL sent to attendees
- `meetingId` (varchar(255)) - Provider's meeting ID for deletion/updates
- `meetingProvider` (varchar(20)) - One of: 'google', 'zoom', 'teams'
- `calendarEventId` (varchar(255)) - Google/Teams calendar event ID (null for Zoom)
- `meetingCreatedAt` (timestamp) - When the link was generated

Use database skill's column addition pattern: inspect tables with `database__listTables()`, add columns to schema, run migrations, verify before proceeding.

---

## Step 1: Generate Foundational Files

After database setup is complete, generate two shared files in the customer's app. All integrations and the dispatcher import from these — generate them first.

### `src/lib/conferencing-types.ts`

A types-only file. Generate it with:

- **`ConferencingProviderName`** — string literal union of the three providers. Values are persisted in the database as-is, so use lowercase: `'google'`, `'zoom'`, `'teams'`.

- **`MeetingFields`** — an interface of five nullable columns to add to any booking table (`meetingLink`, `meetingId`, `meetingProvider`, `calendarEventId`, `meetingCreatedAt`). All nullable to represent both "not yet generated" and "graceful degradation" states. `calendarEventId` is only populated for Google and Teams — Zoom meetings are not calendar-backed so it stays null.

- **`CreateMeetingParams`** — common inputs across all providers: `provider`, `title`, `startTime` (ISO 8601), `durationMinutes`, optional `attendees`, optional `description`, optional `timezone`.

- **`MeetingResponse`** — a **discriminated union on `provider`**, not a flat interface with optional fields. Google and Teams must always return `calendarEventId` as required (used for deletion). Zoom must return `hostUrl` (the host-admin URL — never send to attendees, never persist on attendee-visible records). Discriminating on `provider` makes provider-specific field access a compile-time concern.

- **`DeleteMeetingParams`** — also a **discriminated union on `provider`**. Google and Teams require `calendarEventId`. Zoom must not accept it at the type level.

### `src/lib/conferencing-config.ts`

Error handling and credential utilities. Generate it with:

- **`ConferencingErrorCode`** — an enum. These exact values are used in catch blocks (`err.code === 'INVALID_CREDENTIALS'`) — use them verbatim: `INVALID_CREDENTIALS`, `RATE_LIMIT_EXCEEDED`, `API_ERROR`, `MEETING_NOT_FOUND`, `INSUFFICIENT_PERMISSIONS`, `INVALID_PARAMETERS`.

- **`ConferencingError extends Error`** — typed error with `code`, optional `provider`, optional `originalError`. Every provider integration must throw only this — never raw SDK errors.

- **Credential interfaces** — one per provider with optional string fields per credential value.

- **`getCredentials(provider)`** — reads credentials from `process.env`. Env var names must match the `requestSecrets` calls in Step 3 exactly: Google reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`; Zoom reads `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`; Teams reads `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_USER_ID`.

- **`validateCredentials(provider)`** — returns true if every credential field for that provider is a non-empty string.

---

## Step 2: Provider Selection Workflow

Drive this **before any credential collection or code generation**.

### 2a. Present all three providers + invite the customer to pick

Even when the customer named a provider, acknowledge their pick and present the full menu. Customers often don't realize multiple providers can coexist.

**Agent script (adapt to context):**

> Got it — let's wire up video conferencing. Quick heads-up on what's available:
>
> **Google Meet** — Simplest setup. OAuth + Google Calendar API. Best fit for Google Workspace users.
>
> **Zoom** — Server-to-Server OAuth (no per-user login). Richer features (breakout rooms, webinars). Best fit for large meetings.
>
> **Microsoft Teams** — Azure AD + client credentials. Best fit for Microsoft 365 organizations.
>
> You can pick any one, any combination, or all three. You mentioned `<provider>` — want to go with just that, or add the others too so you have the option later?

**Wait for the customer's answer** before proceeding.

### 2b. If multiple providers chosen, ask the wiring pattern

Only if 2+ providers. Briefly describe the four options and ask which fits:

- **Pattern 1 — Single default + override.** One provider is the default; any feature can override.
- **Pattern 2 — Per-feature hardcoding.** Different features use different providers in code.
- **Pattern 3 — End users pick on the booking form.** Dropdown at booking time.
- **Pattern 4 — Fallback chain.** Try one, fall back to another on failure.

→ Read `agents/src/skills/online-conferencing/templates/sections/05-multi-provider-patterns.md` for detailed code examples for each pattern.

### 2c. Confirm the plan

> Plan: Providers: `<list>`. Pattern: `<pattern>`. Feature(s): `<list>`. Ready to proceed?

Once confirmed, collect all credentials **before** any code generation.

---

## Step 3: Per-Provider Setup & Implementation

Walk only the sections for providers the customer picked. Complete each provider's credentials before moving to the next.

### 3a. Google Meet
→ Read `agents/src/skills/online-conferencing/templates/sections/01-google-meet.md`

### 3b. Zoom
→ Read `agents/src/skills/online-conferencing/templates/sections/02-zoom.md`

### 3c. Microsoft Teams
→ Read `agents/src/skills/online-conferencing/templates/sections/03-teams.md`

---

## Step 4: Create the Dispatcher (`create-meeting.ts`)

After generating integration files, write a single dispatcher that routes `createMeeting()` calls to the right provider.

**Rule:** The dispatcher contains cases **only for providers the customer configured**. Unconfigured providers are not imported and not referenced.

→ Read `agents/src/skills/online-conferencing/templates/sections/04-dispatcher-examples.md` for code examples (single provider, all three, optional DEFAULT wrapper).

---

## Step 5: Persist Meeting Metadata

Add these five columns to whatever table owns the booking. Don't create a new table.

```typescript
// src/server/db/schema.ts — ADD to the existing table
meetingLink: varchar('meeting_link', { length: 500 }),
meetingId: varchar('meeting_id', { length: 255 }),
meetingProvider: varchar('meeting_provider', { length: 50 }),
calendarEventId: varchar('calendar_event_id', { length: 255 }),
meetingCreatedAt: timestamp('meeting_created_at'),
```

Run migrations: `npm run db:generate && npm run db:migrate`.

- `meetingProvider` — tells `deleteMeeting()` which integration to call. Store it even in single-provider apps.
- `calendarEventId` — Google/Teams require this for deletion. Null for Zoom.
- ⚠️ **Do NOT persist `hostUrl` on attendee-visible records** — it's Zoom's host-admin URL and grants host privileges.

---

## Wiring Into a Feature

→ Read `agents/src/skills/online-conferencing/templates/sections/06-feature-integration.md` for the four integration patterns (standalone link, booking with auto-link, event shared link, paid consultation) and email delegation guidance.

---

## Error Handling, Testing & Common Mistakes

→ Read `agents/src/skills/online-conferencing/templates/sections/07-error-handling-testing.md` for error handling principles, three-phase testing workflow, common mistakes, and the after-setup summary template.

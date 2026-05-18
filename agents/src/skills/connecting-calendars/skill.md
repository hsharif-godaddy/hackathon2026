---
name: connecting-calendars
description: "Connects Google Calendar, Outlook/Microsoft 365, or Apple iCloud to a deployed web app using the user's own credentials (BYOC). Handles one-way sync (app creates calendar events) and two-way sync (calendar updates, cancellations, reschedules, and conflicts sync back to app)."
whenToUse: "User wants to CONNECT, INTEGRATE, or SYNC with external calendar services (Google Calendar, Outlook, Microsoft 365, Office 365, iCloud, Apple Calendar). Trigger when user mentions: syncing with calendar, connecting calendar, calendar integration, two-way sync, one-way sync, calendar webhooks, calendar oauth, calendar authentication, calendar API integration, push calendar updates, receive calendar changes, sync bookings to calendar, calendar notifications from provider, free/busy from calendar service. REQUIRES integration language (sync, connect, integrate) + external calendar provider. DO NOT trigger on standalone scheduling/booking system requests without calendar integration context."
enablementId: connectingCalendars
dependencies:
  - googleapis
  - "@microsoft/microsoft-graph-client"
  - tsdav
  - ical-generator
---

# Calendar Integration Skill

Connect Google Calendar, Outlook/Microsoft 365, or Apple iCloud to a deployed web app using the user's own credentials (BYOC). Creates calendar events on booking and optionally syncs calendar updates back to the app, including cancellations, reschedules, and conflicts.

**Supported providers:**

- **Google Calendar** — OAuth credentials, most common
- **Outlook / Microsoft 365** — Azure app registration
- **Apple iCloud** — App-specific password (CalDAV)

**Sync modes:**

- **One-way**: App → Calendar. Bookings create events. Nothing flows back.
- **Two-way**: Calendar → App too. Calendar updates (cancellations, reschedules, conflicts) automatically sync back and update bookings in the app. **Google and Outlook only.** Apple CalDAV has no push notification support.

---

## Quick Reference

| Provider                | One-Way | Two-Way | Package                             |
| ----------------------- | ------- | ------- | ----------------------------------- |
| Google Calendar         | ✅      | ✅      | `googleapis`                        |
| Outlook / Microsoft 365 | ✅      | ✅      | `@microsoft/microsoft-graph-client` |
| Apple iCloud            | ✅      | ❌      | `tsdav`, `ical-generator`           |

| Endpoint                     | Method | Purpose                                                     |
| ---------------------------- | ------ | ----------------------------------------------------------- |
| `/api/calendar/connect`      | POST   | Initiate OAuth flow                                         |
| `/api/calendar/callback`     | GET    | OAuth callback — store tokens + register watch/subscription |
| `/api/calendar/status`       | GET    | Connection state + watch channel health                     |
| `/api/calendar/events`       | POST   | Create calendar event (all providers)                       |
| `/api/calendar/webhooks`     | POST   | Receive Google + Microsoft push notifications               |
| `/api/calendar/disconnect`   | POST   | Revoke tokens, deactivate channels, clear DB                |
| `/api/bookings/availability` | GET    | Slot availability — DB bookings + calendar free/busy        |

| Secret                      | Must end with            |
| --------------------------- | ------------------------ |
| `CALENDAR_WEBHOOK_URL`      | `/api/calendar/webhooks` |
| `GOOGLE_OAUTH_REDIRECT_URI` | `/api/calendar/callback` |
| `AZURE_OAUTH_REDIRECT_URI`  | `/api/calendar/callback` |

> **IMPORTANT:** `CALENDAR_WEBHOOK_URL` must be the HTTPS URL of your published app (e.g., `https://your-app.com/api/calendar/webhooks`). The app must have been published at least once, or you must provide the published URL explicitly. Use `${PUBLISHED_URL}/api/calendar/webhooks` if available.
>
> Never set any of the above to `/settings/calendar` or any other UI page path.
>
> **Watch channel and subscription URLs are permanent at registration time.** Changing `CALENDAR_WEBHOOK_URL` does NOT update live channels — they keep firing to the old URL until they expire (Google: up to 7 days; Microsoft: up to 3 days). The renewal job detects URL mismatches and re-registers automatically on next startup or 12-hour cycle.

---

## Pre-Dependency: Understand the Business Context First

> **Note:** Calendar integration is always a hook onto an existing business flow — it is never standalone. Before writing a single line of calendar code, I must fully understand what the calendar is being attached to.

### Check for Existing Appointment System

**FIRST: Check if the online-appointments skill is already installed:**

```typescript
// Check if appointments config exists
const appointmentsConfigExists = fileExists('src/lib/appointments.config.ts');
```

**If appointments config exists** (online-appointments skill is installed):
- Skip discovery questions — reuse existing context
- Use known schema: table `appointment` with fields `customerName`, `customerEmail`, `startTime`, `endTime`, `duration`, `notes`
- Creation handler: `src/server/api/appointments/POST.ts`
- Jump directly to Prerequisites section

**If appointments config does NOT exist** (custom booking system):

### Ask the user one question or see if it's available in the context

> "What does someone schedule or book in your app? For example: a consultation, appointment, class, meeting, service, or something else?"

⚠️ **Wait for answer.**

### I must investigate the codebase before proceeding

Once the user names the entity (e.g. "consultation", "appointment", "booking"), I must do all of the following before moving to Prerequisites:

**1. Find the database table for this entity.**
I must search `src/server/db/schema.ts` (or equivalent) for the table definition. I must identify:

- The table name and primary key field
- The fields that represent start time, end time, and duration
- The field that holds the customer/attendee email address (needed to send calendar invites)
- The field that holds a title, description, or service name (used as the calendar event title)
- The field that represents status (e.g. `confirmed`, `cancelled`, `pending`) — required for two-way sync to know what state to write back
- Any location or address field (optional, used in the calendar event)

If these fields do not exist, I must note what is missing — I cannot create a meaningful calendar event without at minimum a start time, end time, and something to use as a title.

**2. Find where this entity is created.**
I must search `src/server/api/` for the route that creates this entity (e.g. `POST /api/bookings`, `POST /api/appointments`). I must read that file and understand:

- What data is available at creation time
- Where in the handler the DB insert happens — this is where I will add the calendar event creation call
- Whether the creation is synchronous or queued

**3. Find where this entity is cancelled or deleted (two-way sync only).**
If two-way sync was selected, I must also find the route or handler that cancels or updates this entity. I must understand:

- What field is set when a booking is cancelled (e.g. `status = 'cancelled'`)
- Whether there is a dedicated cancel endpoint or whether it is a PATCH/DELETE on the same route
- This is the reverse path: when a calendar deletion webhook arrives, I must write back to this flow

**4. Confirm the entity's fields are sufficient.**
I must not proceed with the calendar integration if the entity is missing critical fields. Minimum required:

- A start datetime
- An end datetime (or a duration I can compute end from)
- Something usable as an event title (service name, booking type, or similar)

If any of these are missing, I must tell the user what needs to be added to the existing data model before calendar integration can work — and stop until it is resolved.

**5. Document what I found.**
Before moving to Prerequisites, I must summarise internally:

- Table name and primary key
- Field mapped to: start time, end time, title, attendee email, status, location (if present)
- File path of the creation handler
- File path of the cancellation handler (two-way only)

I must carry this context through every subsequent step. All calendar event creation and webhook handling code must use the actual field names and file paths discovered here — never invented or assumed names.

---

## Prerequisites

I must install and load the database skill before writing any routes, schema, or migration files. This must be done first — no exceptions.

```typescript
skill({ action: 'install', skill: 'database' });
skill({ action: 'load', skill: 'database' });
```

I must call `database__listTables()` and confirm it succeeds before proceeding. If it fails, I must stop and resolve the database skill issue — I must not write any code until this passes.

```typescript
database__listTables();
```

---

## Hard Rules

- `express.json()` goes in `handlerBefore`, **not** `serverBefore` — `req.body` is undefined otherwise
- Calendar modules go in `src/server/calendar/`, **never** `src/lib/`
- OAuth `state` param **must be generated server-side** — never trust a client-provided value
- **Always revoke tokens at the provider** on disconnect — never only mark the DB row inactive

---

## Step 0: Sync Mode Decision

⚠️ **STOP — ask the user this before anything else.**

> "Do you want your calendar to just receive new bookings, or should it also automatically sync changes back to your app?
>
> - **Receive only** (simpler): New bookings appear in your calendar. Changes you make in your calendar don't affect the app.
> - **Two-way** (Google and Outlook only): Calendar updates (cancellations, reschedules, conflicts) automatically sync back and update bookings in your app. If you delete, reschedule, or mark a conflict on an event in your calendar, the booking in your app is automatically updated too.
>
> Which would you prefer?"

⚠️ **Wait for answer before continuing.**

---

## Step 1: Provider Selection

⚠️ **STOP — ask after sync mode is confirmed.**

> "Which calendar service do you use?
>
> 1. **Google Calendar**
> 2. **Outlook / Microsoft 365**
> 3. **Apple iCloud**"

⚠️ **Wait for answer.**

If user picks **Apple** and two-way was selected:

> "Apple Calendar doesn't support automatic two-way updates, so calendar changes (cancellations, reschedules, conflicts) in your Apple Calendar won't automatically sync back to the app. Would you like to use Google Calendar or Outlook instead, or continue with Apple (receive-only)?"

⚠️ **Wait for answer before continuing.**

---

## Step 1.5: Plan Implementation — Identify All Steps and Add to Todo List

Before writing any code, I must identify every step required to complete the integration based on the user's choices (provider + sync mode) and add them all to the todo list.

I must call `todo__createList` to create a todo list, then call `todo__addItem` for each step. I must do this before any installation, schema, or route work.

**Determine the full step list based on selections:**

**If Google Calendar, one-way:**

1. Install `googleapis` (if absent)
2. Add secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`
3. Add `calendar_connections` table to schema + run migration
4. Add `express.json()` to `handlerBefore` (if absent)
5. Create `src/server/calendar/google-calendar.ts` client
6. Create `/api/calendar/connect`, `/api/calendar/callback`, `/api/calendar/status`, `/api/calendar/events`, `/api/calendar/disconnect` routes
7. Wire calendar event creation into the booking creation handler
8. Add `/settings/calendar` UI page
9. Verify checklist

**If Google Calendar, two-way — all of the above plus:**

- Add secrets: `CALENDAR_WEBHOOK_URL`
- Add `oauth_states`, `calendar_watch_channels`, `calendar_synced_events` tables + migration
- Register watch channel at OAuth callback
- Add webhook handler at `/api/calendar/webhooks`
- Add `watch-renewal.ts` auto-renewal job + wire into `serverBefore`
- Store booking ↔ event mapping (`calendar_synced_events`) on every booking creation
- Wire cancellation write-back in webhook handler

**If Outlook / Microsoft 365, one-way:**

1. Install `@microsoft/microsoft-graph-client` (if absent)
2. Add secrets: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_OAUTH_REDIRECT_URI`
3. Add `calendar_connections`, `oauth_states` tables + migration
4. Add `express.json()` to `handlerBefore` (if absent)
5. Create `src/server/calendar/microsoft-calendar.ts` client
6. Create `/api/calendar/connect`, `/api/calendar/callback`, `/api/calendar/status`, `/api/calendar/events`, `/api/calendar/disconnect` routes
7. Wire calendar event creation into the booking creation handler
8. Add `/settings/calendar` UI page
9. Verify checklist

**If Outlook / Microsoft 365, two-way — all of the above plus:**

- Add secret: `CALENDAR_WEBHOOK_URL`
- Add `calendar_ms_subscriptions`, `calendar_synced_events` tables + migration
- Register Graph subscription at OAuth callback (including `validationToken` handshake)
- Add webhook handler at `/api/calendar/webhooks`
- Add `watch-renewal.ts` auto-renewal job + wire into `serverBefore`
- Store booking ↔ event mapping (`calendar_synced_events`) on every booking creation
- Wire cancellation write-back in webhook handler

**If Apple iCloud:**

1. Install `tsdav`, `ical-generator` (if absent)
2. Add secrets: `APPLE_ICLOUD_EMAIL`, `APPLE_APP_SPECIFIC_PASSWORD`
3. Add `calendar_connections` table + migration
4. Add `express.json()` to `handlerBefore` (if absent)
5. Create `src/server/calendar/apple-calendar.ts` client
6. Create `/api/calendar/connect`, `/api/calendar/status`, `/api/calendar/events`, `/api/calendar/disconnect` routes
7. Wire calendar event creation into the booking creation handler
8. Add `/settings/calendar` UI page
9. Verify checklist

⚠️ **I must add every applicable step to the todo list before proceeding. I must not start implementation until the todo list is created.**

---

## Step 2A: Google Calendar Setup

### Get OAuth Credentials

> "To connect Google Calendar, you'll need to create credentials in Google Cloud Console. Here's how:
>
> 1. Go to [console.cloud.google.com](https://console.cloud.google.com)
> 2. Create or select a project
> 3. Enable **Google Calendar API** (APIs & Services → Library)
> 4. Go to **Credentials** → **Create OAuth 2.0 Client ID**
> 5. Application type: **Web Application**
> 6. Authorized redirect URIs: `https://your-domain.com/api/calendar/callback`
> 7. Copy your **Client ID** and **Client Secret**
>
> Full OAuth 2.0 reference: [Google Identity — OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
>
> Have you completed these steps and have your Client ID and Client Secret ready? (yes/no)"

⚠️ **STOP — wait for yes before continuing.**

Required scopes (use full URIs — shorthand like `calendar.events` is invalid):

- One-way: `https://www.googleapis.com/auth/calendar.events`
- Two-way: `https://www.googleapis.com/auth/calendar.events` + `https://www.googleapis.com/auth/calendar.readonly`

### Domain

> "What is your app's public URL? (e.g. `https://mybusiness.com`)"

⚠️ **Wait for answer. I must use this domain in all redirect URIs and webhook URLs — I must never substitute a placeholder like `your-domain.com` in the actual code or secrets.**

**Note:** If the app uses the appointments skill and has `PUBLISHED_URL` available, use that automatically without asking.

### Install

I must read `package.json` and check whether `googleapis` is listed as a dependency before running any install command. I must only run the install if the package is absent.

```bash
npm install googleapis
```

### Secrets

Show the user which secrets to add, substituting their actual domain:

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_OAUTH_REDIRECT_URI=https://<their-domain>/api/calendar/callback
```

> "Please add these three values to your app's secrets/environment variables, then let me know when done."

⚠️ **Wait for confirmation before continuing.**

### Database Schema

I must call `database__listTables()` and inspect the result before touching `src/server/db/schema.ts`. I must only add tables that are not already present — I must never duplicate an existing table definition.

Tables required for one-way: `calendar_connections`.
Tables required for two-way: `calendar_connections`, `oauth_states`.

```typescript
export const calendarConnections = mysqlTable('calendar_connections', {
  id: varchar('id', { length: 36 }).primaryKey(),
  organisationId: varchar('organisation_id', { length: 36 }).notNull(),
  provider: varchar('provider', { length: 20 }).notNull(), // 'google' | 'microsoft' | 'apple'
  strategy: varchar('strategy', { length: 10 }).notNull().default('byoc'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at'),
  calendarId: varchar('calendar_id', { length: 255 }).default('primary'),
  isActive: boolean('is_active').default(true),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

Two-way sync also requires `oauthStates`:

```typescript
export const oauthStates = mysqlTable('oauth_states', {
  state: varchar('state', { length: 36 }).primaryKey(),
  organisationId: varchar('organisation_id', { length: 36 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
});
```

I must run the migration immediately after updating the schema — I must not defer this:

```typescript
skill({ action: 'load', skill: 'database' });
```

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

I must call `database__listTables()` again and confirm the required tables are present before writing any route files. If a table is missing after migration, I must stop and investigate — I must not proceed.

```typescript
database__listTables();
```

### Body Parser

I must read `src/server/configure.js` before making any changes. I must check whether `handler.use(express.json())` already exists inside `handlerBefore`. I must only add it if it is absent — I must not add it twice.

```javascript
// src/server/configure.js
handlerBefore(handler) {
  handler.use(express.json());
},
```

### OAuth State — CSRF Protection

I must generate the OAuth `state` value server-side in `/api/calendar/connect` — I must never accept or trust a state value from the client. I must store the state before redirecting, verify and delete it at the start of the callback handler (single-use), and reject any callback where the state is missing, expired, or does not match.

### Client and Routes

I must not create any route files before the database tables are confirmed present (verified above).

Create `src/server/calendar/google-calendar.ts` with: `getAuthUrl`, `exchangeCodeForTokens`, `refreshToken`, `getFreeBusy`, `createEvent`, `updateEvent`, `deleteEvent`, `setupWatch`, `stopWatch`, `listChangedEvents`.

Create the API routes: `/api/calendar/connect`, `/api/calendar/callback`, `/api/calendar/status`, `/api/calendar/events`, `/api/calendar/disconnect`.

If two-way sync was selected, continue to Step 3. Otherwise continue to Step 7.

---

## Step 2B: Outlook / Microsoft 365 Setup

### Get Azure App Credentials

> "To connect Outlook, you'll need to register an app in Microsoft Azure. Here's how:
>
> 1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → New registration
> 2. Supported account types: **"Accounts in any organizational directory + personal Microsoft accounts"**
> 3. Redirect URI (Web): `https://your-domain.com/api/calendar/callback`
> 4. **API permissions** → Add: `Calendars.ReadWrite`, `offline_access`, `User.Read`
> 5. **Certificates & secrets** → New client secret → copy the **Value** (visible only once)
> 6. From Overview, copy your **Application (client) ID** and **Directory (tenant) ID**
>
> Full auth reference: [Microsoft Graph — Authentication and authorization](https://learn.microsoft.com/en-us/graph/auth/)
>
> Have you completed these steps and have your Client ID, Client Secret, and Tenant ID ready? (yes/no)"

⚠️ **STOP — wait for yes before continuing.**

### Domain

> "What is your app's public URL? (e.g. `https://mybusiness.com`)"

⚠️ **Wait for answer. I must use this domain in all redirect URIs and webhook URLs — I must never substitute a placeholder like `your-domain.com` in the actual code or secrets.**

**Note:** If the app uses the appointments skill and has `PUBLISHED_URL` available, use that automatically without asking.

### Install

I must read `package.json` and check whether `@microsoft/microsoft-graph-client` is listed as a dependency before running any install command. I must only run the install if the package is absent.

```bash
npm install @microsoft/microsoft-graph-client
```

### Secrets

Show the user which secrets to add, substituting their actual domain:

```
AZURE_CLIENT_ID=your-application-client-id
AZURE_CLIENT_SECRET=your-client-secret-value
AZURE_TENANT_ID=your-tenant-id-or-common
AZURE_OAUTH_REDIRECT_URI=https://<their-domain>/api/calendar/callback
```

> "Please add these four values to your app's secrets/environment variables, then let me know when done."

⚠️ **Wait for confirmation before continuing.**

### Database Schema

I must call `database__listTables()` and inspect the result before touching `src/server/db/schema.ts`. I must only add tables that are not already present — I must never duplicate an existing table definition.

Tables required: `calendar_connections`, `oauth_states`.

```typescript
export const calendarConnections = mysqlTable('calendar_connections', {
  id: varchar('id', { length: 36 }).primaryKey(),
  organisationId: varchar('organisation_id', { length: 36 }).notNull(),
  provider: varchar('provider', { length: 20 }).notNull(),
  strategy: varchar('strategy', { length: 10 }).notNull().default('byoc'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at'),
  calendarId: varchar('calendar_id', { length: 255 }),
  isActive: boolean('is_active').default(true),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

Also add `oauthStates` if not present (same schema as Step 2A).

I must run the migration immediately after updating the schema — I must not defer this:

```typescript
skill({ action: 'load', skill: 'database' });
```

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

I must call `database__listTables()` again and confirm the required tables are present before writing any route files. If a table is missing after migration, I must stop and investigate — I must not proceed.

```typescript
database__listTables();
```

### Body Parser

I must read `src/server/configure.js` before making any changes. I must check whether `handler.use(express.json())` already exists inside `handlerBefore`. I must only add it if it is absent — I must not add it twice.

```javascript
handlerBefore(handler) {
  handler.use(express.json());
},
```

### OAuth State — CSRF Protection

Same mandate as Step 2A — I must generate state server-side, store before redirect, verify and delete at callback (single-use), and reject on mismatch.

### Client and Routes

I must not create any route files before the database tables are confirmed present (verified above).

Create `src/server/calendar/microsoft-calendar.ts` with: `getAuthUrl`, `exchangeCodeForTokens`, `refreshToken`, `getFreeBusy`, `createEvent`, `updateEvent`, `deleteEvent`, `setupSubscription`, `renewSubscription`, `deleteSubscription`, `listChangedEvents`, `listCalendars`.

Create the API routes: `/api/calendar/connect`, `/api/calendar/callback`, `/api/calendar/status`, `/api/calendar/events`, `/api/calendar/disconnect`.

If two-way sync was selected, continue to Step 3. Otherwise continue to Step 7.

---

## Step 2C: Apple iCloud Setup

> **Receive-only.** Apple Calendar does not support automatic two-way updates.

### Get App-Specific Password

> "To connect Apple iCloud Calendar, you'll need an app-specific password:
>
> 1. Go to [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security** → **App-Specific Passwords**
> 2. Click **+** → label it "Calendar Integration"
> 3. Copy the 16-character password (`xxxx-xxxx-xxxx-xxxx`)
>
> Have you got your iCloud email address and the app-specific password ready? (yes/no)"

⚠️ **STOP — wait for yes before continuing.**

### Install

I must read `package.json` and check whether `tsdav` and `ical-generator` are listed as dependencies before running any install command. I must only install packages that are absent.

```bash
npm install tsdav ical-generator
```

### Secrets

Show the user which secrets to add:

```
APPLE_ICLOUD_EMAIL=your-icloud-email@icloud.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

> "Please add these two values to your app's secrets/environment variables, then let me know when done."

⚠️ **Wait for confirmation before continuing.**

### Database Schema

I must call `database__listTables()` and inspect the result before touching `src/server/db/schema.ts`. I must only add `calendar_connections` if it is not already present — I must never duplicate an existing table definition.

```typescript
export const calendarConnections = mysqlTable('calendar_connections', {
  id: varchar('id', { length: 36 }).primaryKey(),
  organisationId: varchar('organisation_id', { length: 36 }).notNull(),
  provider: varchar('provider', { length: 20 }).notNull(),
  strategy: varchar('strategy', { length: 10 }).notNull().default('byoc'),
  accessToken: text('access_token'), // stores app-specific password
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at'),
  calendarId: varchar('calendar_id', { length: 255 }),
  accountId: varchar('account_id', { length: 255 }), // stores iCloud email address
  isActive: boolean('is_active').default(true),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

I must run the migration immediately after updating the schema — I must not defer this:

```typescript
skill({ action: 'load', skill: 'database' });
```

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

I must call `database__listTables()` again and confirm `calendar_connections` is present before writing any route files. If the table is missing after migration, I must stop and investigate — I must not proceed.

```typescript
database__listTables();
```

### Body Parser

I must read `src/server/configure.js` before making any changes. I must check whether `handler.use(express.json())` already exists inside `handlerBefore`. I must only add it if it is absent — I must not add it twice.

```javascript
handlerBefore(handler) {
  handler.use(express.json());
},
```

### Client and Routes

I must not create any route files before `calendar_connections` is confirmed present (verified above).

Create `src/server/calendar/apple-calendar.ts` with all Apple iCloud CalDAV client methods.

Create the API routes: `/api/calendar/connect`, `/api/calendar/status`, `/api/calendar/events`, `/api/calendar/disconnect`.

> On disconnect, token revocation is not programmatic for Apple — I must tell the user to delete the app-specific password from [appleid.apple.com](https://appleid.apple.com).

Continue to Step 7.

---

## Step 3: Two-Way Sync Setup (Google or Outlook)

### Webhook URL

> "What is your app's public URL? (e.g. `https://mybusiness.com`) — needed so your calendar provider can send updates back to your app."

⚠️ **Wait for answer. I must use this domain for `CALENDAR_WEBHOOK_URL` — I must never use a placeholder.**

Show the user which secret to add:

```
CALENDAR_WEBHOOK_URL=https://<their-domain>/api/calendar/webhooks
```

> "Please add `CALENDAR_WEBHOOK_URL` to your app's secrets, then let me know when done."

⚠️ **STOP — wait for confirmation before continuing.**

### Additional Database Tables

I must call `database__listTables()` and inspect the result before touching `src/server/db/schema.ts`. I must only add tables that are not already present.

Tables required for Google: `calendar_watch_channels`, `calendar_synced_events`.
Tables required for Microsoft: `calendar_ms_subscriptions`, `calendar_synced_events`.

For Google:

```typescript
export const calendarWatchChannels = mysqlTable('calendar_watch_channels', {
  id: varchar('id', { length: 36 }).primaryKey(),
  organisationId: varchar('organisation_id', { length: 36 }).notNull(),
  connectionId: varchar('connection_id', { length: 36 }).notNull(),
  channelId: varchar('channel_id', { length: 255 }).notNull().unique(),
  resourceId: varchar('resource_id', { length: 255 }).notNull(),
  channelToken: varchar('channel_token', { length: 36 }).notNull(), // verified against x-goog-channel-token on every webhook
  webhookUrl: text('webhook_url'), // baked-in at registration — compared with secret on renewal to detect stale channels
  calendarId: varchar('calendar_id', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  syncToken: text('sync_token'), // incremental sync
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});
```

For Microsoft:

```typescript
export const calendarMsSubscriptions = mysqlTable('calendar_ms_subscriptions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  organisationId: varchar('organisation_id', { length: 36 }).notNull(),
  connectionId: varchar('connection_id', { length: 36 }).notNull(),
  subscriptionId: varchar('subscription_id', { length: 255 }).notNull().unique(),
  clientState: varchar('client_state', { length: 36 }).notNull(), // echoed back on every notification — verified before processing
  resource: varchar('resource', { length: 100 }).notNull().default('me/events'),
  expiresAt: timestamp('expires_at').notNull(),
  deltaToken: text('delta_token'), // incremental sync
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});
```

For both providers:

```typescript
export const calendarSyncedEvents = mysqlTable('calendar_synced_events', {
  id: varchar('id', { length: 36 }).primaryKey(),
  organisationId: varchar('organisation_id', { length: 36 }).notNull(),
  connectionId: varchar('connection_id', { length: 36 }).notNull(),
  localBookingId: varchar('local_booking_id', { length: 36 }).notNull(),
  externalEventId: varchar('external_event_id', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 20 }).notNull().default('google'),
  status: varchar('status', { length: 20 }).notNull().default('active'), // 'active' | 'cancelled' | 'modified'
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

I must run the migration immediately after updating the schema — I must not defer this:

```typescript
skill({ action: 'load', skill: 'database' });
```

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

I must call `database__listTables()` again and confirm all required tables are present before modifying any route files. I must not proceed if any table is missing.

```typescript
database__listTables();
```

### Register Watch Channel / Subscription at OAuth Callback

I must update `src/server/api/calendar/callback/GET.ts` to register the watch/subscription immediately after storing tokens. I must read the existing file before editing to understand its current structure — I must not overwrite logic that is already correct.

**Google:** Deactivate existing channels → call `googleClient.setupWatch(accessToken, 'primary', webhookUrl, channelToken)` → call `listChangedEvents` (no token) to get baseline `syncToken` → store all in `calendar_watch_channels`.

**Microsoft:** Deactivate existing subscriptions → call `msClient.setupSubscription(accessToken, webhookUrl, clientState)` → call `listChangedEvents` (no token) to get baseline `deltaToken` → store all in `calendar_ms_subscriptions`.

> **Handshake behavior:**
>
> - Google sends a `sync` ping (`x-goog-resource-state: sync`) immediately after watch creation — I must acknowledge with 200 and take no further action.
> - Microsoft sends `POST /api/calendar/webhooks?validationToken=...` during subscription setup — I must reflect the token immediately as plain text (not JSON, status 200). I must validate the format before reflecting: `/^[\w\-]{1,200}$/`.

I must verify the watch/subscription was actually stored in the database after setup:

```sql
-- Google:
SELECT channel_id, expires_at, is_active FROM calendar_watch_channels LIMIT 5;
-- Microsoft:
SELECT subscription_id, expires_at, is_active FROM calendar_ms_subscriptions LIMIT 5;
```

I must not declare two-way sync complete if this query returns no rows.

### Confirm syncToken / deltaToken Stored

I must confirm the baseline token is stored before finishing the callback implementation. I must not leave this null — without it, every webhook triggers a full event list instead of an incremental diff.

```sql
SELECT sync_token FROM calendar_watch_channels WHERE is_active = 1;
SELECT delta_token FROM calendar_ms_subscriptions WHERE is_active = 1;
```

If either token is null, I must trace back through the `listChangedEvents` call and fix it before continuing.

### Auto-Renewal Job

This must always be implemented for two-way sync — I must never skip it. Without the renewal job, two-way sync silently stops after a few days.

Create `src/server/calendar/watch-renewal.ts` with `renewExpiringGoogleWatchChannels` and/or `renewExpiringMicrosoftSubscriptions`.

I must read `src/server/configure.js` before modifying it. I must wire up the renewal job inside the `serverBefore` hook using a dynamic import — string concatenation prevents Vite SSR from bundling the module at build time:

```javascript
// src/server/configure.js — inside the serverBefore hook
const renewalPath = ['..', 'server', 'calendar', 'watch-renewal'].join('/');
import(/* @vite-ignore */ renewalPath)
  .then(({ renewExpiringGoogleWatchChannels, renewExpiringMicrosoftSubscriptions }) => {
    renewExpiringGoogleWatchChannels?.().catch(console.error);
    renewExpiringMicrosoftSubscriptions?.().catch(console.error);
    setInterval(
      () => {
        renewExpiringGoogleWatchChannels?.().catch(console.error);
        renewExpiringMicrosoftSubscriptions?.().catch(console.error);
      },
      12 * 60 * 60 * 1000
    ); // every 12h
  })
  .catch(console.error);
```

| Provider  | Channel lifetime   | Renew within  | Detects URL mismatch?                                                       |
| --------- | ------------------ | ------------- | --------------------------------------------------------------------------- |
| Google    | 7 days             | 24h of expiry | Yes — stops stale channel, re-registers with current `CALENDAR_WEBHOOK_URL` |
| Microsoft | ~3 days (4230 min) | 48h of expiry | No — PATCH-renews in place                                                  |

### Store Booking ↔ Event Mapping

I must use the creation handler file path identified in the Pre-Dependency step — I must not search for it again or assume a different location. I must read the file before editing it.

Every time a booking creates a calendar event, I must write a row to `calendar_synced_events`. This mapping must never be omitted — without it, the webhook handler cannot identify which booking to cancel when a deletion notification arrives.

```typescript
if (event?.id) {
  await db.insert(calendarSyncedEvents).values({
    id: crypto.randomUUID(),
    organisationId,
    connectionId: connection.id,
    localBookingId: String(bookingId),
    externalEventId: event.id,
    provider: connection.provider,
    status: 'active',
  });
}
```

---

## Step 7: Integration with Appointment System

**If online-appointments skill is installed:**

Edit `src/server/api/appointments/POST.ts` to create calendar events after booking creation:

```typescript
import { createCalendarEvent } from '@/server/calendar/calendar-integration';
import { config as appointmentConfig } from '@/lib/appointments.config';

export async function POST(req: Request, res: Response) {
  try {
    // ... existing appointment creation logic ...
    
    const newAppointment = await db.insert(appointment).values({
      // ... appointment data ...
    }).returning();
    
    // Create calendar event
    try {
      await createCalendarEvent({
        title: appointmentConfig.serviceName,
        description: `Appointment with ${newAppointment.customerName}`,
        startTime: newAppointment.startTime,
        endTime: newAppointment.endTime,
        attendeeEmail: newAppointment.customerEmail,
        attendeeName: newAppointment.customerName,
        location: '', // Add if appointment config includes location
      });
    } catch (calendarError) {
      // Log error but don't fail the booking
      console.error('Failed to create calendar event:', calendarError);
    }
    
    // ... existing email notification and response logic ...
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create appointment' });
  }
}
```

**If custom booking system:**

Integrate calendar event creation into the booking creation handler identified in Pre-Dependency step.

---

## Step 8: Verification Checklist

- [ ] `/api/calendar/status` returns `{ connected: true }`
- [ ] `/settings/calendar` shows provider and connection state
- [ ] Test: create a booking → calendar event appears in external calendar (Google/Outlook/iCloud)
- [ ] Verify: booking confirmation email includes .ics attachment (from appointments skill) AND event appears in connected calendar (from this skill)
- [ ] Two-way only: `/api/calendar/status` returns `watchChannelActive: true`
- [ ] Two-way only: delete the event from the calendar → booking slot becomes available again

---

## After Setup Messages

### One-Way Sync

> "Your calendar is connected.
>
> Provider: [Google / Outlook / Apple iCloud] | Mode: Receive new bookings
>
> Every new booking will automatically appear in your calendar. **To test:** Create a booking and confirm the event appears in your calendar."

### Two-Way Sync (Google)

> "Your calendar is connected with two-way sync.
>
> Provider: Google Calendar
>
> - New bookings appear in your calendar automatically
> - Calendar updates (cancellations, reschedules, conflicts) in Google Calendar automatically sync back and update bookings in your app
>
> **To verify:** Go to your calendar settings page and confirm it shows 'Connected'. Then create a test booking, delete or reschedule it from Google Calendar, and confirm the changes reflect in your app."

### Two-Way Sync (Outlook)

> "Your calendar is connected with two-way sync.
>
> Provider: Outlook / Microsoft 365
>
> - New bookings appear in your calendar automatically
> - Calendar updates (cancellations, reschedules, conflicts) in Outlook automatically sync back and update bookings in your app
>
> **To verify:** Go to your calendar settings page and confirm it shows 'Connected'. Then create a test booking, delete or reschedule it from Outlook, and confirm the changes reflect in your app."

---

## Troubleshooting

| Symptom                                                                                                              | Root Cause                                                                      | Fix                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `redirect_uri_mismatch`                                                                                              | Secret doesn't exactly match the URI registered in the provider console         | Set both to the identical string ending in `/api/calendar/callback` — no trailing slash                                                                                                                            |
| `req.body` is `undefined` in API routes                                                                              | `express.json()` in `serverBefore` instead of `handlerBefore`                   | Move `handler.use(express.json())` to `handlerBefore` in `src/server/configure.js`                                                                                                                                 |
| Google webhooks fire to wrong URL — `POST /settings/calendar` with `User-Agent: APIs-Google` and `X-Goog-Channel-Id` | Watch channel registered with stale `CALENDAR_WEBHOOK_URL` baked in at creation | Fix secret to end with `/api/calendar/webhooks`, restart server — renewal job re-registers on next run                                                                                                             |
| Two-way sync silently stopped after ~7 days (Google)                                                                 | Watch channel expired; auto-renewal not wired                                   | Add dynamic import of `watch-renewal.ts` in `serverBefore` hook                                                                                                                                                    |
| Two-way sync silently stopped after ~3 days (Microsoft)                                                              | Graph subscription expired; auto-renewal not wired                              | Add `renewExpiringMicrosoftSubscriptions` to `configure.js` and restart                                                                                                                                            |
| Microsoft `clientState` mismatch — 401                                                                               | Stored `clientState` doesn't match what Microsoft sends                         | Disconnect and reconnect from `/settings/calendar` to create a fresh subscription                                                                                                                                  |
| `syncToken` 410 error from Google                                                                                    | Sync token expired (~30 days inactivity)                                        | Auto-handled — handler falls back to full resync; no action needed                                                                                                                                                 |
| Microsoft subscription validation fails on creation                                                                  | Webhook not reflecting `validationToken` correctly                              | Ensure handler reflects `?validationToken` as plain text (`Content-Type: text/plain`, status 200), not JSON                                                                                                        |
| Booking created but no calendar event                                                                                | Connection inactive, tokens expired, or silent creation failure                 | Check `calendar_connections` for `is_active = 1`; look for `calendar.event.create.failed` in logs                                                                                                                  |
| Calendar event created but no `calendar_synced_events` row                                                           | Mapping insert missing from booking creation flow                               | Add the `calendarSyncedEvents` insert after `createEvent` succeeds                                                                                                                                                 |
| `Could not resolve` SSR build error                                                                                  | Calendar module in `src/lib/` — Vite SSR can't resolve it from API handlers     | Move to `src/server/calendar/`, update import to `@api/root/src/server/calendar/...`                                                                                                                               |
| Tokens not revoked after disconnect                                                                                  | Disconnect only marks DB row inactive                                           | Call revocation endpoint: Google — `POST https://oauth2.googleapis.com/revoke?token={accessToken}`; Microsoft — `revokeSignInSessions`; Apple — user must revoke at [appleid.apple.com](https://appleid.apple.com) |

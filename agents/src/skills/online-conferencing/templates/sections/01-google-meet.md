# § Google Meet — Setup & Implementation

Complete setup walkthrough, credential collection, and implementation guidance for Google Meet integration.

---

## § 1.1 Console Setup

Guide the customer through the following — the LLM knows the Google Cloud Console, so adapt these steps to the UI as needed:

1. **Create a Google Cloud project** at https://console.cloud.google.com/
2. **Enable the Google Calendar API** under APIs & Services → Library
3. **Configure the OAuth consent screen** — pick External user type (or Internal if the whole org is on Google Workspace); add the scope `https://www.googleapis.com/auth/calendar.events`; add the host Google account as a Test User
4. **Create an OAuth 2.0 Client ID** (application type: Web application) with `https://developers.google.com/oauthplayground` as an Authorized redirect URI — copy the Client ID and Client Secret
5. **Get a refresh token** via https://developers.google.com/oauthplayground — configure it to use the customer's own OAuth credentials (Client ID + Secret from step 4), authorize the scope `https://www.googleapis.com/auth/calendar.events` signed in as the host Google account, exchange for tokens, copy the refresh token

⚠️ The Google account used in step 5 becomes the **host** of every meeting this app generates — advise the customer to use a long-lived business account, not a personal one.

---

## § 1.2 Request Credentials

Call `requestSecrets()` to collect three credentials:
- `GOOGLE_CLIENT_ID` (required)
- `GOOGLE_CLIENT_SECRET` (required)
- `GOOGLE_REFRESH_TOKEN` (required)

Set `mode: 'add'` and provide a title/description explaining these are for Google Calendar API to create Meet links. Wait for secrets to be stored before proceeding — they'll be available as `process.env.GOOGLE_CLIENT_ID`, etc.

---

## § 1.3 Install Package

Run `npm install googleapis` to install the latest stable Google APIs client library. Verify against https://developers.google.com/calendar/api before writing implementation code.

---

## § 1.4 Generate `src/lib/google-meet-integration.ts`

This module owns all Google-specific code. Everything else in the app talks to it via the dispatcher's `createMeeting()` function.

**Concepts to keep in mind as you write it:**

- **Auth.** Use `google.auth.OAuth2` from `googleapis`. Construct it with client ID + secret, then call `setCredentials({ refresh_token })`. The library transparently refreshes access tokens from the refresh token — you never need to manage access tokens yourself.
- **Creating a Meet link.** Call `calendar.events.insert()` with `conferenceDataVersion: 1` and a `conferenceData.createRequest` whose `conferenceSolutionKey.type` is `'hangoutsMeet'`. `requestId` must be unique per call — use `crypto.randomUUID()`.
- **Extracting the link.** The response's `data.hangoutLink` is the Meet URL. If it's missing, treat that as an API failure (throw `ConferencingError` with `API_ERROR`).
- **Error mapping.** Map `401` → `INVALID_CREDENTIALS`, `403` → `INSUFFICIENT_PERMISSIONS`, `429` → `RATE_LIMIT_EXCEEDED`, `404` → `MEETING_NOT_FOUND`, everything else → `API_ERROR`. Always pass the original error through `originalError` for debugging.
- **Status location.** Read HTTP status from `err.response?.status` first (canonical Gaxios location), falling back to `err.code` (older versions + Node system errors like `ENOTFOUND`).
- **Deletion.** `calendar.events.delete({ calendarId: 'primary', eventId })` removes both the calendar event and the Meet link.

**What the module should export:**

```typescript
export async function createGoogleMeeting(params: CreateMeetingParams): Promise<MeetingResponse>;
export async function deleteGoogleMeeting(calendarEventId: string): Promise<void>;
```

**Implementation instructions:**

**IMPORTANT**: Before writing code, consult the official Google Calendar API documentation at https://developers.google.com/calendar/api to verify current API patterns, request/response shapes, and authentication flows. The instructions below provide guidance, but the official docs are authoritative.

**1. Import dependencies:**
- `google` from `googleapis`
- `randomUUID` from `crypto`
- Your conferencing types and error classes

**2. Create auth helper function:**
- Construct `new google.auth.OAuth2` with `process.env.GOOGLE_CLIENT_ID` and `process.env.GOOGLE_CLIENT_SECRET`
- Call `setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })` on the client
- Return the configured client
- The googleapis library handles access token refresh automatically — you never need to manage access tokens

**3. Implement `createGoogleMeeting`:**
- Get a calendar API client: `google.calendar({ version: 'v3', auth: getAuthClient() })`
- Calculate start time from `params.startTime` and end time from `params.durationMinutes`
- Call `calendar.events.insert()` with:
  - `calendarId: 'primary'`
  - `conferenceDataVersion: 1` (required for Meet link generation)
  - `requestBody` containing:
    - `summary`, `description` from params
    - `start` and `end` with `dateTime` (ISO 8601) and `timeZone` (default to `'UTC'`)
    - `attendees` array with `{ email }` objects
    - `conferenceData.createRequest` with unique `requestId` (use `randomUUID()`) and `conferenceSolutionKey: { type: 'hangoutsMeet' }`
- Extract `data.hangoutLink` and `data.id` from the response
- If either is missing, throw `ConferencingError` with `API_ERROR` code
- Return `{ joinUrl: data.hangoutLink, id: data.id, provider: 'google', calendarEventId: data.id }`
- Wrap in try-catch and map errors using your error mapper

**4. Implement `deleteGoogleMeeting`:**
- Get a calendar API client
- Call `calendar.events.delete({ calendarId: 'primary', eventId: calendarEventId })`
- Wrap in try-catch with error mapping

**5. Create error mapper function:**
- If error is already a `ConferencingError`, return it as-is
- Extract HTTP status from `err.response?.status` (canonical Gaxios location) or fall back to `err.code` (for Node system errors)
- Map status codes to error codes:
  - `401` → `INVALID_CREDENTIALS` ("Google OAuth credentials are missing or expired")
  - `403` → `INSUFFICIENT_PERMISSIONS` ("Calendar API is not enabled or the account lacks permission")
  - `404` → `MEETING_NOT_FOUND` ("Calendar event not found")
  - `429` → `RATE_LIMIT_EXCEEDED` ("Google Calendar API rate limit hit — back off and retry")
  - Everything else → `API_ERROR` with the original error message
- Always pass the original error as the last parameter for debugging

**Reference**: https://developers.google.com/calendar/api

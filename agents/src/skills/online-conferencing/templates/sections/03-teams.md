# § Microsoft Teams — Setup & Implementation

Complete setup walkthrough, credential collection, and implementation guidance for Microsoft Teams integration.

---

## § 3.1 Console Setup

Guide the customer through the following — the LLM knows the Azure Portal, so adapt these steps to the UI as needed:

1. **Register a new app** in Microsoft Entra ID (Azure AD) at https://portal.azure.com/ — single-tenant, no redirect URI needed; copy the **Application (client) ID** and **Directory (tenant) ID** from the app overview
2. **Create a client secret** under Certificates & secrets — copy the **Value immediately**, Azure hides it permanently on navigation away from the page
3. **Add API permissions** — Microsoft Graph → **Application permissions** (NOT Delegated, they look identical): add `Calendars.ReadWrite` and `OnlineMeetings.ReadWrite.All`
4. **Grant admin consent** — a Global Administrator must click "Grant admin consent" on the API permissions page; without this every API call returns 403. If the customer isn't an admin, have them ask their admin to grant consent on the registered app.
5. **Identify the meeting organizer** — Teams meetings are hosted on a specific user's calendar; use their UPN (email) or Object ID as `MICROSOFT_USER_ID`

⚠️ **Application permissions, not Delegated** — these look identical in the Azure UI but only Application works for server-to-server auth.
⚠️ **Admin consent is mandatory** — the app is non-functional without it; 403 errors on every call are the symptom.

---

## § 3.2 Request Credentials

Call `requestSecrets()` to collect four credentials:
- `MICROSOFT_TENANT_ID` (required)
- `MICROSOFT_CLIENT_ID` (required)
- `MICROSOFT_CLIENT_SECRET` (required)
- `MICROSOFT_USER_ID` (required - the user whose calendar will host meetings, their object ID or UPN/email)

Set `mode: 'add'` and provide a title/description explaining these are for Microsoft Graph API to create Teams meetings.

Wait for the secrets to be stored before moving on — they'll be available as `process.env.MICROSOFT_TENANT_ID`, etc.

---

## § 3.3 Install Packages

Run `npm install @microsoft/microsoft-graph-client` to install the Microsoft Graph SDK.

Also requires `axios` for the OAuth token endpoint — install if not already present: `npm install axios`.

Install the latest stable versions. Note: The `@microsoft/microsoft-graph-types` package is optional (provides stricter typing); skip it to minimize dependencies.

---

## § 3.4 Generate `src/lib/teams-integration.ts`

**Concepts to keep in mind as you write it:**

- **Two-step auth.** POST to `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` with client credentials to get an access token. Cache using `expires_in` from the response with a 60-second safety margin. Add single-flight protection.
- **Scope string.** The only valid scope for client credentials is `https://graph.microsoft.com/.default` (with `/.default` suffix). Don't pass `Calendars.ReadWrite` — Azure uses the app's pre-consented permissions.
- **Creating the meeting.** `POST /users/{userId}/events` with `subject`, `start`, `end`, optional `body`, `attendees`, and critically: `isOnlineMeeting: true` + `onlineMeetingProvider: 'teamsForBusiness'`. Without these last two, you create a calendar event with no Teams link.
- **Extracting the link.** `response.onlineMeeting.joinUrl` is the Teams link. If it's missing, treat as `API_ERROR`.
- **Error mapping.** Map `400/401` → `INVALID_CREDENTIALS` (clear cache), `403` → `INSUFFICIENT_PERMISSIONS` (admin consent missing), `404` on delete → `MEETING_NOT_FOUND`, `429` → `RATE_LIMIT_EXCEEDED` (respect `Retry-After`), everything else → `API_ERROR`.
- **Deletion.** `DELETE /users/{userId}/events/{eventId}` removes both the calendar event and the Teams meeting.

**What the module should export:**

```typescript
export async function createTeamsMeeting(params: CreateMeetingParams): Promise<MeetingResponse>;
export async function deleteTeamsMeeting(calendarEventId: string): Promise<void>;
```

**Implementation instructions:**

**IMPORTANT**: Before writing code, consult the official Microsoft Graph API documentation at https://learn.microsoft.com/en-us/graph/api/user-post-events to verify current endpoints, request/response shapes, and authentication flows. Microsoft occasionally renames fields or changes which properties trigger Teams-meeting creation, so always reference the latest documentation.

**1. Import dependencies:**
- `axios` for OAuth token requests
- `Client` from `@microsoft/microsoft-graph-client`
- Your conferencing types and error classes

**2. Set up token caching (module-level):**
- Create a cache variable for `{ token: string; expiresAt: number } | null`
- Create an inflight promise tracker for single-flight protection
- This prevents concurrent cold-start calls from making multiple token requests

**3. Implement `getAccessToken` helper:**
- Check if cached token exists and hasn't expired, return it if valid
- If there's already an inflight request, return that promise (single-flight)
- Otherwise, POST to `https://login.microsoftonline.com/{MICROSOFT_TENANT_ID}/oauth2/v2.0/token` with:
  - Content-Type: `application/x-www-form-urlencoded`
  - Body (URL-encoded): `client_id`, `client_secret`, `scope`, `grant_type`
  - **Critical**: `scope` MUST be exactly `https://graph.microsoft.com/.default` (with `/.default` suffix) — don't pass specific scopes like `Calendars.ReadWrite`, Azure uses the app's pre-consented permissions
  - `grant_type` must be `client_credentials`
- Extract `access_token` and `expires_in` from response
- Cache the token with expiry: `Date.now() + (expires_in - 60) * 1000` (60-second safety margin, minimum 60 seconds)
- Clear the inflight tracker in a `finally` block
- On error, map using your error mapper

**4. Implement `createTeamsMeeting`:**
- Get access token via `getAccessToken()`
- Initialize Graph client: `Client.init({ authProvider: (done) => done(null, token) })`
- Calculate start time from `params.startTime` and end time from `params.durationMinutes`
- Get userId from `process.env.MICROSOFT_USER_ID`
- POST to `/users/{userId}/events` with:
  - `subject` (from `params.title`)
  - `body` object with `contentType: 'HTML'` and `content` (from `params.description`)
  - `start` and `end` objects with `dateTime` (ISO 8601) and `timeZone` (default to `'UTC'`)
  - `attendees` array with `{ emailAddress: { address }, type: 'required' }` objects
  - **Critical**: `isOnlineMeeting: true` and `onlineMeetingProvider: 'teamsForBusiness'` — without these, you create a calendar event with no Teams link
- Extract `event.onlineMeeting.joinUrl` and `event.id` from response
- If either is missing, throw `ConferencingError` with `API_ERROR` code
- Return `{ joinUrl, id: event.id, provider: 'teams', calendarEventId: event.id }`
- Wrap in try-catch with error mapping

**5. Implement `deleteTeamsMeeting`:**
- Get access token and initialize Graph client
- Get userId from `process.env.MICROSOFT_USER_ID`
- DELETE `/users/{userId}/events/{calendarEventId}` — this removes both the calendar event and the Teams meeting
- Wrap in try-catch with error mapping

**6. Create error mapper function:**
- If error is already a `ConferencingError`, return it as-is
- Extract HTTP status from `err.statusCode` (Graph SDK location) or fall back to `err.response?.status`
- Map status codes:
  - `400` or `401` → `INVALID_CREDENTIALS` ("Microsoft Graph token invalid, expired, or credentials misconfigured") — **also clear the token cache**
  - `403` → `INSUFFICIENT_PERMISSIONS` ("Missing Calendars.ReadWrite or OnlineMeetings.ReadWrite.All — check admin consent")
  - `404` → `MEETING_NOT_FOUND` ("Teams calendar event not found")
  - `429` → `RATE_LIMIT_EXCEEDED` ("Microsoft Graph throttled — respect Retry-After header")
  - Everything else → `API_ERROR` with the original error message
- Always pass the original error as the last parameter for debugging

**Reference**: https://learn.microsoft.com/en-us/graph/api/user-post-events

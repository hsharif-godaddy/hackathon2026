# § Zoom — Setup & Implementation

Complete setup walkthrough, credential collection, and implementation guidance for Zoom integration.

---

## § 2.1 Console Setup

Guide the customer through the following — the LLM knows the Zoom Marketplace, so adapt these steps to the UI as needed:

1. **Create a Server-to-Server OAuth app** at https://marketplace.zoom.us/ — this app type requires no end-user sign-in
2. **Copy Account ID, Client ID, and Client Secret** from the App Credentials tab
3. **Add meeting scopes** — the app needs admin-level create, read, and delete permissions for meetings (look for scopes matching `meeting:write`, `meeting:read`, `meeting:delete` at admin level)
4. **Activate the app** — this is the most common missed step; every API call returns a 400 error until the app is activated

⚠️ The app **must be activated** before any API calls will work. If the customer sees 400 errors, check activation first.

---

## § 2.2 Request Credentials

Call `requestSecrets()` to collect three credentials:
- `ZOOM_ACCOUNT_ID` (required)
- `ZOOM_CLIENT_ID` (required)
- `ZOOM_CLIENT_SECRET` (required)

Set `mode: 'add'` and provide a title/description explaining these are for Zoom's Server-to-Server OAuth API. Mention that all values come from the "App Credentials" tab of the Zoom Marketplace app.

Wait for the secrets to be stored before moving on — they'll be available as `process.env.ZOOM_ACCOUNT_ID`, etc.

---

## § 2.3 Install Package

Run `npm install axios` to install the HTTP client. Zoom has no official Node SDK, so the integration uses axios for both the OAuth token endpoint and the meetings API. Install the latest stable version.

---

## § 2.4 Generate `src/lib/zoom-integration.ts`

**Concepts to keep in mind as you write it:**

- **Auth is two-step.** First POST to `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=<id>` with Basic Auth (client ID : client secret) to get an access token. Then use that token as a `Bearer` header on meeting calls.
- **Token caching.** Cache the token in memory using `expires_in` from the response with a 60-second safety margin. Add single-flight protection so concurrent cold-start calls share one token request.
- **Access token expiry.** On any 401, clear the token cache and re-auth — never assume a cached token is valid after a revocation or rotation.
- **Creating a meeting.** `POST https://api.zoom.us/v2/users/me/meetings` with `topic`, `type: 2` (scheduled), `start_time`, `duration`, and optional `timezone` and `agenda`. Response contains `id`, `join_url`, `start_url`.
- **`join_url` vs `start_url`.** `join_url` is what attendees use. `start_url` is the host's admin link and MUST NOT be sent to attendees — it grants host privileges. Return `join_url` as `joinUrl` and `start_url` as `hostUrl`.
- **Error mapping.** Map `400/401` → `INVALID_CREDENTIALS` (clear cache), `403` → `INSUFFICIENT_PERMISSIONS`, `404` on delete → `MEETING_NOT_FOUND`, `429` → `RATE_LIMIT_EXCEEDED`, everything else → `API_ERROR`.
- **Deletion.** `DELETE https://api.zoom.us/v2/meetings/{meetingId}`. Returns 204 on success. `calendarEventId` is not used (Zoom meetings aren't calendar-backed).

**What the module should export:**

```typescript
export async function createZoomMeeting(params: CreateMeetingParams): Promise<MeetingResponse>;
export async function deleteZoomMeeting(meetingId: string): Promise<void>;
```

**Implementation instructions:**

**IMPORTANT**: Before writing code, consult the official Zoom Meetings API documentation at https://developers.zoom.us/docs/api/meetings/ to verify current endpoints, request/response shapes, and authentication flows. Zoom adjusts scope names and response fields periodically, so always reference the latest documentation.

**1. Import dependencies:**
- `axios` for HTTP requests
- Your conferencing types and error classes

**2. Set up token caching (module-level):**
- Create a cache variable for `{ token: string; expiresAt: number } | null`
- Create an inflight promise tracker for single-flight protection
- This prevents concurrent cold-start calls from making multiple token requests

**3. Implement `getAccessToken` helper:**
- Check if cached token exists and hasn't expired (`expiresAt > Date.now()`), return it if valid
- If there's already an inflight request, return that promise (single-flight)
- Otherwise, make a POST request to `https://zoom.us/oauth/token` with:
  - Query params: `grant_type=account_credentials`, `account_id=process.env.ZOOM_ACCOUNT_ID`
  - Basic Auth header using `ZOOM_CLIENT_ID` as username and `ZOOM_CLIENT_SECRET` as password
- Extract `access_token` and `expires_in` from response
- Cache the token with expiry time: `Date.now() + (expires_in - 60) * 1000` (60-second safety margin, minimum 60 seconds)
- Clear the inflight tracker in a `finally` block
- On any 401 during token fetch, treat as `INVALID_CREDENTIALS`

**4. Implement `createZoomMeeting`:**
- Get access token via `getAccessToken()`
- POST to `https://api.zoom.us/v2/users/me/meetings` with Bearer token header
- Request body should include:
  - `topic` (from `params.title`)
  - `type: 2` (scheduled meeting)
  - `start_time` (ISO 8601 format from `params.startTime`)
  - `duration` (from `params.durationMinutes`)
  - `timezone` (from `params.timezone` or default to `'UTC'`)
  - `agenda` (from `params.description`)
  - `settings` object with reasonable defaults (e.g., `host_video: true`, `participant_video: true`, `waiting_room: true`)
- Extract from response:
  - `join_url` → return as `joinUrl` (this is what attendees use)
  - `start_url` → return as `hostUrl` (HOST ONLY — never send to attendees, grants host privileges)
  - `id` → convert to string and return as `id`
- Return `{ joinUrl, id: String(data.id), provider: 'zoom', hostUrl }`
- Wrap in try-catch with error mapping

**5. Implement `deleteZoomMeeting`:**
- Get access token via `getAccessToken()`
- DELETE to `https://api.zoom.us/v2/meetings/{meetingId}` with Bearer token header
- Returns 204 on success
- Note: `calendarEventId` parameter is not used (Zoom meetings aren't calendar-backed)
- Wrap in try-catch with error mapping

**6. Create error mapper function:**
- If error is already a `ConferencingError`, return it as-is
- Extract HTTP status from `err.response?.status`
- Map status codes:
  - `400` or `401` → `INVALID_CREDENTIALS` ("Zoom access token invalid, expired, or credentials misconfigured") — **also clear the token cache**
  - `403` → `INSUFFICIENT_PERMISSIONS` ("Zoom app lacks required meeting scopes")
  - `404` → `MEETING_NOT_FOUND` (use `err.response?.data?.message` if available)
  - `429` → `RATE_LIMIT_EXCEEDED` ("Zoom API rate limit hit — check X-RateLimit-* headers and back off")
  - Everything else → `API_ERROR` (prefer `err.response?.data?.message` over generic message)
- Always pass the original error as the last parameter for debugging

**Reference**: https://developers.zoom.us/docs/api/meetings/

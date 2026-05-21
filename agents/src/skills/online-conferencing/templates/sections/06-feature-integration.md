# § Feature Integration Patterns

Where `createMeeting()` fits inside a feature's endpoint. (Multi-provider patterns in § 5 tell you *what to pass for `provider`*; these patterns tell you *where the call lives in the feature code*.)

---

## § 6.1 Pattern A — Standalone meeting link (no persistence)

**When:** User wants a link emailed or pasted somewhere. No DB write, no feature integration.

**Implementation:**
- Call `createMeeting()` with provider, title, startTime, and durationMinutes
- Extract `meeting.joinUrl` from the response
- Send via email skill or return in API response
- No database persistence needed

---

## § 6.2 Pattern B — Booking with auto-generated link (most common)

**When:** Meeting generation runs alongside a booking/appointment creation flow.

**Critical rule:** Meeting generation runs **after** the booking is persisted, wrapped in its own try/catch. The booking must succeed even if the provider API is down.

**Implementation flow:**

1. **Create the booking/appointment in the database first**

2. **Attempt meeting generation (wrapped in try/catch):**
   - Declare `let meeting: MeetingResponse | null = null`
   - In try block: call `createMeeting()` with provider, title (e.g., `"Appointment with ${customerName}"`), startTime, durationMinutes, and attendees array
   - In catch block:
     - Log the error with structured payload: `console.error('skill.conferencing.create.failed', { provider, code, appointmentId, message })`
     - Use `err instanceof ConferencingError ? err.code : 'UNKNOWN'` for the code field
     - **Fall through** — don't re-throw; the appointment should stand even without a meeting link

3. **Update database if meeting was created:**
   - Check `if (meeting)` before updating
   - Update the booking record with:
     - `meetingLink: meeting.joinUrl`
     - `meetingId: meeting.id`
     - `meetingProvider: meeting.provider`
     - `calendarEventId: 'calendarEventId' in meeting ? meeting.calendarEventId : null`
     - `meetingCreatedAt: new Date()`

4. **Send confirmation email:**
   - Load the `email` skill
   - Compose the confirmation message
   - Include `meeting?.joinUrl` if present (guard for null case)
   - **Email sends regardless of whether meeting generation succeeded**

---

## § 6.3 Pattern C — Event with one shared link for all registrants

Generate the link **when the event is created**, not per registration. Everyone registering for the same event gets the same `joinUrl`. On each registration, read the link off the event row and include it in the confirmation email.

---

## § 6.4 Pattern D — Paid consultation

**When:** Meeting generation is triggered by a successful payment.

**Critical rule:** Generate the meeting **after** payment succeeds — never waste API quota on failed charges.

**Implementation:**
- Verify payment status first (e.g., check Stripe charge status is `'paid'`)
- Return error if payment not confirmed
- Only after payment confirmation, call `createMeeting()`
- Follow Pattern B for database persistence and error handling

---

## § 6.5 Email Integration (Delegated)

**Important:** Do not send email from this skill. When a confirmation email is needed:

1. **Load the `email` skill**
2. **Follow email skill patterns** for SMTP configuration and sender address
3. **Build the message body with meeting link:**
   - Guard for the null case — if generation failed, the email should still go out without the "Join Meeting" block
   - When link is present, include:
     - A styled button/link with `href="{{meetingLink}}"` and text like "Join {{providerDisplayName}}"
     - A plain text fallback showing the link URL
   - Recommended inline styles for button: `display:inline-block`, `padding:12px 24px`, `background:#1a73e8`, `color:#fff`, `text-decoration:none`, `border-radius:4px`, `font-weight:600`

**Provider display names:**
- Map `meetingProvider` to human-readable names:
  - `'google'` → `'Google Meet'`
  - `'zoom'` → `'Zoom'`
  - `'teams'` → `'Microsoft Teams'`
- Fall back to `"Join Meeting"` when provider is unknown or null

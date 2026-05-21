# § Error Handling, Testing & Common Mistakes

---

## § 7.1 Error Handling Principles

- **Graceful degradation.** The booking/event/consultation is the core user-visible action. Meeting generation is a value-add. If the provider call fails, log it, leave the meeting fields null, and continue — never turn a 500 from Google/Zoom/Teams into a 500 for the customer-facing request.
- **Throw typed errors from integrations.** Each `<provider>-integration.ts` should only ever throw `ConferencingError`. Callers then decide whether to catch-and-degrade or re-throw based on context.
- **Log with a stable prefix.** Use `skill.conferencing.*` event names in logs so they're easy to filter later (Loki, Datadog, etc.). Include `provider` and `code` in the log payload.
- **Retry cautiously.** Don't retry `INVALID_CREDENTIALS` or `INVALID_PARAMETERS` (same error every time). Do retry `RATE_LIMIT_EXCEEDED` and transient 5xx with exponential backoff. For Teams specifically, respect the `Retry-After` header on 429s. Cap retries at ~3.

---

## § 7.2 Testing and Verification

Hand the user a running feature, not just code.

### Phase 1 — Per-provider smoke test

**Goal:** Verify each configured provider can create meetings.

**Method:**
- Create a throwaway script that imports `createMeeting` from the dispatcher
- Call it with test parameters:
  - `provider`: each configured provider ('google', 'zoom', 'teams')
  - `title`: something like 'Smoke test'
  - `startTime`: 1 hour from now (ISO 8601 format)
  - `durationMinutes`: 15
- Log the provider and joinUrl from the response

**Expected URL patterns:**
- Google: `https://meet.google.com/...`
- Zoom: `https://...zoom.us/j/...`
- Teams: `https://teams.microsoft.com/l/meetup-join/...`

**If a provider fails:** Check `ConferencingError.code` to identify the issue — troubleshoot that provider in isolation.

### Phase 2 — Feature end-to-end

Book an appointment (or register for an event, or the relevant feature). Check:
- App returns 201 with `meetingLink` populated
- DB row has all five meeting columns filled in
- `meeting_provider` matches the provider used (important for multi-provider Pattern 3/4)
- Confirmation email arrives with a working link
- Clicking the link opens the correct platform

For Pattern 3 (end-user-picks), repeat for each dropdown option — confirm each booking records the right `meeting_provider`.

### Phase 3 — Break it on purpose

Temporarily invalidate a credential (`GOOGLE_CLIENT_ID=broken` in `/alloc/config.json`). Book again. Confirm:
- Appointment still created
- `meetingLink` is null for that booking
- Email still sent (minus the "Join Meeting" block)

Restore the credential. **This test is mandatory** — graceful degradation is the most common thing accidentally broken.

---

## § 7.3 Common Mistakes

- **Forgetting `conferenceDataVersion: 1` on Google calls.** Without it, the calendar event is created but the response has no `hangoutLink` — the integration throws `API_ERROR`. Don't drop this field during refactors.
- **Putting any provider SDK call inside a DB transaction.** Network I/O inside a transaction blocks the DB row and can deadlock the table. Create the booking first, commit, then call `createMeeting`.
- **Throwing on meeting failure inside the booking handler.** See Pattern B — always try/catch around the `createMeeting()` call. A failed meeting must not fail the booking.
- **Hardcoding a timezone.** If the customer's users are in multiple timezones, take it as input or store it on the record. Default to `'UTC'` for the API call but localize in the UI/email.
- **Sending Zoom's `start_url` (`hostUrl`) to attendees.** That's the host admin URL. Only the organizer should ever see it. Attendees get `joinUrl`.
- **Forgetting admin consent on Teams.** The Azure AD app works until a real API call is made, then fails with 403. Always remind the customer to click "Grant admin consent" after adding permissions.
- **Leaving `case 'teams':` in the dispatcher when Teams isn't configured.** Dead code. Dispatcher cases should exactly match configured providers.
- **Generating `DEFAULT_CONFERENCING_PROVIDER` for Pattern 2, 3, or 4.** Dead config — every call site is explicit. Only emit it for Pattern 1.
- **Form/allowlist/dispatcher drift in Pattern 3.** If the form shows Google + Zoom but the allowlist or dispatcher doesn't match, customers get unexpected 400 or 500 errors. Keep all three in sync.
- **Implementing email inside this skill.** Load the `email` skill. Every time.

---

## § 7.4 After Setup

**Report back with a clean summary** that matches what was actually built:

**Summary structure:**
- Opening line: "Video conferencing is live on this app."
- **Configured providers:** List each provider with relevant details (e.g., "Google Meet (hosted by <account>)", "Zoom (Server-to-Server OAuth app)")
- **Wiring pattern:** Describe which pattern is used and how (e.g., "End users pick the meeting platform when they book", "All appointments use Google Meet", etc.)
  - Mention validation logic for Pattern 3 (allowlist)
  - Note database persistence fields
  - Describe email integration
- **Graceful degradation verification:** Confirm that breaking a credential still allows bookings/emails (minus the link)
- **What's next:** Offer 2-3 extension options:
  1. Add another provider
  2. Wire meeting deletion into cancellation flow
  3. Add an admin view for meetings

**For single-provider apps:** Simplify the providers list to one line and omit wiring pattern details. Keep degradation confirmation and "what next" suggestions — invites the customer to extend later.

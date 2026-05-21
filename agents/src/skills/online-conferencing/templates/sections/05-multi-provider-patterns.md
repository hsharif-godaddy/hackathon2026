# § Multi-Provider Wiring Patterns

The four patterns that answer "which provider does `createMeeting()` use at each call site?" All share the same rule: the `provider` value is always explicit at the call site — no hidden config, no runtime magic.

| Customer situation | Pattern |
|---|---|
| One provider only (or clear dominant default) | **1. Single provider + optional DEFAULT** |
| Different features lock to different providers | **2. Per-feature hardcoding** |
| End users choose on the booking form | **3. End-user-picks-on-form** |
| Reliability > simplicity (rare) | **4. Fallback chain** |

---

## § 5.1 Pattern 1 — Single Provider (+ optional `DEFAULT_CONFERENCING_PROVIDER`)

**When:** Customer picked one provider, OR picked multiple but one is the clear default for every feature.

**Wiring:** Every `createMeeting()` call uses the same provider literal. Two options:

**Option A: Explicit literal everywhere**
- Pass `provider: 'google'` (or `'zoom'` / `'teams'`) in every `createMeeting()` call
- Simple, no wrapper needed
- Example: `await createMeeting({ provider: 'google', title, startTime, durationMinutes })`

**Option B: Default provider wrapper**
- Add `DEFAULT_CONFERENCING_PROVIDER` env var (e.g., `DEFAULT_CONFERENCING_PROVIDER=google`)
- Use the `createMeetingWithDefault` wrapper (see § 4.3) which reads the env var
- Call sites can omit `provider` field, and it uses the default
- Example: `await createMeetingWithDefault({ title, startTime, durationMinutes })`

Only generate the `DEFAULT_CONFERENCING_PROVIDER` env var and wrapper for this pattern.

---

## § 5.2 Pattern 2 — Per-Feature Hardcoding

**When:** Different features should always use specific providers (e.g., "Google Meet for 1:1 appointments, Zoom for webinars").

**Wiring:** Each feature file hardcodes its provider literal at every call site. Examples:
- Appointments route always passes `provider: 'google'`
- Events route always passes `provider: 'zoom'`
- Consultations route always passes `provider: 'teams'`

Each call site in each feature route/file explicitly specifies which provider to use with a hardcoded literal.

**Benefit:** Easy to audit (grep for `"provider: 'zoom'"` finds all Zoom calls) and refactor (change the literal in one file affects only that feature).

**No `DEFAULT_CONFERENCING_PROVIDER` needed** — every call site is explicit.

---

## § 5.3 Pattern 3 — End-User-Picks-on-Form

**When:** Customer wants their end users to choose the meeting platform at booking time.

**Frontend:**
- Add a `<select>` dropdown with `name="meetingProvider"`
- Include `<option>` elements for each configured provider (e.g., `value="google"` → "Google Meet", `value="zoom"` → "Zoom", `value="teams"` → "Microsoft Teams")
- Only show providers this app has actually configured

**Backend validation (CRITICAL):**
- **Never trust the form field directly** — always validate against an allowlist
- Create a `Set` of allowed provider names (e.g., `ALLOWED_PROVIDERS = new Set(['google', 'zoom'])`) containing only the providers this app configured
- Write a validation function that:
  - Checks `typeof input === 'string'`
  - Checks `ALLOWED_PROVIDERS.has(input as ConferencingProviderName)`
  - Throws `ConferencingError` with `INVALID_PARAMETERS` if validation fails
  - Returns the cast provider name if valid
- Pass the validated provider to `createMeeting()`

**Why:** An unsupported provider should return a clean 400 error, not cause a runtime crash from the dispatcher's `default` case.

---

## § 5.4 Pattern 4 — Fallback Chain

**When:** Customer prioritizes reliability. Rare. Typically "try Google, fall back to Zoom if it fails."

**Implementation pattern:**

Create a `createMeetingWithFallback` function that accepts `Omit<CreateMeetingParams, 'provider'>`:

1. **Define the fallback chain** as an array of provider names (e.g., `['google', 'zoom']`)

2. **Define non-retryable error codes** as a Set:
   - `INVALID_CREDENTIALS`
   - `INVALID_PARAMETERS`
   - `INSUFFICIENT_PERMISSIONS`
   - These indicate configuration problems, not transient failures — fallback won't help

3. **Loop through the chain:**
   - Try calling `createMeeting({ ...params, provider })` for each provider
   - On success, return immediately
   - On error:
     - Collect the error in an array
     - If it's a `ConferencingError` with a non-retryable code, abort the fallback and re-throw (log abort reason)
     - Otherwise log the attempt failure and continue to next provider

4. **If all providers fail:**
   - Throw `ConferencingError` with `API_ERROR` code
   - Message should list all failed providers
   - Include the collected errors array for debugging

**Caveat:** Doubles API quota usage on failure. For most apps, Pattern 1 with graceful degradation (null meeting link on failure) is the better answer.

---

## § 5.5 Mixing Patterns Within One App

Patterns aren't mutually exclusive across features:
- Appointments using Pattern 2 (hardcoded Google)
- Events using Pattern 3 (end user picks Zoom/Teams)
- Admin-initiated calls using Pattern 1 (single default)

As long as every `createMeeting()` call has an explicit `provider` expression (literal, form input, or default wrapper), the mental model holds. Confirm which pattern applies to which feature with the customer before committing.

---

## § 5.6 Adding a Provider Later

Customers often start with one provider and add others later. This skill supports that re-entry flow.

**Trigger phrases:** "Also add Zoom", "Can you add Teams to my appointments", "I want to add another provider".

**Re-entry workflow:**

1. **Detect existing setup.** Check for: `src/lib/conferencing-config.ts`, `src/lib/create-meeting.ts`, one or more `src/lib/<provider>-integration.ts` files, env vars set. If any exist, don't re-run the Provider Selection Workflow — branch here instead.

2. **Enumerate what's configured.** Read `create-meeting.ts` to see which provider cases exist. Report current state:
   > "You've already got `<list>` wired up. I'll add `<new provider>` alongside it without touching the existing setup."

3. **Walk only the new provider's setup.** Use its section (§ 1, § 2, or § 3). Skip already-configured providers.

4. **Regenerate the dispatcher.** Add cases for the new provider in both `createMeeting` and `deleteMeeting`. Leave existing cases untouched.

5. **Revisit the wiring pattern.** Ask how the new provider should be used: unused-for-now, wired into a specific feature (Pattern 2), added to the form (Pattern 3), or made the new default (Pattern 1 update).

6. **Smoke test only the new provider.** Existing providers were working; don't re-test them.

**What NOT to do on re-entry:**
- Don't delete or regenerate existing integration files
- Don't re-collect existing credentials
- Don't re-install already-present packages
- Don't reset the DB schema — meeting fields are already there
- Don't change existing call sites unless explicitly asked

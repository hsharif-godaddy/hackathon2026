# § Dispatcher — Implementation Guidance

The dispatcher (`src/lib/create-meeting.ts`) routes `createMeeting()` and `deleteMeeting()` calls to the right provider. It contains cases **only for providers the customer configured**.

---

## § 4.1 Module Structure

**What to export:**

```typescript
export async function createMeeting(params: CreateMeetingParams): Promise<MeetingResponse>;
export async function deleteMeeting(params: DeleteMeetingParams): Promise<void>;
```

**Imports needed:**
- Type imports: `CreateMeetingParams`, `MeetingResponse`, `DeleteMeetingParams` from `./conferencing-types`
- Provider-specific create/delete functions from their integration modules (only import the providers the customer configured)
- Error classes: `ConferencingError`, `ConferencingErrorCode` from `./conferencing-config`

---

## § 4.2 Implementation Pattern

**For `createMeeting` function:**
- Use a `switch` statement on `params.provider`
- Add a `case` for each configured provider that calls the provider-specific create function
- Include a `default` case that throws `ConferencingError` with `INVALID_PARAMETERS` code and a message like "Provider '{provider}' is not configured in this app"

**For `deleteMeeting` function:**
- Use a `switch` statement on `params.provider`
- Add a `case` for each configured provider that calls the provider-specific delete function
- Note: The `DeleteMeetingParams` discriminated union guarantees `calendarEventId` exists for Google/Teams and is absent for Zoom — TypeScript narrows correctly
- Google and Teams pass `params.calendarEventId` to their delete functions
- Zoom passes `params.meetingId` to its delete function
- Include a `default` case with exhaustiveness checking (optional): cast to `never` and throw with `INVALID_PARAMETERS`

**Example structure for single provider (Google only):**
```typescript
switch (params.provider) {
  case 'google':
    return createGoogleMeeting(params);
  default:
    throw new ConferencingError(
      ConferencingErrorCode.INVALID_PARAMETERS,
      `Provider '${params.provider}' is not configured in this app.`
    );
}
```

**Example structure for all three providers:**
```typescript
switch (params.provider) {
  case 'google': return createGoogleMeeting(params);
  case 'zoom':   return createZoomMeeting(params);
  case 'teams':  return createTeamsMeeting(params);
  default:
    throw new ConferencingError(
      ConferencingErrorCode.INVALID_PARAMETERS,
      `Unknown provider: ${params.provider}`
    );
}
```

---

## § 4.3 Optional: Default Provider Wrapper

**Only generate this when the customer picked Pattern 1 (Single Provider with default).** For every other pattern, call sites pass `provider` explicitly, making this wrapper dead code.

If needed, add these exports:

```typescript
export type CreateMeetingInput =
  | CreateMeetingParams
  | (Omit<CreateMeetingParams, 'provider'> & { provider?: ConferencingProviderName });

export async function createMeetingWithDefault(params: CreateMeetingInput): Promise<MeetingResponse>;
```

**Implementation:**
- Read `DEFAULT_PROVIDER` from `process.env.DEFAULT_CONFERENCING_PROVIDER` (cast to `ConferencingProviderName`)
- Provide a hardcoded fallback (e.g., `'google'`) so dev environments don't crash
- If `params.provider` is undefined, use `DEFAULT_PROVIDER`
- Call the main `createMeeting` function with the resolved provider

You can rename the inner function or export both so call sites can choose explicit vs default behavior.

---
name: google-business-profile-sync
description: Connect a Google Business Profile and sync business info between the listing and the website.
whenToUse: |
  When the customer wants to connect their Google Business Profile, sync their website with their Google Business Profile, check whether their listing matches their site, or fix mismatches in business info — name, address, phone, hours, website URL, or description — between the listing and the site. This is the ONLY skill for syncing or correcting business info in either direction. Do NOT use for reviews, ratings, or testimonials — that is handled by google-reviews.
intents:
  - Connect Google Business Profile
  - Sync my website with my Google Business Profile
  - Sync Google Business listing / business info
  - My GBP doesn't match my site
  - Update my Google listing name, address, phone, hours, or description
---

# Google Business Profile Sync Skill

**Purpose:** Connect a customer's Google Business Profile (GBP) listing, surface mismatches between the live website and the GBP listing, and apply user-approved per-field syncs in either direction.

> **Scope:** This skill syncs **business info** (name, address, phone, hours, website URL, description). Review management is handled by the separate `google-reviews` skill — do NOT use this skill for reviews. Both skills coexist and reference the same Google Business Profile connection.

---

## When to Use This Skill

**User says:**

- "Sync my Google Business listing with my site"
- "Does my Google listing match my website?"
- "My GBP address is wrong, fix it"
- "Update my Google listing's phone number"

**Do NOT use for:** showing/embedding Google reviews (use `google-reviews`).

---

## Flow

### Step 1: Check connection and handle OAuth

Call `google-business-profile-sync__checkConnection()` to verify a Google Business Profile is connected.

**Possible outcomes:**

- **Connected** (`connected: true`) → Proceed to the sync flow (subsequent steps).
- **Not connected** (`action: 'requiresConnection'`) → Load the social-platform skill, then connect:
  ```typescript
  skill({ action: 'load', skill: 'social-platform' })
  ```
  Then call socialConnect (now active):
  ```typescript
  social-platform__socialConnect({ platform: 'GOOGLE_BUSINESS_PROFILE' })
  ```
  Then **stay silent** and let the UI handle OAuth. Wait for the user to confirm completion, then call `checkConnection` again.
- **Error** (`error: string`) → Relay the error to the user and suggest retry.

> **Why load social-platform first:** Skill tools are only exposed via `activeTools` for loaded skills. Since google-business-profile-sync doesn't declare social-platform as a skill-dep, you must explicitly load it to activate `social-platform__socialConnect`.

**State tracking:** This tool always updates workflow state (even on errors), so if OAuth is interrupted or times out, the agent can resume from this step on the next turn.

### Step 2: Resume after OAuth (automatic)

**On skill load, always check `current_state` in the applied_skills context.** If state exists, resume from the recorded step instead of starting over.

| State | Next Step | Action |
|-------|-----------|--------|
| `pending-gbp-connection` | `check-connection` | User was connecting GBP → re-run `checkConnection` to confirm it now exists |
| `connection-check-failed` | `retry-connection-check` | Previous check failed → retry `checkConnection` |
| `connected` | `sync-flow` | Connection verified → proceed to the sync flow |

---

## Sync Flow

Once connected, run the read → diff → sync sequence. Tools are `google-business-profile-sync__<tool>`.

### Step 3: Read the listing

`getGbpProfile()` — reads the connected listing (name, address, phone, hours, website, description). Two passes: the first returns a signal and the UI fetches the listing; **call it again** to get the profile from the context attachment. If the account has multiple locations the first is used — **name the chosen location in your next message** (e.g. *"…for your listing 'Acme Plumbing — Phoenix'"*) so the user can catch a wrong one.

### Step 4: Diff

Call **`diffBusinessInfo()` with NO arguments.** It reads the site itself and uses the GBP listing just loaded by `getGbpProfile`, so you do **not** pass `gbp`/`site` — do **not** hand it the prior tool outputs. It returns `{ fields, mismatches }`; each record is `{ field, gbp, site, equivalent, strategy, presence, rationale? }`.

- `diffBusinessInfo` is THE tool for "is my site in sync / what's different". (Do not use `verifySiteSync` for that — that's only for confirming a gbp-to-site edit afterward.)
- `getSiteBusinessInfo()` is optional — only call it if the user wants to see their site's values on their own; the diff does not need it.
- If diff returns an error that the listing isn't loaded, call `getGbpProfile` first, then `diffBusinessInfo` again. If it errors that there's no preview/published site, tell the user you need the preview running or the site published.
- The **website** field is only included when the site is on a real custom domain — don't surface it otherwise.
- **`presence`** tells you the mismatch kind: `'both'` = both sides have a value that differs; `'gbp-only'` = the listing has it but the site doesn't (offer to add it to the site); `'site-only'` = the site has it but the listing doesn't (offer to add it to GBP). Present these as actionable ("Google has your hours but your site doesn't — add them?").
- A site with **no business info at all** isn't an error — every GBP field comes back as `'gbp-only'`. Treat that as "your site doesn't show your business info yet — want me to add your name, address, phone, and hours from Google?" and offer to populate the site (gbp-to-site).
- Present the **mismatches** in chat, quoting both values per field. Then ask, per field: *update the site, update GBP, or skip?* — or offer the shortcuts **"fix all using GBP"** / **"fix all using the site"**.
- If `mismatches` is empty, tell the user everything already matches and stop.

### Step 5: Apply each approved sync

For every field the user chose (no second confirmation after a "fix all"):

> **Sync each field exactly once, in exactly one direction.** Pick the direction from what the user approved (push the site value to GBP, or pull the GBP value to the site) and call `syncField` once for it. Never call `syncField` for the same field in both directions — that just overwrites the first sync and confuses the result.

**Update the SITE from GBP** (`direction: 'gbp-to-site'`):
```typescript
syncField({ field, direction: 'gbp-to-site', value: <gbp value>, previousValue: <current site value> })
```
- `value`/`previousValue` are display strings (for address/hours, format the GBP value as the text the site shows). It edits **every** source file holding `previousValue` (a literal replace).
- **`noChange: true`** → the site already matches; report "already in sync" and move on (no verify needed).
- **`needsConfirmation: true`** → the replace would be **wide** (`matchedFiles`/`occurrences` are large), so it did **NOT** edit anything yet — likely a generic value that also matches metadata/alt-text/comments. Show the user `matchedFiles` + `occurrences` and ask them to confirm. Only on approval, call again with **`apply: true`** to actually make the edit. If they decline, skip the field.
- Otherwise it edited: report the `editedFiles` + `occurrences` ("updated the phone in 2 files").
- After a real edit, verify it propagated:
  ```typescript
  verifySiteSync({ field, expectedValue: <gbp value>, previousValue: <old site value> })
  ```
  `ok: true` → done. `ok: false` with `leftoverFiles` → tell the user which files still show the old value and offer a second pass.

**Update GBP from the site** (`direction: 'site-to-gbp'`):
```typescript
syncField({ field, direction: 'site-to-gbp', value: <site value> })
```
- `value` is a string for name/phone/website. For **address** pass a `storefrontAddress` object using GBP (google.type.PostalAddress) field names:
  ```json
  { "addressLines": ["560 Sutter St"], "locality": "San Francisco", "administrativeArea": "CA", "postalCode": "94102", "regionCode": "US" }
  ```
  `regionCode` is a CLDR country code (`"US"`, not `"United States"`); `administrativeArea` is the state/province code (`"CA"`).
- For **hours** pass a `regularHours` object with a `periods` array; days are uppercase, times are 24-hour `{ hours, minutes }`:
  ```json
  { "periods": [ { "openDay": "MONDAY", "openTime": { "hours": 9, "minutes": 0 }, "closeDay": "MONDAY", "closeTime": { "hours": 17, "minutes": 0 } } ] }
  ```
  **`regularHours` is the COMPLETE weekly schedule — GBP replaces the whole week in one write.** Always include a period for **every open day**, not just the day you're changing. To change a single day (e.g. "update only Monday"), first read the current listing with `getGbpProfile`, modify that day, and resend **all** open days — any open day you leave out is marked **closed**. A day with no period is closed (that is how you intentionally close a day). The client tolerates input variants (day-keyed hours, schema.org `openingHoursSpecification`, `"9:00 AM"` strings) but the shape above is preferred.
- Two passes: the first returns a signal, the UI calls the GBP API; **call it again** to read the result. Surface any error (e.g. expired token → reconnect; "Could not map the address/hours…" → re-shape the value and retry).

### Step 6: Close out

Summarize what changed on each side. If you edited the site (`gbp-to-site`), remind the user: *"Your changes are live in your preview — publish to make them live for visitors."*

---

## Important Notes

- **No persistent mismatch state:** the listing and site are re-read fresh each session; nothing is cached between sessions beyond the GBP connection itself.
- **Multi-location:** if the connected account has multiple locations, the first is used. Always name the chosen location in chat so the user can spot a wrong listing.
- **State persistence:** Workflow state survives conversation summarization and OAuth interruptions. Always check `current_state` before starting a new workflow.

# AAB by-design behaviors — known non-bugs

Semantic memory for the investigator. **Curated, human-reviewed knowledge** of
Airo Builder (AAB) behaviors that *look like* defects in code or logs but are
working as intended. Consult this in phase-1 before classifying anything as a
bug, and in phase-2 before assigning a verdict.

Why this file exists: the develop-agent builds apps incrementally and the
platform emits expected lifecycle noise. Without this context an investigator
flags by-design behavior as bugs (false positives). This is the platform's
*conventions*, which neither the code graph (structure only) nor a single
conversation transcript (one case's intent) captures.

## How to use it

- An entry describes a **symptom**, the **by-design reality**, and the **signal
  that distinguishes a real bug** from the benign case.
- An entry is NOT a license to dismiss findings. If the "real bug" signal is
  present, report it. The entry tells you *which* signal to check, not to skip
  the check.
- Always cross-reference the **agent conversation** (`$CONVERSATIONS_PATH`):
  "the app is missing X" is only a bug if the customer asked for X. AAB builds
  on demand — absence of a not-yet-requested feature is expected.

## How to extend it (feedback loop)

This is a living doc, human-gated to prevent memory poisoning (one wrong
"fact" silently corrupts every future run). New entries come from confirmed
false positives:

1. An operator marks an investigation finding a false positive in the console
   (or the verifier flags an over-claim). That candidate lesson lands in the
   S3 lessons inbox (`lessons/` prefix).
2. `scripts/investigate-distill-lessons.mjs` reads the inbox, dedupes, and
   prints proposed entries in the schema below.
3. A human reviews and appends the entry here in a PR. Only merged entries
   ship — the agent never edits this file itself.

## Entry schema (keep entries in this exact shape)

```
### <short title>
- **Looks like:** <the symptom in code or logs>
- **Actually:** <the by-design behavior>
- **Real bug if:** <the signal that means it IS a defect>
- **Verdict:** by-design | customer-error | platform-bug-if-<condition>
- **Source:** <repo path(s) that prove the convention>
```

---

## Incremental builds & routing

The initial agent builds the **homepage only**; every other page is deferred
until the customer asks. "Missing page / unregistered route / link to a page
that 404s" is the *default expected state*, not a defect.

### Homepage built first, other pages on demand
- **Looks like:** Homepage links to `/about`, `/services`, `/schedule`, etc. but those routes are not in `src/routes.tsx`; clicking them hits the 404 page.
- **Actually:** The initial agent builds ONLY the homepage for the design preview; remaining pages are built later, only when the customer requests them.
- **Real bug if:** The conversation shows the customer explicitly asked for that page and the agent claimed to build it, yet the route/page is absent or broken. Or the homepage itself / the 404 page is broken.
- **Verdict:** by-design (unless the conversation shows the page was requested → then platform-bug / agent-bug)
- **Source:** `agents/src/prompts/initial/core.md` ("Build ONLY the homepage design", "Build homepage (index.tsx) LAST"); `agents/src/prompts/initial/design-system-homepage-build/auto-select.md` ("Remaining pages have placeholder routes — build them when the user asks").

### Routes require explicit registration (no filesystem auto-discovery)
- **Looks like:** A page file exists under `src/pages/` (or an API handler exists) but the route 404s.
- **Actually:** Nothing auto-discovers files. A working route needs BOTH the file AND a registration entry (`src/routes.tsx` for pages; `src/server/entry.ts` for API routes). A file without its registration line is the expected "not wired up yet" state.
- **Real bug if:** The route IS registered but the component/handler file is missing or throws.
- **Verdict:** by-design
- **Source:** `agents/src/prompts/develop/backend.md` ("Nothing auto-discovers these files - routes must be registered explicitly"; "there is no filesystem-based auto-discovery").

### New page missing from the sitemap
- **Looks like:** A page renders in the app but does not appear in `/sitemap.xml`.
- **Actually:** `src/lib/seo-routes.ts` is a manually-maintained, agent-editable registry of crawlable routes. A new page is only in the sitemap once added there — a pending addition, not a break.
- **Real bug if:** The route IS in `seo-routes.ts` but `/sitemap.xml` is broken/malformed.
- **Verdict:** by-design
- **Source:** `app-templates/v8/src/lib/seo-routes.ts` ("Agent-editable registry of publicly-crawlable routes").

### Blank/empty homepage in a brand-new app
- **Looks like:** A freshly created app shows a blank homepage.
- **Actually:** The v8 starter ships `src/pages/index.tsx` as an empty stub for the develop-agent to populate; before/while the agent builds, blank is the start state.
- **Real bug if:** The agent reported the homepage built (per the conversation) but it is still the empty stub.
- **Verdict:** by-design
- **Source:** `app-templates/v8/src/pages/index.tsx` (empty stub); `agents/src/prompts/initial/core.md` (homepage built last).

---

## Customer-facing limits & auth

These are working-as-intended limits, not platform defects. Classify as
`customer-error` unless the distinguishing signal points to a counting/lifecycle
defect.

### Publish limit reached (plan cap)
- **Looks like:** `paywall.eligibility.publish-limit-reached`, 403 on publish / `/api/auth/agent-token`, `currentCount === limit`.
- **Actually:** Per-plan app caps enforced by the paywall. Caps: Starter 1, Professional 10, Ultimate 50 (AiroPlus legacy 9). Hitting the cap is expected.
- **Real bug if:** The published count exceeds the cap, OR an app the customer never successfully published is counted. **Note:** the count is NOT a stored counter — `isPublishedApp` filters live variants for `variant === 'publish' && status === 'active'`. Failed/cancelled deploys never reach `status: 'active'`, so they CANNOT inflate the count. "10/10 but a deploy failed" is therefore still customer-error, not a counting bug. A genuine bug requires an *active* variant the customer didn't publish (lifecycle corruption / cross-tenant leak).
- **Verdict:** customer-error (platform-bug only if an active variant is mis-attributed)
- **Source:** `app/src/lib/publish-limit/index.ts` (`isPublishedApp` filters `status === 'active'`; plan caps); `app/src/lib/paywall/core.ts` (eligibility).

### Re-publishing an already-published app does not consume a slot
- **Looks like:** A user at their cap can still re-publish; the count doesn't change.
- **Actually:** Updating an already-published app is intentionally exempt from the cap.
- **Real bug if:** Re-publish is blocked for an app already in the published set.
- **Verdict:** by-design
- **Source:** `app/src/lib/publish-limit/index.ts` (re-publish exemption for `currentAppId` already published).

### Apps unpublished after subscription lapse
- **Looks like:** Previously live apps go offline (variant `status` → `inactive`) with no deploy action.
- **Actually:** On non-payment, apps auto-unpublish a few days after the renewal date; the chat shows a suspension banner with the date.
- **Real bug if:** Apps unpublish while the subscription is active / not suspended.
- **Verdict:** customer-error (billing)
- **Source:** `app/src/lib/paywall/shared.ts` (`DAYS_UNTIL_UNPUBLISH`); suspended-non-payment banner component.

### Expired token / not-entitled auth failures
- **Looks like:** 401/403 on authenticated routes (e.g. `/api/auth/agent-token`), SSO re-auth prompt on sensitive (level-3) ops.
- **Actually:** gd-auth enforces JWT expiry (stricter HBI window on level-3 ops); free/unentitled plans are denied by the paywall. Expected.
- **Real bug if:** A 403 is returned with NO paywall `reason` (paywall fail-closed on an internal error), or the agent was granted `canPublish=true` yet publish is later blocked.
- **Verdict:** customer-error (platform-bug if the reason is missing / permission is inconsistent)
- **Source:** `app/src/app/api/auth/agent-token/route.ts`; `app/src/lib/paywall/core.ts` (fail-closed); `app/CLAUDE.md` (tiered auth / level-3 routes).

### Budget / credits exhausted
- **Looks like:** LLM/agent calls fail with `BUDGET_EXCEEDED`.
- **Actually:** The customer hit their credit/grant limit. Expected; affects agent turns, not publishes.
- **Real bug if:** Budget reports exhausted while the grant balance is clearly positive.
- **Verdict:** customer-error
- **Source:** `packages/shared/src/grants/` (grant types / `BUDGET_EXCEEDED`).

---

## Expected lifecycle log noise

Startup/shutdown lines containing "error/warn/unknown/not found/skipping/does
not exist" that are normal. A line below is benign **only if the process stays
healthy and functionality is intact** afterward — confirm that, don't assume.

### First-start: missing `.git/config`
- **Looks like:** `startup.detection.first_start` with `.git/config` `exists: false`; sandbox "user-specified path does not exist, skipping path=/git-repo".
- **Actually:** On an app's first launch the git repo isn't initialized yet; the supervisor uses this exact signal to branch into first-start setup. The sandbox skips not-yet-present paths by design.
- **Real bug if:** A restart (not first-start) repeatedly reports first-start, or git operations fail *after* the repo should exist.
- **Verdict:** by-design
- **Source:** `dev-supervisor/cmd/dev-supervisor/main.go` (`detectStartupMode`); `dev-supervisor/cmd/airo-sandbox/sandbox_linux.go` (path skip).

### Sandbox: landlock unavailable / default path skipped
- **Looks like:** "landlock not available on this platform, executing without sandbox"; "skipping non-existent default path".
- **Actually:** Landlock is Linux-only (fallback on other platforms); default system paths vary by distro and missing ones are skipped. Sandbox still applies the paths that exist.
- **Real bug if:** "no system paths found, sandbox may be ineffective" (zero paths — real misconfig) in a production Linux container.
- **Verdict:** by-design (the zero-paths warning is the real signal)
- **Source:** `dev-supervisor/cmd/airo-sandbox/sandbox_fallback.go`, `sandbox_linux.go`.

### Optional services not started (SMTP / email gateway / JWS / status page)
- **Looks like:** "failed to start SMTP proxy", "failed to start email gateway", `jws.signing.load_failed`, `status_page.init_failed`.
- **Actually:** These are optional/feature-gated. In preview tasks SMTP/status are intentionally off (publish owns those); JWS signing is optional when no key is configured. Warn + continue.
- **Real bug if:** The same failure appears in a publish/production task where the feature IS expected, or the process exits because of it.
- **Verdict:** by-design (context-dependent — confirm preview vs publish)
- **Source:** `dev-supervisor/cmd/dev-supervisor/main.go` (optional SMTP/email/JWS/status init).

### Graceful-shutdown timeouts
- **Looks like:** "PID 1 shutdown timeout exceeded", "server shutdown timeout exceeded".
- **Actually:** Safety valves — the supervisor waits a grace period for children/in-flight requests, then force-stops. Expected under traffic or a slow child during normal teardown.
- **Real bug if:** Shutdown timeouts correlate with data loss or appear mid-run (not at teardown).
- **Verdict:** by-design
- **Source:** `dev-supervisor/cmd/dev-supervisor/main.go` (shutdown timeouts).

### Caught transient git / DB errors
- **Looks like:** `git-tool.pull.network-error` / `git-tool.push.network-error`; `database.recovery.probe_transient_error`.
- **Actually:** Transient errors are caught and surfaced for retry — git network blips are re-wrapped with context; DB recovery distinguishes transient (locked/EAGAIN) from corruption.
- **Real bug if:** The error is permanent/repeating (not transient) or DB recovery reports actual corruption.
- **Verdict:** by-design (transient); platform-bug-if-persistent
- **Source:** `agents/src/tools/git-tool.ts`; `agents/src/database/db-recovery.ts`.

### Publish script fallbacks (jq missing / invalid pre-extract config)
- **Looks like:** `[WARN] jq missing; defaulting to AAB path`, `[WARN] pre-extract .airo/config.json is not valid JSON; defaulting ...`, `[WARN] cleanup incomplete; stale files may remain`.
- **Actually:** Publish container scripts degrade gracefully — jq-optional PaaS detection, default config when absent, best-effort cleanup. Extraction/build proceeds.
- **Real bug if:** The publish ultimately fails (non-zero exit / app doesn't serve), not just warns.
- **Verdict:** by-design
- **Source:** `container-scripts/publish/common.sh`, `container-scripts/publish/paas-run.sh`.

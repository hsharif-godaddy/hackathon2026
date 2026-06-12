---
title: Smoke-test CDS ESM paywall migration against prod-equivalent CDN hash from local dev
date: 2026-05-08
category: developer-experience
module: paywall / CDS ESM migration
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "verifying a CDS/UPP bundle migration before prod deploy"
  - "local:test run needs to fetch real registry-served CDS ESM, not localhost:9000"
  - "clearing a stale cdsVersion=local override so the smoke test hits the real CDN"
  - "validating React 18/19 shim against a new UPP build"
  - "confirming prod-CDN hash rotation end-to-end"
tags:
  - cds-esm
  - upp
  - paywall
  - local-test
  - playwright
  - cdn-verification
  - nextjs-dev
related_components:
  - "app/src/app/[market]/develop/components/paywall/CdsEsmPreload.tsx"
  - "app/src/app/[market]/develop/components/paywall/cdsLoader.tsx"
  - "pnpm local:test"
  - "playwright-cli"
---

# Smoke-test CDS ESM paywall migration against prod-equivalent CDN hash from local dev

## Context

The default local dev flow cannot verify a CDS ESM migration against the bundle customers will actually load. The CDS version override is **opt-in**: `getVersionOverride()` in `app/src/app/[market]/develop/components/paywall/CdsEsmPreload.tsx` reads `localStorage.cdsVersion` (JSON keyed by component type) and a `?cdsVersion=<type>--<version>` query param. When `'local'` is selected, `buildEntryUrl()` swaps the registry hash URL for `http://localhost:9000/esm/...`. With no override set, the loader fetches the registry hash the environment's CDN serves.

> **History (was true through ~2026-05):** `app/src/app/[market]/layout.tsx` used to force-inject a `beforeInteractive` `<Script>` writing `localStorage.cdsVersion = {godaddyUnifiedPlansAndPricingLibraryEsm: 'local'}` in development, which re-fired on every navigation. That made the `Storage.setItem` intercept below necessary. Commit `1ab09911b` ("remove cdsVersion localStorage script, use query param") removed the force-write — the override is now read-only opt-in, so on a clean profile the loader already targets the real CDN. The intercept is only needed if a stale `cdsVersion=local` is lingering in localStorage from a prior session.

`GASKET_ENV=local.test` flips Gasket's API endpoints to test env (`CDS_API_BASE_URL=https://cds.api.int.test-godaddy.com`). The test-env CDS registry serves the same hash as prod (for example, `33dcd35.godaddyUnifiedPlansAndPricingLibraryEsm.es.js` on 2026-05-08), so `local:test` is a valid prod-equivalent smoke target as long as no `cdsVersion=local` override is active.

## Guidance

Run `local:test` normally. With a clean profile, no override fires and the loader fetches the real registry hash — skip straight to step 4. If a prior session left `cdsVersion=local` in localStorage (or you want to guarantee no override regardless of profile state), install a Playwright init script that clears the key and blocks future writes. `page.addInitScript` runs before every page script, so it wins on every reload and navigation within the session.

### 1. Confirm test and prod CDN serve the same hash

Before starting, verify the test CDN can stand in for prod:

```bash
curl -s 'https://cds.api.int.test-godaddy.com/v2/registry?componentTypes=godaddyUnifiedPlansAndPricingLibraryEsm' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['godaddyUnifiedPlansAndPricingLibraryEsm']['js'])"
# 33dcd35.godaddyUnifiedPlansAndPricingLibraryEsm.es.js

curl -s 'https://cds.api.int.godaddy.com/v2/registry?componentTypes=godaddyUnifiedPlansAndPricingLibraryEsm' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['godaddyUnifiedPlansAndPricingLibraryEsm']['js'])"
# 33dcd35.godaddyUnifiedPlansAndPricingLibraryEsm.es.js
```

If the hashes diverge, test CDN has not caught up to prod and the smoke test is not prod-equivalent.

### 2. Start local:test (separate terminals)

```bash
AWS_PROFILE=airobuild-dev-private-sso pnpm --filter website local:test
AWS_PROFILE=airobuild-dev-private-sso pnpm --filter @airo/agents local:test
```

Prerequisites:

- `/etc/hosts`: `127.0.0.1  airo-builder.test-godaddy.com`
- `aws sso login --profile airobuild-dev-private-sso` (for Switchboard flags)
- Ports 3000 / 4000 / 8443 / 443 free
- First app already created on the real test site (local:test cannot cold-start one)

### 3. (Only if a stale override lingers) Neutralize cdsVersion via init script

```bash
playwright-cli -s=mysession run-code "async page => {
  await page.addInitScript(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, v) {
      if (k === 'cdsVersion') return;
      return orig.call(this, k, v);
    };
    try { localStorage.removeItem('cdsVersion'); } catch(e){}
  });
}"
```

### 4. Navigate and reload to activate

```bash
playwright-cli -s=mysession goto https://airo-builder.test-godaddy.com/
playwright-cli -s=mysession reload
```

### 5. Verify the real registry hash is being used

```bash
playwright-cli -s=mysession eval "() => {
  const c = window.gasketData?.cds?.registry?.godaddyUnifiedPlansAndPricingLibraryEsm;
  return { js: c?.js, cdnBaseUrl: c?.cdnBaseUrl };
}"
```

Expected: `js` begins with a real hash (for example, `33dcd35.`), `cdnBaseUrl` is `blobby.test-wsimg.com` or `img6.wsimg.com`. If you see `local.` or `localhost:9000`, the override is still active — re-run step 3.

### 6. Exercise the component and check runtime state

```bash
playwright-cli -s=mysession click <upgrade-button-ref>
playwright-cli -s=mysession eval "() => ({
  shimLoaded: !!window.__CDS_ESM_SHIM_LOADED__,
  reactVersion: window.React?.version,
  libsCount: Object.keys(window.__CDS_ESM_LIBS__ || {}).length,
  importMapCount: Object.keys(window.__CDS_IMPORT_MAP__?.imports || {}).length,
  hasJsxRuntime: !!window.__CDS_IMPORT_MAP__?.imports?.['react/jsx-runtime']
})"
```

Expected: `shimLoaded: false` (native `import()` worked), `reactVersion` is the stable host React (`19.1.0`), libs and import map populated, `react/jsx-runtime` present.

### Positive signals

- Registry `js` filename carries a real hash, not `local.`
- No "A React Element from an older version of React was rendered" errors
- No `paywall.cds.error`, `paywall.cds.import.failed`, or `paywall.cds.internal-fallback.detected` analytics events
- `__CDS_ESM_SHIM_LOADED__` stays `false`
- Paywall renders plan cards with real pricing fetched from the offers API

### Accepted noise

- `Invalid eid syntax for 'upp.*_impression'` — UPP-internal analytics format warnings
- `csp.test-godaddy.com/eventbus/web ... 401` — test-env Customer Signals Platform auth, non-fatal

## Why This Matters

Skipping this leaves the migration untested against the artifact customers hit. `pnpm run dev` output against `localhost:9000` proves the shim path works in isolation; it does not prove the real CDN bundle loads under host React 19 with the production import map. React 18/19 shim regressions, missing import-map entries, and `warmCache` integration mismatches all hide behind a `cdsVersion=local` override.

The remaining trap is a **stale override**: `cdsVersion=local` persists in localStorage across sessions, so a profile that hit a local UPP dev server last week silently keeps pointing at `localhost:9000`. Verify the registry hash (step 5) before trusting any smoke run; if it shows `local.`, clear the key (step 3). The init-script clear is cheap and reversible — no app code modified, no server restart needed.

Once you know the pattern, re-verification on a new UPP build is roughly 30 seconds. Not knowing the pattern costs a full prod rollback.

## When to Apply

- Any CDS ESM migration (library swap, loader version bump)
- Any paywall-component change on the PR #3126+ architecture
- Verifying prod-CDN hash rotation (compare `js` field before and after)
- Validating the React 18/19 shim against a new UPP build
- Validating `warmCache` integration when loading from the cached module
- Any change to `getVersionOverride()` / `buildEntryUrl()` in `CdsEsmPreload.tsx`
- Before approving a CDS-related PR where the author only showed `pnpm run dev` output

## Examples

### PR #3126 smoke test, 2026-05-08

Goal: confirm the ESM migration loads the real test CDN bundle (hash `33dcd35`, which equals the prod hash after the #3046 merge) and the paywall renders without shim fallback.

Registry lookups confirmed test = prod ahead of time (see step 1). Ran steps 2–6. Verification outputs:

```json
// Step 5
{
  "js": "33dcd35.godaddyUnifiedPlansAndPricingLibraryEsm.es.js",
  "cdnBaseUrl": "https://blobby.test-wsimg.com/go/static/cds"
}

// Step 6
{
  "shimLoaded": false,
  "reactVersion": "19.1.0",
  "libsCount": 33,
  "importMapCount": 53,
  "hasJsxRuntime": true
}
```

HigherPlans modal rendered Starter / Professional / Ultimate cards with real pricing and yearly/monthly toggle. Credits modal rendered the 250-credit offer. Zero `paywall.cds.*` error events. Native `import()` succeeded first try — no retries, no shim fallback. Sign-off: the ESM path works against the prod-equivalent bundle.

### What was tried before (session history)

Session 8981ddf6 (2026-05-06) took the opposite approach: set `cdsVersion=local` via devtools to force the loader to fetch from a UPP dev server. That path failed first because the override persisted from a prior session and sent requests to `localhost:9000` with no dev server running, and again because the local UPP build was produced with pre-#269 `cds-cli@0.0.88` — five `@ux/*` transitive deps were missing from the import map. Rebuilding UPP with `cds-cli@0.0.91` (post-CDS #269) resolved the import map and the paywall rendered. That session verified the code path end-to-end but only against a local UPP build, not the CDN-served artifact.

The 2026-05-08 approach documented here inverts the technique: instead of pointing the loader at localhost, neutralize the override so the loader fetches the registry hash that prod serves. Use the earlier approach when iterating on UPP itself; use this approach when validating a migration's integration with what customers will hit.

## Related secondary learning: `gh pr edit` SAML failure on gdcorp-partners repos

Symptom when editing a PR title or body:

```
GraphQL: Resource protected by organization SAML enforcement.
You must grant your OAuth token access to this organization.
(repository.pullRequest.reviewRequests.nodes.N.requestedReviewer)
```

Occurs when the PR has a reviewer whose account data is SAML-gated (typically a deactivated or org-restricted account). `gh pr edit` prints an SSO URL but re-authorizing does not fix it — the failing field is a response-hydration read on `reviewRequests`, not a write permission — and the edit mutation does not complete.

Workaround: PATCH the REST endpoint directly. It only touches mutable PR fields and does not traverse `reviewRequests`.

```bash
BODY_FILE=$(mktemp)
cat > "$BODY_FILE" <<'EOF'
[PR body markdown]
EOF
node -e "const fs=require('fs'); const body=fs.readFileSync('$BODY_FILE','utf8'); fs.writeFileSync('/tmp/payload.json', JSON.stringify({body}));"
gh api -X PATCH /repos/gdcorp-partners/REPO/pulls/N --input /tmp/payload.json --jq '.html_url,.updated_at'
```

Confirmed as a clean bypass on PR #3126 (2026-05-08) after three `gh pr edit` attempts failed with the SAML error.

## Related

- [CDS ESM + React 19 compat shim guide](../best-practices/cds-esm-react19-compat-shims-2026-04-23.md) — the shim approach being verified
- [Next.js 16 vendored React canary root cause](../best-practices/nextjs16-vendored-react-canary-breaks-cds-upp.md)
- [Local-test with local agents override pattern](../workflow-issues/local-test-with-local-agents-2026-03-31.md) — adjacent "bypass a local-dev default" pattern
- PRs: gdcorp-partners/airo-app-builder#3126, gdcorp-im/unified-plans-and-pricing-library#3045, gdcorp-im/unified-plans-and-pricing-library#3046

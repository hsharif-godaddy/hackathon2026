---
title: Verify both flag states (and the actually-routed path) before claiming a flag-gated migration works
date: 2026-05-18
category: workflow-issues
module: paywall
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - Shipping a code-path migration behind a switchboard kill-switch flag
  - The flag has a "safe default" that routes to the legacy path
  - The new path can fail silently (no thrown exception, no failed network request, no visible error UI)
  - PR description includes a Verification section that claims the new path works
related_components:
  - authentication
  - tooling
tags:
  - switchboard
  - feature-flags
  - migration
  - verification
  - paywall
  - cds-esm
  - kill-switch
---

# Verify both flag states (and the actually-routed path) before claiming a flag-gated migration works

## Context

PR #3126 migrated the Airo Builder paywall from CDS UMD loading to CDS ESM. The migration was gated by `appbuilder-paywall-umd-fallback`, a switchboard kill-switch flag with default value `true` (route to UMD, the safe path). The PR description's Verification section reported: 53-entry import map populated, `__CDS_ESM_LIBS__` populated, modal rendered with plan cards, native `import()` succeeded. The migration shipped.

After deploy to test, the paywall still failed for anyone who tried to actually exercise the ESM path (by overriding the flag client-side). The migration had never been verified end-to-end. The Verification section was true at the level of "a paywall rendered," but the paywall that rendered was the UMD path, because the flag default routed everyone there.

The bug the verification missed: UPP's ESM bundle externalizes `@wsb/dify-lead-gen` as a bare specifier, the host's generated `deps-esm.js` did not include it, and the browser's ESM resolver fails with `TypeError: Failed to resolve module specifier "@wsb/dify-lead-gen"`. The failure is silent at the user-visible level (no thrown exception, no failed XHR, no error toast). `cds-loader`'s `MutationObserver` fires `internal-fallback-detected` after a 5 second debounce, `LoadingComponent={() => null}` renders nothing during that window, and the result looks like "the modal didn't open" rather than "the migration is broken."

This pattern (kill-switch with safe default, plus a silent failure mode in the new path, plus a verification report that conflates "a thing rendered" with "the migrated path rendered") will repeat. This doc captures the protocol that prevents it.

## Guidance

When verifying a flag-gated migration locally, do all four of these before declaring done:

1. **Print the actually-routed path.** Add a log line, debug overlay, or `__DEBUG_PATH__` global that the verifier reads in the browser, not just the flag value. The flag tells you the input; the routed path tells you the output. Containers with branching logic (e.g., `umdFallback ? CDS_TYPE_UMD : CDS_TYPE_ESM`) should expose which branch they took to runtime inspection.

2. **Exercise both flag states explicitly.** Verify with the flag at its safe default (legacy path), then with the flag flipped (new path). Capture the routed path for each. A verification report that doesn't name which flag value was active is incomplete.

3. **Read the console, not just the screen.** Silent module-resolution failures, debounced fallback detection, and error-boundary catches all rerouter the page to a "looks fine" state. Grep the console for the error categories the new path can produce: `Failed to resolve module specifier`, `cds-loader.error`, `paywall.cds.internal-fallback.detected`, `paywall.cds.preload.warmCache.failed`. Zero hits is part of the verification, not a side observation.

4. **State the flag value in the PR Verification section.** Write "Flag X = false (new path), modal rendered, console clean" rather than "modal rendered." A reader reproducing the verification needs to know the input that produced the output.

For switchboard flags specifically: a personal override on your shopper ID can mask the global default. Verify the global default is what you think before testing. Check via `https://switchboard.int.test-gdcorp.tools/airo-app-builder/<flag-name>`. If you have an override, the result you see is not what other users see.

For migrations where the new path can fail silently, also consider a pre-build static check that doesn't depend on a verifier remembering to flip flags. For the paywall ESM case, that check is: fetch the CDS bundle from the registry, regex out every `from "<bare>"` external, and assert each is in `deps-esm.js` or in the registry manifest's `dependencies`. Three lines of bash plus jq, runs in `prebuild`. Catches the class entirely.

## Why This Matters

Verification reports exist to make a claim that another engineer could reproduce. "Modal rendered" without a flag value is a sentence that anyone can satisfy by clicking a button. "Modal rendered with flag = false, ESM path active, console clean" is a falsifiable claim that pins down what was tested.

The cost of skipping this is not just the missed bug. It's that PR #3741 added `appbuilder-paywall-umd-fallback` as a *new* kill switch on top of the broken ESM path, which is a reasonable safety move but ships with the same verification trap baked in: the flag default routes to UMD, the safe default conceals whether ESM works, and the same gap repeats next time anyone changes the ESM stack. The kill-switch pattern needs the verification protocol in place to be honest about what it gates.

Silent failure modes amplify this. CDS ESM has multiple silent paths: `import()` resolution failures throw at evaluation time but the throw is caught by the loader's retry logic, the loader's `MutationObserver` debounces fallback detection by 5 seconds, and `LoadingComponent={() => null}` plus `renderErrorFallback` together produce a "modal didn't open" appearance from real failure. Without a discipline for reading the console, this stack of silencers makes "looks fine" indistinguishable from "broken." See `cds-esm-react19-compat-shims-2026-04-23.md` for an adjacent case where the lesson "configure before shimming" applies the same principle: the failure was silent, the verification was visual, the bug was in a layer the verifier wasn't looking at.

## When to Apply

- Any PR that introduces or modifies a switchboard flag with a "safe default" that routes to the legacy path
- Any migration where the new path can throw at module-resolution time, hit a debounced fallback, or render through an `ErrorBoundary` to null
- Any verification that claims a paywall, modal, dialog, or async-loaded UI works without naming the active flag state
- Any PR description Verification checkbox that is unchecked at merge time (PR #3126 had two such boxes; both should have been blocking)

## Examples

**PR #3126 verification (what shipped, problem-shaped):**

> Local `pnpm local:test` pointed at the test CDN. Both prod and test registries serve the same hash (`33dcd35`).
>
> - HigherPlans modal renders Starter / Professional / Ultimate cards, yearly/monthly toggle, real pricing.
> - Runtime state confirmed: host React `19.3.0-canary`, `__CDS_ESM_LIBS__` populated (33 libs), 53-entry import map with `react/jsx-runtime` + `react-dom`.
> - Native `import()` succeeded first try, no shim fallback, no retries.
> - Zero React 18/19 symbol mismatch errors.

What's missing: which flag value was active. The 53-entry import map is consistent with the ESM path having loaded *something* (the preload component imports the bundle for cache-warming regardless of flag state, and silently fails on `@wsb/dify-lead-gen` with `paywall.cds.preload.warmCache.failed`). The visible modal that rendered for the verifier was the UMD path because `appbuilder-paywall-umd-fallback` defaults to `true`.

**PR #3126 verification (what would have caught the bug):**

> Verified with `appbuilder-paywall-umd-fallback = false` (forced via `window.gasketData.switchboard[...] = false` before opening modal):
>
> - HigherPlansUpgradeContainer's `umdFallback` resolved to `false`, ComponentLoader received `loaderMode: 'esm'` and `type: 'godaddyUnifiedPlansAndPricingLibraryEsm'`.
> - Console grep `Failed to resolve module specifier`: 0 hits.
> - Console grep `paywall.cds.error` and `cds-loader.internal-fallback-detected`: 0 hits.
> - Modal rendered Starter / Professional / Ultimate cards.
>
> Verified with flag at default (`true`, UMD): same visible result, `umdFallback` resolved to `true`, ComponentLoader received UMD type. (Establishes that the legacy path still works as a kill-switch target.)

The protocol is: name the flag value, describe what you verified, prove the new path actually ran. The visible-rendering of *something* is not a substitute for either of the latter two.

**Switchboard flag inspection during verification:**

```js
// Run in the browser console on the test page before triggering the modal.
const flag = 'appbuilder-paywall-umd-fallback';
console.log({
  flagValue: window.gasketData?.switchboard?.[flag],
  flagType: typeof window.gasketData?.switchboard?.[flag],
  // For paywall specifically, also check what the container will receive:
  willRouteToEsm: !window.gasketData?.switchboard?.[flag],
});
```

To force the new path during local verification:

```js
window.gasketData.switchboard['appbuilder-paywall-umd-fallback'] = false;
// Then open the modal. The mutation lives only for the current page session
// and resets on every reload, so re-apply after any navigation.
```

**Pre-build static check (the structural prevention):**

A pre-build assertion that closes the verification gap entirely, since it doesn't rely on any verifier remembering to flip flags. For the CDS ESM case:

```bash
# In app/scripts/prebuild-validate-deps-esm.sh (or wired into prebuild)
# Fetch the live registry hash for the configured CDS environment.
HASH=$(curl -fsS "$CDS_API_BASE_URL/v2/registry?componentTypes=godaddyUnifiedPlansAndPricingLibraryEsm" \
  | jq -r '.godaddyUnifiedPlansAndPricingLibraryEsm.js' \
  | sed -E 's/^([a-f0-9]+)\..*/\1/')
BUNDLE_URL="https://blobby.test-wsimg.com/go/static/cds/esm/godaddyUnifiedPlansAndPricingLibraryEsm/${HASH}.godaddyUnifiedPlansAndPricingLibraryEsm.es.js"
# Externals from the bundle's import statements.
EXTERNALS=$(curl -fsS "$BUNDLE_URL" | head -c 200000 | grep -oE 'from "[^"]+"' | sort -u)
# Externals already covered by the host import map.
COVERED=$(jq -r '.dependencies | keys[]' "$CDS_API_BASE_URL/manifest-${HASH}.json" 2>/dev/null; \
  node -e "Object.keys(require('./cds/deps-esm.js').default).forEach(k => console.log(k))")
# Diff: externals not covered fail the build.
MISSING=$(comm -23 <(echo "$EXTERNALS" | sed 's/from "//; s/"$//' | sort) <(echo "$COVERED" | sort))
if [ -n "$MISSING" ]; then
  echo "CDS ESM bundle externalizes specifiers not covered by host import map:"
  echo "$MISSING"
  exit 1
fi
```

This would have failed the PR #3126 build the moment its `deps-esm.js` was generated against a registry whose bundle externalized `@wsb/dify-lead-gen`. The check costs one HTTP request per build and removes the verification protocol's reliance on human discipline. Treat the verification protocol as the floor, the static check as the ceiling.

## Related

- `docs/solutions/best-practices/cds-esm-react19-compat-shims-2026-04-23.md` (sibling pattern: silent module-eval-time failure in CDS ESM, fixed via configuration rather than runtime shimming. The "configure before shimming" lesson generalizes; this doc is the verification-side complement)
- `docs/solutions/developer-experience/smoke-test-cds-esm-against-prod-cdn-from-local-dev-2026-05-08.md` (technique for inverting `cdsVersion=local` overrides to verify against prod-equivalent CDN; same family of "default inversion silently changes what you're testing")
- `docs/solutions/best-practices/switchboard-jwt-config-transport-2026-04-15.md` (sibling case of switchboard flag default value silently filtering legitimate values; same class of bug pattern at a different layer)
- `docs/solutions/logic-errors/budget-service-enabled-without-subscription-id-2026-04-02.md` (sibling case: kill-switch flag resolves true but a dependency is undefined; caught only after deploy, not during verification)
- UPP PR #3074 (upstream fix that drops `@wsb/dify-lead-gen` from `hostProvided`, eliminating the need for hosts to resolve the bare specifier): https://github.com/gdcorp-im/unified-plans-and-pricing-library/pull/3074
- Airo Builder PR #3126 (the migration whose verification this doc retrospects): https://github.com/gdcorp-partners/airo-app-builder/pull/3126
- Airo Builder PR #3741 (introduced `appbuilder-paywall-umd-fallback` as a kill switch): https://github.com/gdcorp-partners/airo-app-builder/pull/3741

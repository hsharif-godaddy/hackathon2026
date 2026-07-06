import type { Page, APIRequestContext } from '@playwright/test';
import { loginIfNeeded } from './auth';
import { DEPLOYMENT_POLL_INTERVAL_MS, DEPLOYMENT_TIMEOUT_MS, MAX_TEST_APPS, TEST_APP_BUFFER } from './constants';
import { dismissOverlays } from './ui';

interface SiteInfo {
  id: string;
  name?: string;
  initial_prompt?: string;
  /** ISO8601 timestamp from GET /api/sites — used to find the oldest apps for eviction. */
  created_at?: string;
  /**
   * Published site URL from GET /api/sites. Present only once the app has
   * been published. Defaults to the Airo `*.ai` publish URL; overridden to a
   * custom/prefix domain when one is attached (see
   * `app/src/lib/control-plane/v2-control-plane-adapter.ts`). Used to verify
   * publish state without relying on ephemeral publish-success UI.
   */
  published_url?: string;
}

/**
 * Substring that every test-created app's `name` or `initial_prompt` carries
 * via `getSpecPrefix(...)` in `tests/helpers/constants.ts` — always
 * `[e2e:<spec>:<salt>]`. Used by the eviction guard to identify test-owned
 * apps so we never touch non-test apps in the same account.
 *
 * Note the trailing colon: pool apps use `[e2e-pool:<purpose>]`, which
 * does NOT contain `[e2e:`, so eviction and prefix-based cleanup helpers
 * automatically skip pool apps without special-casing.
 */
const E2E_PREFIX_MARKER = '[e2e:';

/**
 * Prefix for long-lived pool apps used by `develop-ui.spec.ts` and
 * `publish-and-domain.spec.ts` — see `tests/e2e/REFACTOR_PLAN.md` PR 4
 * design notes. Created by `tests/pool-setup/build-pool-apps.spec.ts`
 * (idempotent, run via the `bootstrap-pool` project), resolved once per run
 * by the `pool-resolve` setup project and read from the on-disk cache by
 * specs. The structural difference from `[e2e:` (no colon between `e2e` and `pool`)
 * is what makes eviction/cleanup helpers leave pool apps alone.
 */
const E2E_POOL_PREFIX = '[e2e-pool:';

export function getPoolPrefix(purpose: string): string {
  return `${E2E_POOL_PREFIX}${purpose}]`;
}

/**
 * Look up a pool app by purpose. Pool apps are pre-built once per env
 * (run `tests/scripts/pool-setup/build-pool-apps.spec.ts`) and reused
 * across runs to skip per-run AI generation / auto-publish costs. Throws
 * with a clear bootstrap-runner hint if no app matches the pool prefix.
 *
 * Caller must be authenticated — this helper does not handle SSO.
 */
/**
 * GET /api/sites, retrying on transient gateway failures. The test env's
 * sites endpoint intermittently returns 504 Gateway Time-out (and
 * occasionally 502/503); throwing on the first one made the pooled specs
 * brittle — especially at workers=4, where all four spec `beforeAll`s fire
 * this lookup near-simultaneously, a concurrent burst that's far more likely
 * to hit a slow/timing-out backend than the staggered workers=1 calls.
 *
 * Retries ride out brief blips (the 504 flickers on a minutes scale). Two
 * transient modes are handled: a returned 5xx/gateway status, AND a *hung*
 * request that never responds — the latter is aborted per-attempt via an
 * AbortController (status 0) so it doesn't block page.evaluate until the
 * test timeout. A 4xx (e.g. 401 auth) won't fix with retry, so we surface it
 * immediately. Throws after the last attempt with the final status + body.
 * Caller must be authenticated and on the app host (the fetch is a
 * same-origin relative URL).
 */
async function fetchSitesWithRetry(
  page: Page,
  opts: {
    attempts?: number;
    backoffMs?: number;
    maxBackoffMs?: number;
    perAttemptTimeoutMs?: number;
  } = {},
): Promise<SiteInfo[]> {
  const attempts: number = opts.attempts ?? 5;
  const backoffMs: number = opts.backoffMs ?? 2000;
  const maxBackoffMs: number = opts.maxBackoffMs ?? 15000;
  const perAttemptTimeoutMs: number = opts.perAttemptTimeoutMs ?? 12000;

  let lastStatus = 0;
  let lastBody = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result: { ok: boolean; status: number; body: string } = await page.evaluate(
      async (timeoutMs) => {
        // Abort a hung request so it's a catchable error (status 0 → retried)
        // rather than blocking until the enclosing test's timeout.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch('/api/sites', { signal: controller.signal });
          return { ok: response.ok, status: response.status, body: await response.text() };
        } catch (err) {
          // Network failure / abort (hang) / connection reset — status 0, transient.
          return { ok: false, status: 0, body: String(err) };
        } finally {
          clearTimeout(timer);
        }
      },
      perAttemptTimeoutMs,
    );

    if (result.ok) {
      try {
        const sites: unknown = JSON.parse(result.body);
        if (Array.isArray(sites)) return sites as SiteInfo[];
        lastStatus = result.status;
        lastBody = 'response was not an array';
      } catch {
        lastStatus = result.status;
        lastBody = `non-JSON response: ${result.body.slice(0, 200)}`;
      }
    } else {
      lastStatus = result.status;
      lastBody = result.body;
      // Only 5xx / gateway timeouts (and network-level status 0) are transient.
      // 4xx (auth, bad request) won't change on retry — fail fast.
      const transient: boolean = result.status === 0 || result.status >= 500;
      if (!transient) break;
    }

    if (attempt < attempts - 1) {
      const delay: number = Math.min(backoffMs * 2 ** attempt, maxBackoffMs);
      console.log(
        `  GET /api/sites attempt ${attempt + 1}/${attempts} failed ` +
          `(HTTP ${lastStatus}); retrying in ${Math.round(delay / 1000)}s`,
      );
      await page.waitForTimeout(delay);
    }
  }

  throw new Error(
    `GET /api/sites failed after ${attempts} attempt(s): HTTP ${lastStatus} — ` +
      `${String(lastBody).slice(0, 500)}`,
  );
}

/**
 * Look up a pool app id, returning null ONLY when GET /api/sites was reached
 * successfully and no app matches the prefix — i.e. the pool is *confirmed
 * absent*. A transient /api/sites failure throws (propagated from
 * fetchSitesWithRetry) rather than masquerading as "absent".
 *
 * This distinction is what lets `bootstrap-pool` avoid minting a DUPLICATE
 * pool app when it merely couldn't verify existence: a `.catch(() => null)`
 * around the old throw-on-everything `getPoolAppId` treated a flaky /api/sites
 * (504/hang) as "doesn't exist" and created a fresh app — the root cause of
 * the duplicate `[e2e-pool:*]` apps observed while the test env was flapping.
 *
 * When multiple apps match, picks the first deterministically (sorted by id)
 * and warns — selection must not depend on /api/sites row order.
 */
export async function findPoolAppId(page: Page, purpose: string): Promise<string | null> {
  const prefix = getPoolPrefix(purpose);

  const sites = await fetchSitesWithRetry(page);
  const matches = sites.filter((site) => {
    const haystack = [site.name, site.initial_prompt].filter(Boolean).join(' ');
    return haystack.includes(prefix);
  });

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    // Duplicates make selection nondeterministic. Pick the first
    // deterministically (sorted by id) and warn loudly so the extras get
    // cleaned up — bootstrap-pool's "already exists → return" also only ever
    // checks the first match, so a stray duplicate can otherwise linger.
    const ids = matches.map((m) => m.id).sort();
    console.warn(
      `⚠️ ${matches.length} pool apps match prefix "${prefix}" (${ids.join(', ')}); ` +
        `using ${ids[0]}. Delete the extras from /apps to avoid nondeterminism.`,
    );
    return ids[0];
  }
  return matches[0].id;
}

/**
 * Like findPoolAppId but throws a clear "run bootstrap-pool" hint when the
 * pool app is confirmed absent. Used by specs / pool-resolve where a missing
 * pool app is a hard error. A transient /api/sites failure also throws (from
 * fetchSitesWithRetry) — callers must NOT swallow that into "create a new one".
 */
export async function getPoolAppId(page: Page, purpose: string): Promise<string> {
  const id = await findPoolAppId(page, purpose);
  if (!id) {
    const prefix = getPoolPrefix(purpose);
    throw new Error(
      `Pool app not found for purpose "${purpose}" (prefix "${prefix}"). ` +
        `Run \`pnpm exec playwright test --project=bootstrap-pool --env=<env>\` ` +
        `to create it. See tests/e2e/REFACTOR_PLAN.md PR 4 design notes.`,
    );
  }
  return id;
}

/**
 * Fetch an app's `published_url` from GET /api/sites. Returns null when the
 * app isn't found or has no published_url (i.e. not published). This is the
 * persistent, server-derived publish signal — unlike the ephemeral
 * publish-success modal/growl, it survives a fresh page load and isn't
 * subject to AI-narration variance.
 *
 * Caller must be authenticated. Works from any page on the app host (the
 * fetch is a same-origin relative URL).
 */
export async function getPublishedUrl(page: Page, appId: string): Promise<string | null> {
  // Shares the transient-504 retry with getPoolAppId — see fetchSitesWithRetry.
  const sites = await fetchSitesWithRetry(page);
  const site = sites.find((s) => s.id === appId);
  return site?.published_url ?? null;
}

/**
 * Poll GET /api/sites until the app's `published_url` is present, returning
 * it. Used by the pool bootstrap to confirm a TRUE published state before
 * caching the pool app — the ephemeral publish-success indicator can fire
 * (or be matched) without the deploy having actually landed, which would
 * otherwise cache a non-published app. Throws on timeout.
 */
export async function waitForPublishedUrl(
  page: Page,
  appId: string,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEPLOYMENT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEPLOYMENT_POLL_INTERVAL_MS;
  const startedAt = Date.now();

  while (true) {
    const publishedUrl = await getPublishedUrl(page, appId);
    if (publishedUrl) return publishedUrl;

    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) {
      throw new Error(
        `waitForPublishedUrl(${appId}) timed out after ${Math.round(elapsed / 1000)}s — ` +
          `app has no published_url, so the publish did not land. Do NOT cache this as a ` +
          `pool app; re-run bootstrap-pool.`,
      );
    }
    await page.waitForTimeout(pollIntervalMs);
  }
}

/**
 * Length of a real V2 app ID (nanoId format). Job IDs are shorter (~7
 * chars). Used by `waitForJobResolution` to detect when a quick-create
 * job has resolved to a real app. Must match APP_ID_LENGTH in
 * `app/src/lib/control-plane/v2-control-plane-adapter.ts`.
 */
const APP_ID_LENGTH = 10;

/** Default poll interval for `waitForJobResolution`. Matches the front-end's `useSiteCreationStore.pollingIntervalMs`. */
const JOB_RESOLUTION_POLL_INTERVAL_MS = 5000;

/** Default timeout for `waitForJobResolution`. Typical job→app transition is <30s; 2 min gives generous headroom for slow dev/test env. */
const JOB_RESOLUTION_TIMEOUT_MS = 120_000;

/**
 * Eviction grace window. The app-limit guard never evicts an app created within
 * this many ms — it may be an in-flight app a sibling shard (or this run) just
 * created and is mid-test on. The guard runs across all 10 parallel regression
 * shards against ONE shared account, so without this an eviction near the cap
 * could delete another shard's working app. Comfortably longer than the longest
 * single test so an in-flight app is always protected; old orphans (the real
 * eviction target) are well outside it.
 */
const RECENT_APP_GRACE_MS = 20 * 60 * 1000;

interface DeploymentPollResult {
  success: boolean;
  deploymentId: string;
  status: string;
}

/**
 * Poll `GET /api/sites?site_id=<jobId>` until the response's `id` flips
 * from the short job ID (~7 chars) to a real V2 app ID (`APP_ID_LENGTH`
 * chars) — i.e. the moment mgmt-airo finishes provisioning and binds the
 * job to a site row. Returns the resolved app ID.
 *
 * Contract source: `app/src/lib/control-plane/v2-control-plane-adapter.ts`
 * `jobIdLookup` returns a SiteInfo whose `id` carries the job ID until the
 * provision completes, then flips to the real app ID. The front-end uses
 * the same length-based detection in `useSiteCreationStore.ts`
 * (`finalSiteData.id.length <= 8` → still a job).
 *
 * Throws on timeout or non-200 — callers should not catch and retry; a
 * stuck job is a real failure worth surfacing.
 */
export async function waitForJobResolution(
  page: Page,
  jobId: string,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? JOB_RESOLUTION_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? JOB_RESOLUTION_POLL_INTERVAL_MS;
  const startedAt = Date.now();

  while (true) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) {
      throw new Error(
        `waitForJobResolution(${jobId}) timed out after ${Math.round(elapsed / 1000)}s ` +
        `waiting for job→app resolution (still job-shaped ID).`,
      );
    }

    const result = await page.evaluate(async (id) => {
      const response = await fetch(`/api/sites?site_id=${encodeURIComponent(id)}`);
      const body = await response.text();
      return { ok: response.ok, status: response.status, body };
    }, jobId);

    if (!result.ok) {
      throw new Error(
        `waitForJobResolution(${jobId}) failed: HTTP ${result.status} — ${result.body.slice(0, 500)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      throw new Error(
        `waitForJobResolution(${jobId}) returned non-JSON body: ${result.body.slice(0, 200)}`,
      );
    }

    const siteInfo = parsed as { id?: unknown };
    const currentId = typeof siteInfo.id === 'string' ? siteInfo.id : '';

    if (currentId.length === APP_ID_LENGTH) {
      console.log(
        `✓ Job ${jobId} resolved to app ${currentId} after ${Math.round(elapsed / 1000)}s`,
      );
      return currentId;
    }

    await page.waitForTimeout(pollIntervalMs);
  }
}

/**
 * Create a site via `POST /api/sites/quick-create` (BFF source:
 * `app/src/app/api/sites/quick-create/route.ts`) and return the real app
 * ID, polling job→app resolution if the BFF returns `type: 'job'`.
 *
 * Used by e2e specs that don't exercise the create UI — they need a
 * fresh app to drive develop/chat/publish flows without paying the cost
 * of clicking through the home-page create card every time.
 *
 * The `prompt` should be salted with `getSpecPrefix(...)` from
 * `tests/helpers/constants.ts` so the eviction guard and prefix-based
 * cleanup can identify and reclaim the app.
 */
export async function createSiteViaApi(page: Page, prompt: string): Promise<string> {
  const result = await page.evaluate(async (p) => {
    const response = await fetch('/api/sites/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: p }),
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  }, prompt);

  if (!result.ok) {
    throw new Error(
      `createSiteViaApi failed: HTTP ${result.status} — ${result.body.slice(0, 500)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body);
  } catch {
    throw new Error(
      `createSiteViaApi returned non-JSON body: ${result.body.slice(0, 200)}`,
    );
  }

  const data = parsed as { id?: unknown; type?: unknown };
  if (typeof data.id !== 'string' || !data.id) {
    throw new Error(
      `createSiteViaApi response missing 'id': ${result.body.slice(0, 200)}`,
    );
  }

  if (data.type === 'job') {
    return waitForJobResolution(page, data.id);
  }

  if (data.type === 'site') {
    console.log(`✓ Created app ${data.id} (immediate site)`);
    return data.id;
  }

  throw new Error(
    `createSiteViaApi response has unexpected type='${String(data.type)}': ${result.body.slice(0, 200)}`,
  );
}

/**
 * Delete an app by ID via the API. Throws on any failure so afterEach
 * cleanup surfaces real auth/network errors instead of silently swallowing
 * them — a swallowed delete leaves orphans that accumulate toward the
 * MAX_TEST_APPS cap and break future runs.
 *
 * BFF contract: `DELETE /api/sites/[id]` returns `{ success: true, message }`
 * on success (see `app/src/app/api/sites/[id]/route.ts`).
 */
export async function deleteApp(page: Page, appId: string): Promise<void> {
  if (!appId) throw new Error('deleteApp: appId is required');

  const result = await page.evaluate(async (id) => {
    const response = await fetch(`/api/sites/${id}`, { method: 'DELETE' });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  }, appId);

  if (!result.ok) {
    throw new Error(
      `deleteApp(${appId}) failed: HTTP ${result.status} — ${result.body.slice(0, 500)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body);
  } catch {
    throw new Error(
      `deleteApp(${appId}) returned 200 with non-JSON body: ${result.body.slice(0, 200)}`,
    );
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { success?: unknown }).success !== true
  ) {
    throw new Error(
      `deleteApp(${appId}) returned 200 but body did not signal success: ${result.body.slice(0, 200)}`,
    );
  }

  console.log(`✓ Deleted app: ${appId}`);
}

/**
 * Delete all apps matching a prefix. Best-effort: attempts every match, then
 * throws with a per-site summary if any DELETE failed (or if the GET listing
 * failed). Callers wrap this in try/catch so one prefix's failure doesn't
 * skip the rest, and the thrown message converts what used to be silent
 * orphan accumulation into a debuggable per-run error.
 */
export async function deleteAppsWithPrefix(page: Page, prefix: string): Promise<number> {
  const result = await page.evaluate(async (prefixValue) => {
    const response = await fetch('/api/sites');
    if (!response.ok) {
      const body = await response.text();
      return {
        listError: `GET /api/sites returned HTTP ${response.status}: ${body.slice(0, 200)}`,
      };
    }

    const parsed = await response.json() as unknown;
    if (!Array.isArray(parsed)) {
      return {
        listError: `GET /api/sites returned non-array body: ${JSON.stringify(parsed).slice(0, 200)}`,
      };
    }
    const sites = parsed as SiteInfo[];
    if (sites.length === 0) {
      return { deletedCount: 0, deleteErrors: [] as string[] };
    }

    const toDelete = sites.filter((site) => {
      const searchFields = [site.name, site.initial_prompt].filter(Boolean).join(' ');
      return searchFields.includes(prefixValue);
    });

    let deletedCount = 0;
    const deleteErrors: string[] = [];
    for (const site of toDelete) {
      const deleteResponse = await fetch(`/api/sites/${site.id}`, { method: 'DELETE' });
      if (deleteResponse.ok) {
        deletedCount++;
      } else {
        const body = await deleteResponse.text();
        deleteErrors.push(`${site.id}: HTTP ${deleteResponse.status} — ${body.slice(0, 200)}`);
      }
    }

    return { deletedCount, deleteErrors };
  }, prefix);

  if ('listError' in result) {
    throw new Error(`deleteAppsWithPrefix('${prefix}') failed to list sites: ${result.listError}`);
  }

  const { deletedCount, deleteErrors } = result;
  if (deletedCount > 0) {
    console.log(`Deleted ${deletedCount} app(s) with prefix: ${prefix}`);
  } else if (deleteErrors.length === 0) {
    // Log the zero case so a mistyped SPEC_PREFIXES entry is distinguishable
    // from "cleanup ran and matched nothing" when investigating orphans.
    console.log(`No apps matched prefix: ${prefix}`);
  }

  if (deleteErrors.length > 0) {
    throw new Error(
      `deleteAppsWithPrefix('${prefix}'): ${deleteErrors.length} delete(s) failed ` +
      `(${deletedCount} succeeded). Failures: ${deleteErrors.join('; ')}`,
    );
  }

  return deletedCount;
}

/**
 * Pre-flight guard for the mgmt-airo "Maximum N apps per system" cap. If the
 * test account has accumulated e2e-tagged apps close to that hard cap, evict
 * the oldest e2e apps so this run has room to create new ones. Compensates
 * for prior cleanup failures (test crashes, network blips in afterEach) that
 * leave orphans behind across runs — without this, accumulated orphans
 * eventually trip APP_LIMIT_EXCEEDED and break every future run.
 *
 * Only apps whose `name` or `initial_prompt` contains `[e2e:` are eligible —
 * non-test apps in the account are never touched. Sorted by `created_at`
 * ascending so the oldest go first.
 *
 * Trigger: total sites visible to this JWT >= (MAX_TEST_APPS - TEST_APP_BUFFER).
 * On trigger we delete enough oldest e2e apps to land at threshold - 1.
 *
 * No-op (returns 0) when below the threshold or when the GET fails — better
 * to let the test surface the real auth/network error than swallow it here.
 *
 * Authenticates first: reading /api/sites and issuing DELETEs both require a
 * signed-in session. Callers invoke this from `beforeEach` immediately after a
 * fresh `page.goto('/')`, where the browser profile is clean and no SSO has run
 * yet — so without logging in here, /api/sites returns 401, the guard no-ops,
 * and orphaned e2e apps accumulate every run until the account trips the
 * mgmt-airo cap and app creation starts failing. `loginIfNeeded` is idempotent
 * (a fast no-op when already signed in), so this is safe for already-authed
 * callers too.
 */
export async function evictOldestE2eAppsToFitLimit(
  page: Page,
  opts: { threshold?: number } = {},
): Promise<number> {
  const threshold = opts.threshold ?? (MAX_TEST_APPS - TEST_APP_BUFFER);

  // Ensure an authenticated session before touching /api/sites. dismissOverlays
  // clears the Projects popover that can otherwise cover the user-menu trigger
  // loginIfNeeded clicks. A login failure leaves the guard a no-op (the test
  // body does its own login) rather than aborting the run, matching the
  // best-effort contract the call sites rely on via `.catch(() => {})`.
  try {
    await dismissOverlays(page);
    await loginIfNeeded(page);
    // loginIfNeeded's SSO redirect can leave the page on a post-login landing
    // URL; re-navigate so the /api/sites fetch below runs from a stable
    // app-origin page.
    await page.goto('/');
  } catch (err) {
    console.log(
      `⚠️ App-limit guard skipped: login failed (${err instanceof Error ? err.message : String(err)})`,
    );
    return 0;
  }

  const result = await page.evaluate(async ({ thresholdValue, marker, graceMs }) => {
    try {
      const response = await fetch('/api/sites');
      if (!response.ok) {
        return { evicted: 0, fetchError: `GET /api/sites returned ${response.status}` };
      }
      const sites = await response.json() as SiteInfo[];
      if (!Array.isArray(sites)) {
        return { evicted: 0, fetchError: 'GET /api/sites did not return an array' };
      }

      const total = sites.length;
      if (total < thresholdValue) {
        return { evicted: 0, total, e2eCount: 0, skipped: true };
      }

      const e2eApps = sites.filter((site) => {
        const haystack = [site.name, site.initial_prompt].filter(Boolean).join(' ');
        return haystack.includes(marker);
      });

      // Parse `created_at` to epoch ms. Missing or malformed timestamps
      // (Date.parse → NaN) become +Infinity so they sort to the end as
      // "newest unknown" and fall outside the eviction cutoff below — we never
      // evict an app whose age we cannot establish.
      const parseOrInf = (s: string | undefined): number => {
        if (!s) return Number.POSITIVE_INFINITY;
        const t = Date.parse(s);
        return isNaN(t) ? Number.POSITIVE_INFINITY : t;
      };

      // Recency guard: only genuinely old apps are eviction-eligible. An app
      // created within the grace window may be in-flight in a sibling shard (or
      // this run) — deleting it would break a running test. Sort the eligible
      // set oldest-first so we reclaim the stalest orphans first.
      const cutoff = Date.now() - graceMs;
      const evictable = e2eApps
        .filter((site) => parseOrInf(site.created_at) < cutoff)
        .sort((a, b) => parseOrInf(a.created_at) - parseOrInf(b.created_at));

      // Land at `threshold - 1` so the create call after this guard has room.
      const evictTarget = total - thresholdValue + 1;
      const toEvict = evictable.slice(0, evictTarget);

      let evicted = 0;
      const errors: string[] = [];
      for (const site of toEvict) {
        const deleteResponse = await fetch(`/api/sites/${site.id}`, { method: 'DELETE' });
        if (deleteResponse.ok) {
          evicted++;
        } else {
          errors.push(`${site.id}: ${deleteResponse.status}`);
        }
      }

      return {
        evicted,
        total,
        e2eCount: e2eApps.length,
        wanted: evictTarget,
        errors,
      };
    } catch (err) {
      return { evicted: 0, fetchError: String(err) };
    }
  }, { thresholdValue: threshold, marker: E2E_PREFIX_MARKER, graceMs: RECENT_APP_GRACE_MS });

  if ('fetchError' in result && result.fetchError) {
    console.log(`⚠️ App-limit guard skipped: ${result.fetchError}`);
    return 0;
  }
  if ('skipped' in result && result.skipped) {
    return 0;
  }
  const { evicted = 0, total = 0, e2eCount = 0, wanted = 0, errors = [] } = result;
  if (evicted < wanted) {
    console.log(
      `⚠️ App-limit guard: evicted ${evicted}/${wanted} oldest e2e apps ` +
      `(total=${total}, e2eCount=${e2eCount}, threshold=${threshold}). ` +
      `Recently-created apps are protected from eviction, so a shortfall here ` +
      `means too few old orphans to reclaim. Test may still hit APP_LIMIT_EXCEEDED.` +
      (errors.length > 0 ? ` Delete errors: ${errors.join('; ')}` : ''),
    );
  } else {
    console.log(
      `🧹 App-limit guard: evicted ${evicted} oldest e2e app(s) ` +
      `(total=${total}, e2eCount=${e2eCount}, threshold=${threshold})`,
    );
  }
  return evicted;
}

/**
 * Best-effort detach of a custom domain from an app via the domain-modify API.
 * Idempotency guard for the fixed, reused prod domain
 * (`e2e-prod.airotesting.shop`): a prior run that aborted after attaching but
 * before disconnecting leaves the domain owned by the app, which makes the
 * validation API return available=false and the Add button never enables.
 * Detaching first clears that stale state so the test's re-attach can proceed.
 *
 * Mirrors the UI's `executeDisconnectDomain` (DomainAttach.tsx): same route,
 * same `domainsToDelete: [{ fqdn }]` body. Never throws — if the domain isn't
 * attached, mgmt-airo returns a benign error we log and swallow, since a clean
 * pool (nothing to detach) is the common case and must not fail the test.
 *
 * Route source: `app/src/app/api/sites/[id]/domains/route.ts` (POST, level 3).
 * Caller must be authenticated and on the app host (same-origin fetch).
 */
export async function detachDomain(page: Page, appId: string, fqdn: string): Promise<void> {
  if (!appId || !fqdn) {
    console.log(`  detachDomain skipped: appId='${appId}' fqdn='${fqdn}'`);
    return;
  }

  const result: { ok: boolean; status: number; body: string } = await page.evaluate(
    async ({ id, domain }) => {
      try {
        const response = await fetch(`/api/sites/${id}/domains`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domainsToDelete: [{ fqdn: domain }] }),
        });
        return { ok: response.ok, status: response.status, body: await response.text() };
      } catch (err) {
        return { ok: false, status: 0, body: String(err) };
      }
    },
    { id: appId, domain: fqdn },
  );

  if (result.ok) {
    console.log(`  Idempotency: detached pre-existing '${fqdn}' from ${appId} (HTTP ${result.status})`);
  } else {
    console.log(
      `  Idempotency: no active detach for '${fqdn}' on ${appId} ` +
        `(HTTP ${result.status} — expected when nothing was attached): ${redactSecrets(result.body).slice(0, 200)}`,
    );
  }
}

/**
 * Strip sensitive auth values from a response body before it reaches CI logs.
 * `GET /api/sites/[id]` injects a live `?airoShareToken=<7-day preview-auth
 * credential>` into `preview_url` (see sites/[id]/route.ts), so logging the raw
 * body would publish a valid token to anyone who can read the job output.
 * Redacts the value of any `*token`/`auth`/`authorization` query param or JSON
 * field, case-insensitively (both regexes carry `i`, so `TOKEN`/`Authorization`
 * are caught too).
 */
function redactSecrets(body: string): string {
  return body
    .replace(/([?&][a-z]*token|[?&]authorization|[?&]auth)=([^&"\\\s]+)/gi, '$1=<redacted>')
    .replace(/("[a-z]*token"|"authorization"|"auth")(\s*:\s*")([^"]+)(")/gi, '$1$2<redacted>$4');
}

/**
 * Capture and log actionable backend state for the domain-row-not-visible
 * failure path in the custom-domain step. Purely diagnostic: it distinguishes a
 * real product break (attach accepted but the domain never lists / the job
 * stalls — an attach/list eventual-consistency bug) from stale test state.
 *
 * Reads, all same-origin and authed:
 *  - the domain-modify job status for the target FQDN
 *    (`GET /api/sites/[id]/domains/job?fqdn=`) — the reachable attach-API state;
 *  - the current domain-list state for the app
 *    (`GET /api/sites/[id]?includeCdn=true` → `domains[]`) — what the UI polls
 *    via useAppDetails/useDomainPolling.
 *
 * Logged bodies are passed through `redactSecrets` first — the list route
 * injects a live share token into `preview_url`.
 *
 * Never throws: every fetch is wrapped so a diagnostics failure can't mask or
 * replace the caller's original assertion error. Route sources:
 * `app/src/app/api/sites/[id]/domains/job/route.ts` and
 * `app/src/hooks/useAppDetails.ts` (`GET /api/sites/[id]?includeCdn=true`).
 */
export async function captureDomainEvidence(page: Page, appId: string, fqdn: string): Promise<void> {
  console.log(
    `  📋 Domain failure evidence — appId='${appId}' targetDomain='${fqdn}' pageUrl='${page.url()}'`,
  );

  const job: { status: number; body: string } = await page
    .evaluate(async ({ id, domain }) => {
      const response = await fetch(`/api/sites/${id}/domains/job?fqdn=${encodeURIComponent(domain)}`);
      return { status: response.status, body: await response.text() };
    }, { id: appId, domain: fqdn })
    .catch((err: unknown) => ({ status: 0, body: `evidence fetch threw: ${String(err)}` }));
  console.log(`  📋 domain-attach job (HTTP ${job.status}): ${redactSecrets(job.body).slice(0, 800)}`);

  const list: { status: number; body: string } = await page
    .evaluate(async (id) => {
      const response = await fetch(`/api/sites/${id}?includeCdn=true`);
      return { status: response.status, body: await response.text() };
    }, appId)
    .catch((err: unknown) => ({ status: 0, body: `evidence fetch threw: ${String(err)}` }));
  console.log(`  📋 domain-list state (HTTP ${list.status}): ${redactSecrets(list.body).slice(0, 800)}`);
}

/** Terminal deployment statuses that should stop polling */
const TERMINAL_STATUSES = ['deployed', 'failed', 'error', 'cancelled', 'canceled'];

/**
 * Poll deployment status until complete or timeout
 * Handles all terminal statuses to avoid infinite loops
 */
export async function pollDeploymentStatus(
  page: Page,
  appId: string,
  deploymentId: string,
  pollInterval = DEPLOYMENT_POLL_INTERVAL_MS,
  maxWaitTime = DEPLOYMENT_TIMEOUT_MS
): Promise<DeploymentPollResult> {
  const startTime = Date.now();

  while (true) {
    const elapsed = Date.now() - startTime;

    if (elapsed >= maxWaitTime) {
      console.log(`Deployment timeout after ${Math.round(elapsed / 1000)}s`);
      return { success: false, deploymentId, status: 'timeout' };
    }

    const result = await page.evaluate(async ({ appId: id, deploymentId: depId }) => {
      try {
        const response = await fetch(`/api/apps/${id}/deployments?limit=10&includeJobData=true`);
        if (!response.ok) {
          return { status: 'error', message: `API error: ${response.status}` };
        }

        const data = await response.json();
        const deployments = data.deployments || data || [];
        const deployment = deployments.find((d: { id: string }) => d.id === depId);

        if (!deployment) {
          return { status: 'not_found' };
        }

        return { status: deployment.status?.toLowerCase() || 'unknown' };
      } catch (err) {
        return { status: 'error', message: String(err) };
      }
    }, { appId, deploymentId });

    console.log(`Deployment status: ${result.status} (elapsed: ${Math.round(elapsed / 1000)}s)`);

    // Check for successful deployment
    if (result.status === 'deployed') {
      console.log(`Deployment successful after ${Math.round(elapsed / 1000)}s`);
      return { success: true, deploymentId, status: 'deployed' };
    }

    // Check for any terminal failure status
    if (TERMINAL_STATUSES.includes(result.status) && result.status !== 'deployed') {
      console.log(`Deployment ended with status '${result.status}' after ${Math.round(elapsed / 1000)}s`);
      return { success: false, deploymentId, status: result.status };
    }

    // For unknown statuses, log a warning but continue polling (up to timeout)
    if (!['pending', 'queued', 'running', 'in_progress', 'not_found'].includes(result.status)) {
      console.log(`Unknown deployment status '${result.status}', continuing to poll...`);
    }

    // Continue polling
    await page.waitForTimeout(pollInterval);
  }
}

/**
 * Clean up apps created by a specific spec
 */
export async function cleanupSpecApps(page: Page, specPrefix: string): Promise<void> {
  console.log(`🧹 Cleaning up apps with prefix: ${specPrefix}`);
  await deleteAppsWithPrefix(page, specPrefix);
}

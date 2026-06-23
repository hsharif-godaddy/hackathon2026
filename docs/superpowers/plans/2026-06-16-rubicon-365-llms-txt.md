# RUBICON-365 — llms.txt (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a spec-correct `/llms.txt` on every published Airo customer site, rendered live by an Express handler in the v8 template so it can never be the advertised-but-404 file we found in the wild.

**Architecture:** All rendering logic lives in one pure, directly-unit-testable module (`app-templates/v8/src/server/llms-txt.ts`) — `humanizeLabel`, `sanitizeMarkdown`, `renderLlmsTxt`, and the thin `llmsTxtHandler`. `entry.ts` only registers the handler (mirroring the existing `app.get("/api/health", healthGet)` extracted-handler pattern). A new tiny data module (`site-meta.ts`) holds the agent-authored business name + summary, because the RUBICON-343 `Organization` JSON-LD lives in React markup and is not server-readable. A short instruction in the cached create-time SEO primer tells the develop agent to seed `site-meta.ts`.

**Tech Stack:** TypeScript, Express 5, Vitest (no new dependencies — `supertest` is intentionally avoided; the handler is tested with a fake req/res, matching the repo's pure-function test convention in `seo-host.test.ts`).

**Spec:** `docs/superpowers/specs/2026-06-16-llms-txt-design.md`

---

## Key facts the implementer must know

- **v8 is NOT in the pnpm workspace** (`pnpm-workspace.yaml` line 19: `- '!app-templates/**'`) and ships no `node_modules`. You must install its deps locally before running anything:
  ```bash
  cd app-templates/v8 && npm install
  ```
- **CI for v8** (`.github/workflows/docker-build-v8-template.yml`) runs only `npm ci && npm run type-check` + a Docker build. It does **not** run vitest. The unit tests in this plan are for local verification and future regression safety (the same role `src/server/seo-host.test.ts` already plays).
- **Run commands** (all from `app-templates/v8/`):
  - One test file: `npx vitest run src/server/llms-txt.test.ts`
  - All tests: `npx vitest run`
  - Type check: `npm run type-check`
  - Lint: `npm run lint`
- **`npm test` runs vitest in watch mode** — always use `npx vitest run` for a one-shot pass in this plan.
- **Existing helpers in `entry.ts`**: `baseUrl(req)` returns `` `${req.protocol}://${req.hostname}` `` (entry.ts:50). The robots/sitemap handlers (entry.ts:60, :79) set `Cache-Control: public, max-age=60, must-revalidate` and `Vary: Host` via `.type(...).set(...).set(...)`. We mirror those headers exactly.
- **`isSystemHost(req)`** (`src/server/seo-host.ts`) returns `true` for `localhost`, empty/undefined host, and `*.airoapp.ai` / `*.test-airoapp.ai` / `*.dev-airoapp.ai` / `*.dev-godaddy.com`; `false` for customer-attached domains.
- **SYNC_MANIFEST (critical):** `container-scripts/preview/sync-template-files.js` holds `SYNC_MANIFEST`, the list of template files synced into existing customer apps. A pre-commit hook **blocks the commit** if a new `app-templates/v8/**` file is not registered. Rules learned from the existing entries:
  - **New files** (`site-meta.ts`, `llms-txt.ts`, `llms-txt.test.ts`) get an entry with `known_hashes: [], force: false` — created on first sync, never overwritten if the customer edited it. Test files ARE synced and need entries (see `seo-host.test.ts` at ~line 65). Task 1 already registered `site-meta.ts` (~line 108).
  - **Modified files** that are hash-gated (like `entry.ts`, ~line 77) only sync to a customer app whose copy matches a hash in `known_hashes`. So when we change `entry.ts`, we must append the MD5 of the **pre-change** version (`git show HEAD:app-templates/v8/src/server/entry.ts | md5`) to its `known_hashes`, or existing sites never receive the `/llms.txt` route. Procedure is documented at manifest lines 48–51.
- **`seoRoutes`** (`src/lib/seo-routes.ts`) is `SeoRoute[]`, default-seeded with `[{ path: "/", changefreq: "weekly", priority: 1.0 }]`, and kept in sync with `src/routes.tsx` by the RUBICON-98 post-edit handler. `SeoRoute` has `path`, `changefreq?`, `priority?`, `lastmod?` — no title/description.

---

## Task 1: Business-header data module (`site-meta.ts`)

**Files:**
- Create: `app-templates/v8/src/lib/site-meta.ts`

- [ ] **Step 1: Install v8 deps (once)**

Run:
```bash
cd app-templates/v8 && npm install
```
Expected: completes with `node_modules/` present (vitest, express, typescript available).

- [ ] **Step 2: Create the module**

Create `app-templates/v8/src/lib/site-meta.ts`:
```ts
/**
 * Agent-authored business identity for /llms.txt (RUBICON-365).
 *
 * The homepage Organization/WebSite JSON-LD that the develop agent writes
 * (RUBICON-343) lives inline in React markup and is NOT readable by the
 * server at request time, so the /llms.txt handler reads name + summary from
 * here instead. The develop agent seeds these at site creation; empty values
 * are the "unseeded / thin site" signal that the handler falls back on.
 */
export interface SiteMeta {
	/** Business name — rendered as the llms.txt H1. */
	name: string;
	/** One-line business summary — rendered as the llms.txt blockquote. */
	summary: string;
}

export const siteMeta: SiteMeta = {
	name: "",
	summary: "",
};
```

- [ ] **Step 3: Type check**

Run: `npm run type-check`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add app-templates/v8/src/lib/site-meta.ts
git commit -m "feat(v8): add site-meta module for llms.txt business header"
```

---

## Task 2: Pure rendering functions (`humanizeLabel`, `sanitizeMarkdown`, `renderLlmsTxt`)

**Files:**
- Create: `app-templates/v8/src/server/llms-txt.ts`
- Test: `app-templates/v8/src/server/llms-txt.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app-templates/v8/src/server/llms-txt.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { humanizeLabel, sanitizeMarkdown, renderLlmsTxt } from "./llms-txt";
import type { SeoRoute } from "../lib/seo-routes";

describe("humanizeLabel", () => {
	it("special-cases the homepage", () => {
		expect(humanizeLabel("/")).toBe("Home");
	});

	it("title-cases a single segment", () => {
		expect(humanizeLabel("/about")).toBe("About");
	});

	it("splits hyphens and underscores into words", () => {
		expect(humanizeLabel("/contact-us")).toBe("Contact Us");
		expect(humanizeLabel("/our_team")).toBe("Our Team");
	});

	it("uses the last segment of a nested path", () => {
		expect(humanizeLabel("/blog/my-post")).toBe("My Post");
	});

	it("ignores a trailing slash", () => {
		expect(humanizeLabel("/services/")).toBe("Services");
	});
});

describe("sanitizeMarkdown", () => {
	it("leaves ordinary business text untouched", () => {
		expect(sanitizeMarkdown("Mary's Cleaning Co.")).toBe("Mary's Cleaning Co.");
	});

	it("escapes link-breaking and code characters", () => {
		expect(sanitizeMarkdown("Acme [Inc]")).toBe("Acme \\[Inc\\]");
		expect(sanitizeMarkdown("use `code` here")).toBe("use \\`code\\` here");
	});

	it("collapses newlines and runs of whitespace to single spaces", () => {
		expect(sanitizeMarkdown("line one\nline two")).toBe("line one line two");
		expect(sanitizeMarkdown("  spaced   out \t")).toBe("spaced out");
	});
});

describe("renderLlmsTxt", () => {
	const routes: SeoRoute[] = [
		{ path: "/", changefreq: "weekly", priority: 1.0 },
		{ path: "/about" },
	];

	it("renders H1, blockquote, and a Pages link list when seeded", () => {
		const out = renderLlmsTxt({
			baseUrl: "https://acme.com",
			hostname: "acme.com",
			name: "Acme",
			summary: "We sell quality desks",
			routes,
		});
		expect(out).toBe(
			"# Acme\n\n> We sell quality desks\n\n## Pages\n" +
				"- [Home](https://acme.com/)\n" +
				"- [About](https://acme.com/about)\n",
		);
	});

	it("falls back to the hostname H1 and omits the blockquote when unseeded", () => {
		const out = renderLlmsTxt({
			baseUrl: "https://acme.com",
			hostname: "acme.com",
			name: "",
			summary: "",
			routes: [{ path: "/" }],
		});
		expect(out).toBe("# acme.com\n\n## Pages\n- [Home](https://acme.com/)\n");
	});

	it("omits the Pages heading entirely when there are no routes", () => {
		const out = renderLlmsTxt({
			baseUrl: "https://acme.com",
			hostname: "acme.com",
			name: "Acme",
			summary: "Hi",
			routes: [],
		});
		expect(out).toBe("# Acme\n\n> Hi\n");
	});

	it("skips routes whose path does not start with a slash", () => {
		const out = renderLlmsTxt({
			baseUrl: "https://acme.com",
			hostname: "acme.com",
			name: "Acme",
			summary: "Hi",
			routes: [{ path: "/" }, { path: "mailto:x@y.com" } as SeoRoute],
		});
		expect(out).toBe("# Acme\n\n> Hi\n\n## Pages\n- [Home](https://acme.com/)\n");
	});

	it("sanitizes a name with markdown-significant characters", () => {
		const out = renderLlmsTxt({
			baseUrl: "https://acme.com",
			hostname: "acme.com",
			name: "Acme [Inc]",
			summary: "Line\nbreak",
			routes: [],
		});
		expect(out).toBe("# Acme \\[Inc\\]\n\n> Line break\n");
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/llms-txt.test.ts`
Expected: FAIL — `Failed to resolve import "./llms-txt"` / functions not defined.

- [ ] **Step 3: Implement the module**

Create `app-templates/v8/src/server/llms-txt.ts`:
```ts
import type { SeoRoute } from "../lib/seo-routes";

/**
 * Convert an SEO route path into a human-readable link label.
 *
 * Rule:
 *  - "/"            -> "Home" (special case)
 *  - otherwise      -> last path segment, split on "-"/"_", title-cased.
 *    e.g. "/about" -> "About", "/contact-us" -> "Contact Us",
 *    "/blog/my-post" -> "My Post".
 * seoRoutes paths are static route paths (no query strings/fragments), so
 * those are not handled.
 */
export function humanizeLabel(path: string): string {
	if (path === "/") return "Home";
	const segment = path.replace(/^\/+|\/+$/g, "").split("/").pop() ?? "";
	return segment
		.split(/[-_]/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/**
 * Make agent/customer-authored text safe to interpolate into markdown.
 * name/summary ultimately trace to customer-supplied business details, so
 * they may contain markdown-structural characters or newlines that would
 * break the H1, blockquote, or link syntax. We collapse newlines/whitespace
 * to single spaces (keeping H1 and blockquote single-line) and backslash-
 * escape the characters that break inline constructs (`\`, backtick, `[`,
 * `]`). Other characters (#, >, *, etc.) are not structural mid-line, so we
 * leave them to avoid mangling ordinary business names.
 */
export function sanitizeMarkdown(text: string): string {
	return text
		.replace(/[\r\n\t]+/g, " ")
		.replace(/[\\`[\]]/g, (c) => `\\${c}`)
		.replace(/ {2,}/g, " ")
		.trim();
}

export interface RenderLlmsTxtOptions {
	/** Absolute origin, e.g. "https://acme.com". */
	baseUrl: string;
	/** Bare hostname, e.g. "acme.com" — used for the H1 fallback. */
	hostname: string;
	/** Business name (may be empty when unseeded). */
	name: string;
	/** Business summary (may be empty when unseeded). */
	summary: string;
	/** Crawlable routes; the page list is built from these. */
	routes: SeoRoute[];
}

/**
 * Render the /llms.txt body. Pure: no request, no I/O. Always returns a
 * well-formed, single-trailing-newline markdown document.
 */
export function renderLlmsTxt(opts: RenderLlmsTxtOptions): string {
	const name = sanitizeMarkdown(opts.name);
	const summary = sanitizeMarkdown(opts.summary);

	const lines: string[] = [`# ${name || opts.hostname}`];

	if (summary) {
		lines.push("", `> ${summary}`);
	}

	const pageLinks = opts.routes
		.filter((r) => typeof r.path === "string" && r.path.startsWith("/"))
		.map(
			(r) =>
				`- [${sanitizeMarkdown(humanizeLabel(r.path))}](${opts.baseUrl}${r.path})`,
		);

	if (pageLinks.length > 0) {
		lines.push("", "## Pages", ...pageLinks);
	}

	return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/llms-txt.test.ts`
Expected: PASS (all `humanizeLabel`, `sanitizeMarkdown`, `renderLlmsTxt` tests green).

- [ ] **Step 5: Type check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 6: Register both new files in SYNC_MANIFEST**

In `container-scripts/preview/sync-template-files.js`, add two entries immediately after the existing `src/lib/site-meta.ts` entry (matching the `seo-routes.ts`/`site-meta.ts` shape):
```js
  {
    file: 'src/server/llms-txt.ts',
    description: 'Pure renderer + handler for /llms.txt',
    known_hashes: [],
    force: false,
  },
  {
    file: 'src/server/llms-txt.test.ts',
    description: 'Unit tests for the /llms.txt renderer and handler',
    known_hashes: [],
    force: false,
  },
```
(The handler is added to `llms-txt.ts` in Task 3 — registering the file now is fine; `known_hashes: []` means "create if absent, never clobber a customer edit," independent of later content.)

- [ ] **Step 7: Commit**

```bash
git add app-templates/v8/src/server/llms-txt.ts app-templates/v8/src/server/llms-txt.test.ts container-scripts/preview/sync-template-files.js
git commit -m "feat(v8): add pure llms.txt rendering (label, sanitize, render)"
```

---

## Task 3: The request handler (`llmsTxtHandler`)

**Files:**
- Modify: `app-templates/v8/src/server/llms-txt.ts` (add `llmsTxtHandler`)
- Modify: `app-templates/v8/src/server/llms-txt.test.ts` (add handler tests)

- [ ] **Step 1: Add the failing handler tests**

Append to `app-templates/v8/src/server/llms-txt.test.ts`:
```ts
import type { Request, Response } from "express";
import { llmsTxtHandler } from "./llms-txt";

/**
 * Minimal chainable Express res stand-in that records what the handler set.
 * Avoids adding supertest; matches the pure-function test style used across
 * this template (see seo-host.test.ts).
 */
function mockRes() {
	const calls: {
		status?: number;
		contentType?: string;
		headers: Record<string, string>;
		body?: string;
	} = { headers: {} };
	const res = {
		status(code: number) {
			calls.status = code;
			return res;
		},
		type(t: string) {
			calls.contentType = t;
			return res;
		},
		set(key: string, value: string) {
			calls.headers[key] = value;
			return res;
		},
		send(body: string) {
			calls.body = body;
			return res;
		},
	};
	return { res: res as unknown as Response, calls };
}

function reqFor(hostname: string): Request {
	return { protocol: "https", hostname } as unknown as Request;
}

describe("llmsTxtHandler", () => {
	it("returns 404 on a system/preview host", () => {
		const { res, calls } = mockRes();
		llmsTxtHandler(reqFor("preview.airoapp.ai"), res);
		expect(calls.status).toBe(404);
		expect(calls.body).toBe("Not found\n");
	});

	it("serves a well-formed file with the right headers on a customer host", () => {
		const { res, calls } = mockRes();
		llmsTxtHandler(reqFor("acme.com"), res);
		// Default siteMeta is unseeded, so H1 falls back to the hostname and
		// the default seoRoutes ("/") produces a single Home link.
		expect(calls.status).toBeUndefined(); // no explicit status => Express 200
		expect(calls.contentType).toBe("text/plain");
		expect(calls.headers["Cache-Control"]).toBe(
			"public, max-age=60, must-revalidate",
		);
		expect(calls.headers["Vary"]).toBe("Host");
		expect(calls.body).toContain("# acme.com");
		expect(calls.body).toContain("## Pages");
		expect(calls.body).toContain("- [Home](https://acme.com/)");
	});
});
```

- [ ] **Step 2: Run the handler tests to verify they fail**

Run: `npx vitest run src/server/llms-txt.test.ts -t "llmsTxtHandler"`
Expected: FAIL — `llmsTxtHandler` is not exported.

- [ ] **Step 3: Implement the handler**

Add to the top imports of `app-templates/v8/src/server/llms-txt.ts`:
```ts
import type { Request, Response } from "express";
import { seoRoutes } from "../lib/seo-routes";
import { siteMeta } from "../lib/site-meta";
import { isSystemHost } from "./seo-host";
```

Append to the end of `app-templates/v8/src/server/llms-txt.ts`:
```ts
/**
 * Express handler for GET /llms.txt. Host-gated like robots.txt / sitemap.xml:
 * system/preview hosts get a 404 (no real published site to describe);
 * customer-attached domains get the rendered file. Headers mirror the other
 * SEO routes so CDN behaviour is identical (per-host via `Vary: Host`).
 */
export function llmsTxtHandler(req: Request, res: Response): void {
	if (isSystemHost(req)) {
		res
			.status(404)
			.type("text/plain")
			.set("Cache-Control", "public, max-age=60, must-revalidate")
			.set("Vary", "Host")
			.send("Not found\n");
		return;
	}
	const body = renderLlmsTxt({
		baseUrl: `${req.protocol}://${req.hostname}`,
		hostname: req.hostname,
		name: siteMeta.name,
		summary: siteMeta.summary,
		routes: seoRoutes,
	});
	res
		.type("text/plain")
		.set("Cache-Control", "public, max-age=60, must-revalidate")
		.set("Vary", "Host")
		.send(body);
}
```

- [ ] **Step 4: Run the full test file to verify everything passes**

Run: `npx vitest run src/server/llms-txt.test.ts`
Expected: PASS (pure-function tests + both handler tests).

- [ ] **Step 5: Type check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app-templates/v8/src/server/llms-txt.ts app-templates/v8/src/server/llms-txt.test.ts
git commit -m "feat(v8): add host-gated llms.txt request handler"
```

---

## Task 4: Register the handler in `entry.ts`

**Files:**
- Modify: `app-templates/v8/src/server/entry.ts` (import + one `app.get`)

- [ ] **Step 1: Add the import**

In `app-templates/v8/src/server/entry.ts`, just below the existing `import { isSystemHost } from "./seo-host";` (line 10), add:
```ts
import { llmsTxtHandler } from "./llms-txt";
```

- [ ] **Step 2: Register the route**

In `app-templates/v8/src/server/entry.ts`, immediately after the closing `});` of the `app.get("/sitemap.xml", …)` handler (currently line 100) and before the `if (import.meta.env.PROD) {` block (line 102), add:
```ts
app.get("/llms.txt", llmsTxtHandler);
```

- [ ] **Step 3: Update `entry.ts` `known_hashes` so existing apps receive the route**

`entry.ts` is hash-gated in `SYNC_MANIFEST`. BEFORE this is committed, capture the MD5 of the pre-change `entry.ts` (the version currently deployed to customer apps) and append it to the `known_hashes` array of the `src/server/entry.ts` manifest entry.

Run (from repo root): `git show HEAD:app-templates/v8/src/server/entry.ts | md5`
Then in `container-scripts/preview/sync-template-files.js`, add the resulting hash as the last element of the `entry.ts` `known_hashes` array with a trailing comment:
```js
      '12a5f4baadf6ce4963913fe37384e51e',  // SEO: add must-revalidate to cache directives
      '<MD5_FROM_COMMAND>'  // before /llms.txt route (RUBICON-365)
```
(Replace `<MD5_FROM_COMMAND>` with the actual 32-char hash. Add a comma after the previous line. Use the hash of the file as it is on this branch immediately before your `entry.ts` edit.)

- [ ] **Step 4: Type check**

Run (from `app-templates/v8`): `npm run type-check`
Expected: PASS.

- [ ] **Step 5: Run the full v8 test suite**

Run: `npx vitest run`
Expected: PASS — existing `seo-host` tests plus the new `llms-txt` tests, no regressions.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: PASS (no new lint errors). If the import ordering rule complains, run `npm run lint:fix` and re-run `npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add app-templates/v8/src/server/entry.ts container-scripts/preview/sync-template-files.js
git commit -m "feat(v8): serve /llms.txt route (RUBICON-365)"
```

---

## Task 4b: Close the SSR-migration template gap (discovered during execution)

`app-templates/v8/src/server/entry.ts` has a byte-identical twin at `agents/src/skills/ssr-migration/templates/server/entry.ts`, enforced by `SSR_SKILL_TEMPLATE_PAIRS` in `scripts/validate-template-sync.mjs`. The pre-commit parity check forced the Task 4 route edit into both. But the SSR-migration skill installs its whole `templates/` dir into migrating apps, and that dir was missing the new `llms-txt.ts` / `site-meta.ts` siblings the edited `entry.ts` now imports — so migrated apps would fail to build. Fix:

- [ ] Copy byte-identical: `app-templates/v8/src/server/llms-txt.ts` → `agents/src/skills/ssr-migration/templates/server/llms-txt.ts`, and `app-templates/v8/src/lib/site-meta.ts` → `agents/src/skills/ssr-migration/templates/lib/site-meta.ts` (no `.test.ts` — test files are not in the skill template dir).
- [ ] Add both as `SSR_SKILL_TEMPLATE_PAIRS` entries so future drift is caught by CI.
- [ ] `node scripts/validate-template-sync.mjs` exits 0; `pnpm --filter @airo/agents typecheck` passes.
- [ ] Commit: `fix(ssr-migration): ship llms-txt + site-meta in migration template`

(Done in commit `4155ad34d`.)

## Task 5: Tell the develop agent to seed `site-meta.ts`

**Files:**
- Modify: `agents/src/prompts/develop/seo.md`

This is the cached, always-loaded create-time primer (the on-demand `seo` skill is NOT loaded at create, so the instruction must live here, and must stay lean). The agent already authors the business name/description into the homepage `Organization` JSON-LD; this asks it to mirror those two values into `site-meta.ts`.

- [ ] **Step 1: Add the instruction section**

In `agents/src/prompts/develop/seo.md`, after the `## Sitemap` section (the file currently ends at the sitemap paragraph, line 31), append:
```markdown

## llms.txt

Set the business identity in `src/lib/site-meta.ts` so the site's `/llms.txt`
has a proper header: `name` = the business name, `summary` = one plain-text
sentence describing the business. Reuse the same name and description you put
in the homepage `Organization` JSON-LD — do not invent new wording, and keep
`summary` to a single line with no markdown. Leave both empty only if the brief
genuinely gives you nothing to say.
```

- [ ] **Step 2: Verify the agents package still type-checks**

Run (from repo root): `pnpm --filter @airo/agents typecheck`
Expected: PASS. (The change is markdown only; this confirms nothing else broke. There is no unit test for primer prose.)

- [ ] **Step 3: Commit**

```bash
git add agents/src/prompts/develop/seo.md
git commit -m "feat(agents): instruct develop agent to seed site-meta for llms.txt"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full v8 verification**

Run (from `app-templates/v8/`):
```bash
npm run type-check && npm run lint && npx vitest run
```
Expected: all three PASS.

- [ ] **Step 2: Agents verification**

Run (from repo root):
```bash
pnpm --filter @airo/agents typecheck
```
Expected: PASS.

- [ ] **Step 3: Manual smoke (optional but recommended)**

From `app-templates/v8/`, build and run the SSR server, then hit the route with different Host headers:
```bash
npm run build
PORT=3000 node dist/server/entry.js &
curl -s -H "Host: acme.com" http://127.0.0.1:3000/llms.txt
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: preview.airoapp.ai" http://127.0.0.1:3000/llms.txt
kill %1
```
Expected: the first prints a markdown file (`# acme.com` + `## Pages` + a Home link, since `site-meta.ts` is unseeded in the bare template); the second prints `404`.

- [ ] **Step 4: Confirm the working tree is clean and the branch is ready**

Run:
```bash
git status --short
git log --oneline tgottigundala/rubicon-365-llms-txt ^main
```
Expected: clean tree; commits from Tasks 1–5 listed.

---

## Self-review (completed by plan author)

**Spec coverage:**
- Dynamic handler in `entry.ts`, host-gated, mirrored headers → Task 4 (registration) + Task 3 (handler). ✓
- 404 on system host / render on customer host → Task 3 tests. ✓
- `site-meta.ts` server-readable business header → Task 1. ✓
- Agent seeds it via lean create-time primer → Task 5. ✓
- Spec-correct output (H1 + blockquote + single `## Pages` list, bare links, no trailing `:`) → Task 2 `renderLlmsTxt` + its exact-string tests. ✓
- `humanizeLabel` rule incl. `/`, nested, trailing slash → Task 2 tests. ✓
- `sanitizeMarkdown` closes the "never malformed" gap (brackets, backtick, newline) → Task 2 tests. ✓
- Thin-site fallback (hostname H1, no blockquote) → Task 2 + Task 3 tests. ✓
- Empty `seoRoutes` → omit `## Pages` heading → Task 2 test. ✓
- Page list tracks `seoRoutes` (RUBICON-98 sync, no new code) → uses `seoRoutes` directly; Task 3 customer-host test asserts the Home link. ✓
- Headers match robots/sitemap → Task 3 handler test asserts `Content-Type`/`Cache-Control`/`Vary`. ✓
- Out of scope (RUBICON-366 crawler rules, RUBICON-374 backfill, Plan B per-page descriptions/skill/`llms-full.txt`) → not implemented; no tasks, by design. ✓
- Per-tenant caching to confirm → covered by inheriting robots/sitemap headers + `Vary: Host`; manual smoke in Task 6 Step 3 exercises both host classes.

**Placeholder scan:** none — every code/step is concrete.

**Type consistency:** `RenderLlmsTxtOptions` fields (`baseUrl`, `hostname`, `name`, `summary`, `routes`) are used identically in Task 2 tests, Task 2 implementation, and the Task 3 handler call. `SeoRoute` imported from `../lib/seo-routes` matches the real interface. `SiteMeta`/`siteMeta` names match between Task 1 and Task 3. Function names (`humanizeLabel`, `sanitizeMarkdown`, `renderLlmsTxt`, `llmsTxtHandler`) are consistent across all tasks.

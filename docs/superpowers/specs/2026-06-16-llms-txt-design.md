# RUBICON-365 — llms.txt generation & serving (Plan A: minimal hygiene)

**Date:** 2026-06-16
**Ticket:** [RUBICON-365](https://godaddy-corp.atlassian.net/browse/RUBICON-365) — Generate and serve `/llms.txt` for Airo customer sites
**Epic:** RUBICON-354 — Schema & AI Readiness
**Base:** `main`
**Delivery:** one PR (template + agent prompt)

## Summary

Every published Airo customer site should serve a spec-correct `/llms.txt` at its root,
**rendered live by an Express handler** in the v8 template (never a stored file), so it
can never be the advertised-but-missing file we found in the wild (a real Airo site had
`/llms.txt` listed in its sitemap while the URL itself 404'd — the agent registered the
route but never produced the artifact).

The file is rendered per request from two sources: the existing `seoRoutes` registry (for
the page-link list) and a small new server-readable `site-meta.ts` module (for the
business name + one-line summary). An agent-prompt instruction seeds `site-meta.ts` at
site creation.

This is deliberately the **minimal hygiene version**. The evidence (see below) does not
justify per-page descriptions, a sync pipeline, skill enrichment, or an `llms-full.txt`
companion — those are Plan B and explicitly **not** built here.

## Why minimal — the evidence

Research into primary sources (first-party server-log studies and provider docs, weighted
over SEO-agency marketing) shows `/llms.txt` is currently **low-value, advisory hygiene —
not a citation, ranking, or access-control lever**:

- **Rarely fetched.** Ahrefs server-log study, 137K domains, 2026-06-15: 97% of existing
  `/llms.txt` files received zero traffic in the prior month; AI bots were a tiny fraction
  of the remainder. A separate 48-day log study saw zero AI-crawler requests to the file.
- **No provider commitment.** OpenAI's bot docs never mention it; Google's John Mueller has
  argued on-record (Search Off the Record) that LLMs can't use it to differentiate sites
  because it is self-reported, untrusted content. No OpenAI/Anthropic/Google/Perplexity/Meta
  commitment to consume it exists.
- **Not a control surface.** Training opt-out and crawler blocking are governed by
  **robots.txt** (and the emerging IETF AIPREF vocabulary), not `/llms.txt`. Conflating the
  two is the most important error to avoid in code and copy.
- **No citation correlation.** SE Ranking (~300K domains) found no significant relationship
  between publishing `/llms.txt` and AI-engine citations.
- **Peers are split.** Wix and Shopify auto-generate it on-by-default (commerce / agentic
  framing); Yoast ships it opt-in, off by default, capped at 5+5 entries, hedged;
  Webflow/Framer are manual upload.

**Conclusion:** presence is trending toward table-stakes, and a *well-formed* file is cheap
and low-risk — but a malformed or boastful one is worse than none, and we must promise zero
performance benefit. So: ship the minimal correct artifact, guard quality, make no claims.

## Code grounding — what the template can and cannot read at request time

Verified against `app-templates/v8/`:

1. **Business identity is not server-readable.** The homepage `Organization`/`WebSite`
   JSON-LD that RUBICON-343 produces is written **inline into React component markup**
   (`<script type="application/ld+json">` inside `.tsx`) and only exists after render. There
   is no persisted `businessName`/`businessDescription` server-side. (`SeoStrategyContext`
   in `agents/` holds it at *conversation* time only.)
2. **Per-page title/description are not server-readable.** They come from `<Helmet>` and are
   only available post-render; `entry-server.tsx` hands the SSR handler an already-rendered
   `head` string.
3. **`seoRoutes` is the only server-readable structured registry.** `SeoRoute` has just
   `path`, `changefreq`, `priority`, `lastmod` — no title or description.

**Consequence:** a handler can render `/llms.txt` live, but can only read **paths** from
existing data. A business header therefore requires a **new server-readable file** the
agent populates (`site-meta.ts`). This is why "pure projection from existing schema" is not
feasible and a small authored surface is unavoidable.

## What changes

### 1. Dynamic `/llms.txt` handler — `app-templates/v8/src/server/entry.ts`

- Add `app.get("/llms.txt", …)` between the `sitemap.xml` handler (~line 100) and the
  catch-all SSR route (~line 186), reusing the existing `baseUrl(req)` helper.
- **Host-gated** by `isSystemHost(req)` (from `seo-host.ts`), mirroring robots/sitemap:
  - System/preview host (`localhost`, `*.airoapp.ai`, etc.) → **HTTP 404**. There is no real
    published site to describe; this parallels robots' `Disallow: /` and sitemap's empty
    `urlset`.
  - Customer-attached domain → render the file (below).
- Response headers match the other SEO routes: `Cache-Control: public, max-age=60,
  must-revalidate`, `Vary: Host`, `Content-Type: text/plain; charset=utf-8`.
- Body = business header (source #2) + a `## Pages` link list built by iterating `seoRoutes`
  (filtering to `path` starting with `/`, the same guard sitemap uses), with URLs from
  `baseUrl(req)`. Two pure helpers own the formatting (both unit-testable in isolation):
  - `humanizeLabel(path)` → link text (see §4 for the rule).
  - `sanitizeMarkdown(text)` → escapes/strips Markdown-significant characters in
    agent-authored `name`/`summary` and in labels (see §4 — "Sanitization").
- If `seoRoutes` has no renderable entries, the `## Pages` heading is omitted entirely
  rather than emitting an empty section. (In practice `seoRoutes` is always seeded with `/`,
  so this is defensive; the synchronizer never wipes to empty — but the handler must not
  assume non-empty.)

### 2. New business-header module — `app-templates/v8/src/lib/site-meta.ts`

- Exports a typed constant:
  ```ts
  export interface SiteMeta {
    name: string;
    summary: string;
  }
  export const siteMeta: SiteMeta = { name: "", summary: "" };
  ```
- Default seed is empty strings (the thin-site signal — see fallback below).
- This is the **only** new data surface introduced by the feature.

### 3. Agent-prompt instruction (lean, create-time)

- Add a short instruction to the cached create-time SEO primer
  (`agents/src/prompts/develop/seo.md`) telling the develop agent to populate `site-meta.ts`
  with the business `name` and a one-line `summary`, mirroring what it already authors into
  the homepage `Organization` JSON-LD.
- Kept to a few lines, consistent with the token-frugality discipline of RUBICON-98/343: the
  on-demand `seo` skill is **not** loaded at create, so this guidance must live in
  always-loaded context, and must stay minimal.

### 4. Output format (spec-correct)

```
# {siteMeta.name}

> {siteMeta.summary}

## Pages
- [Home](https://example.com/)
- [About](https://example.com/about)
- [Contact Us](https://example.com/contact-us)
```

- H1 (name) + blockquote (summary) + a single `## Pages` H2 list of markdown links.
- No prose headings beyond the H2 (the llmstxt.org parsing contract ignores body headings).
- Per-page descriptions are intentionally omitted in Plan A — bare links are spec-valid.
- Each page line is exactly `- [Label](url)` with **no trailing `:` or description** (Plan A
  has no description field; a dangling `: ` is the kind of cosmetic sloppiness that makes a
  file look half-finished).

**`humanizeLabel(path)` rule** (the unit Test #1 asserts against):

1. `"/"` → `"Home"` (special case).
2. Otherwise: strip leading/trailing slashes, take the **last** path segment (so
   `/blog/my-post` → `my-post`, keeping labels short and page-specific), split on `-` and
   `_`, title-case each token, join with spaces. E.g. `/about` → `About`,
   `/contact-us` → `Contact Us`, `/blog/my-post` → `My Post`.
3. `seoRoutes` paths are static route paths — no query strings or fragments appear in the
   registry, so the helper does not handle them.

**Sanitization (closes the "never malformed" gap).** Although `name`/`summary` are written by
the agent, they ultimately derive from customer-supplied business details, so they can
contain Markdown-significant characters or newlines that would break the H1, blockquote, or
link syntax. `sanitizeMarkdown(text)` therefore:

- collapses any newline/tab/control characters (and runs of spaces) to a single space, then
  trims (keeps the H1 and blockquote single-line);
- backslash-escapes only the characters that break an *inline* construct: `\`, backtick,
  `[`, and `]`.

It deliberately does **not** escape `#`, `>`, `*`, `(`, or `)`: these are not structural in
the middle of a line (a `#`/`>` only starts a block at the *start* of a line, and a bare
`(`/`)` cannot break a `[label](url)` link because the `]` already closed the label span), so
escaping them would needlessly mangle ordinary business names (e.g. "C# Studio", "Café (Downtown)").
This narrower escape set is what the implementation ships and what the unit tests assert.

It is applied to `name`, `summary`, and every `humanizeLabel` output before interpolation.
This makes "never emit a malformed file" actually true rather than aspirational.

### 5. Thin-site / unseeded fallback

- If `siteMeta.name`/`summary` are still empty (agent didn't seed, or a near-empty site),
  the handler emits a **minimal but valid** file: H1 derived from the hostname, no
  blockquote, and the `## Pages` list from `seoRoutes`. It never emits a malformed file and
  never fabricates a summary.

### 6. Honest customer-facing framing

- Any customer-facing copy describes `/llms.txt` as an "emerging, advisory standard that
  offers AI tools a structured summary of your site," with **no** claim about rankings,
  citations, AI visibility, or blocking AI training. The real access-control lever
  (robots.txt / AI-crawler settings) is kept separate.

## AC mapping

| Acceptance criterion | How Plan A satisfies it |
| --- | --- |
| Generated & served at `/llms.txt` | Live handler; always well-formed, can't be half-written or forgotten. "Generation" dissolves into per-request rendering. |
| Reflects current pages, identity, key info | Pages ← `seoRoutes`; identity ← `site-meta.ts`. "Key info" beyond name/summary is out of scope (Plan B). |
| Updates when content/pages/business change | Pages stay current for free — `seoRoutes` is maintained by the RUBICON-98 post-edit sync handler, and the file is re-rendered per request (nothing to regenerate). Business changes are reflected when the agent re-writes `site-meta.ts`. No new sync infrastructure. |
| Accessible to known AI crawlers | Served 200, no auth, not disallowed, on customer domains; host-gated off on preview. Crawler allow-rules (AI user-agents) belong to RUBICON-366. |

## Out of scope

- **Crawler allow-rules / AI user-agent handling** → RUBICON-366.
- **Backfill to already-published sites.** Published apps run the template version they were
  built/last-published on, so existing sites won't serve `/llms.txt` until republished →
  RUBICON-374. This spec adds the capability to the template only.
- **Plan B** — per-page `title`/`description` on `SeoRoute`, `SeoRoutesSynchronizer`/post-edit
  changes to carry them, `seo`-skill enrichment guidance, and an `llms-full.txt` companion.
  Not built. (The internal `ai-transformation-api` API-docs use case, which wants richer
  digests, is treated as a separate need and must not inflate this ticket.)

## Testing

Unit tests for the handler (Vitest, in the v8 template's server test suite):

1. **Customer host, seeded** — returns 200; body has `# {name}`, `> {summary}`, and a
   `## Pages` list containing a link for every `seoRoutes` path with correctly humanized
   labels and absolute URLs from `baseUrl(req)`.
2. **System host** — returns 404 (assert for `localhost` and a `*.airoapp.ai` host).
3. **Thin-site / unseeded** — empty `site-meta` yields a minimal valid file (hostname H1, no
   blockquote, page list present), not a malformed or fabricated one.
4. **Headers** — `Content-Type: text/plain; charset=utf-8`, `Cache-Control` and `Vary: Host`
   match robots/sitemap.
5. **seoRoutes coupling** — adding a path to `seoRoutes` appears in the output, confirming
   the page list tracks the registry (and thus inherits RUBICON-98 sync with no new code).
6. **Sanitization** — a `name`/`summary` containing `]`, `)`, `#`, a backtick, or a newline
   produces a well-formed file (escaped/single-line), not broken H1/blockquote/link syntax.
   Direct unit tests on `humanizeLabel` (incl. `/`, nested `/blog/my-post`, trailing slash)
   and `sanitizeMarkdown`.
7. **Empty routes** — when `seoRoutes` has no renderable entries, no `## Pages` heading is
   emitted (no empty section).

## Risks & notes

- **Drift of `site-meta.ts` vs. homepage JSON-LD.** Two authored copies of the business
  identity can diverge. Accepted in Plan A: the file is barely read and consumers distrust
  self-reported content, so drift is low-impact; unifying the source is a Plan B concern —
  Plan B therefore inherits a reconciliation problem (single source of identity), not just
  the enrichment work.
- **Republish dependency.** The feature is invisible on existing sites until RUBICON-374
  backfill/republish lands — call this out in the PR so stakeholder expectations are set.
- **Per-tenant caching (to confirm during implementation).** `/llms.txt` inherits the exact
  `Cache-Control` + `Vary: Host` headers that `robots.txt`/`sitemap.xml` already ship with,
  which produce correct per-host responses in this template; confirm the CDN actually keys
  on `Host` for this route so one tenant's file is never served to another. Not independently
  re-verified here — it rests on the robots/sitemap precedent.

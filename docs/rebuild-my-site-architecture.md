# "Rebuild My Site" — Architecture & Data Flows

## Overview

"Rebuild my site" is a multi-agent pipeline that scrapes a user's existing website, analyzes its design/content, downloads assets, and generates targeted prompts so the AI can rebuild the site page-by-page.

---

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         USER JOURNEY                                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌──────────────┐     ┌──────────────────┐     ┌───────────────────────────┐   │
│  │ User types   │     │ InitialAgent     │     │ websiteRebuild tool       │   │
│  │ "Rebuild my  │────▶│ detects rebuild  │────▶│ starts orchestration      │   │
│  │  site URL"   │     │ intent           │     │ service                   │   │
│  └──────────────┘     └──────────────────┘     └─────────────┬─────────────┘   │
│                                                               │                 │
│                                                               ▼                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    SCRAPE & ANALYZE (background)                           │  │
│  │  ┌─────────────┐   ┌─────────────────┐   ┌────────────────────────────┐  │  │
│  │  │ Discover    │──▶│ Scrape pages    │──▶│ Download assets +          │  │  │
│  │  │ sitemap     │   │ (max 20)        │   │ Analyze homepage           │  │  │
│  │  └─────────────┘   └─────────────────┘   └────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                               │                 │
│                                                               ▼                 │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────────┐    │
│  │ DevelopAgent     │◀────│ Agent handoff    │◀────│ Homepage prompt      │    │
│  │ builds homepage  │     │ (WebSocket)      │     │ generated            │    │
│  └────────┬─────────┘     └──────────────────┘     └──────────────────────┘    │
│           │                                                                     │
│           ▼                                                                     │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │  PAGE SELECTOR (InputActionsPanel widget)                                 │   │
│  │  User picks page from dropdown → "Build" → repeat for each page          │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Dual Scraping Backends

The rebuild pipeline supports two scraping backends. Selection is per-shopper via the
Switchboard flag `appbuilder-atlas-crawler`, evaluated in the BFF when minting the
agent JWT and read by the agents service from `agentContext.useAtlasCrawler`. The
env var `USE_ATLAS_CRAWLER=true` is a blanket override for local development.

```
scrapeAndAnalyze()   ← FORK POINT
       │
       │  Atlas if: agentContext.useAtlasCrawler (from JWT, set by Switchboard flag)
       │            OR process.env.USE_ATLAS_CRAWLER === 'true' (local override)
       ▼
       ├── Atlas path                    ├── External API path (default)
       │                                 │
       ▼                                 ▼
┌──────────────────────────┐     ┌──────────────────────────────┐
│ Atlas (REST API)         │     │ External API                 │
│                          │     │                              │
│ • POST /crawl (async job)│     │ • SitemapDiscoveryService    │
│ • Poll GET /jobs/:id     │     │ • WebsiteScraperDriver       │
│ • GET /jobs/:id/results  │     │   (calls web-scraper API)    │
│ • fetch screenshot URL   │     │ • SiteAnalyzerAgent guesses  │
│ • S2S IAM auth           │     │   colors/fonts from screenshot│
│ • Design tokens from DOM │     │ • Navigation from HTML parse │
│ • Navigation from SSM    │     │                              │
│   + link fallback        │     │                              │
│ • SiteAnalyzerAgent      │     │                              │
│   for siteType only      │     │                              │
└──────────┬───────────────┘     └──────────────┬───────────────┘
           │                                     │
           └──────────── CONVERGES ──────────────┘
                              │
                              ▼
                   .source-site/ (same format)
                              │
                              ▼
                   buildPage() → PagePromptAgent
                              │
                              ▼
                   Handoff → DevelopAgent
```

| Aspect            | Atlas Path                                | External API Path                     |
| ----------------- | ----------------------------------------- | ------------------------------------- |
| Scraping          | REST API to atlas service (submit + poll) | HTTP to web-scraper API               |
| Sitemap           | Built into atlas crawl                    | Separate `SitemapDiscoveryService`    |
| Screenshots       | Atlas captures during crawl + URL fetch   | API `/v1/screenshot-website`          |
| Design tokens     | DOM-extracted (actual CSS values)         | AI-guessed from screenshot            |
| Navigation        | Atlas SSM + link fallback                 | HTML `<nav>` parsing                  |
| SiteAnalyzerAgent | siteType classification only              | Full analysis (type + colors + fonts) |
| Dependencies      | Atlas API + S2S IAM JWT                   | External API + SSO_JWT                |
| Environment       | Local + production (Switchboard-gated)    | Production-ready                      |

---

## Workflow State Machine

**Legacy path** (`startRebuild`): scrape begins immediately; style preferences may be auto-applied when the flag is off.

**Intake path** (Switchboard `appbuilder-rebuild-intake-form`, first rebuild only — `!app.initialBuildComplete`): `beginRebuild()` → user submits scope/design via UI or agent timeout defaults → scrape runs with scope-capped page limits.

```
  beginRebuild()                    submitIntake() / submitDefaultIntake()
        │                                      │
        ▼                                      ▼
 ┌─────────────────┐                    ┌──────────┐
 │ awaiting_intake │───────────────────▶│ scraping │──▶ analyzing ──▶ …
 └─────────────────┘                    └──────────┘
        │                                      │
        ▼                                      ▼
   (UI in develop)                        style_questions → building → complete
```

```
     startRebuild()          scrapeAndAnalyze()            submitStylePreferences()
          │                       │                              │
          ▼                       ▼                              ▼
    ┌──────────┐          ┌────────────┐              ┌──────────────────┐
    │ scraping │─────────▶│ analyzing  │─────────────▶│ style_questions  │
    └──────────┘          └────────────┘              └──────────────────┘
          │                      │                              │
          ▼                      ▼                              ▼
    ┌──────────┐          ┌──────────┐                ┌──────────────────┐
    │  error   │          │  error   │                │    building      │
    └──────────┘          └──────────┘                └──────────────────┘
                                                              │
                                                              │ buildPage() per page
                                                              ▼
                                                      ┌──────────────────┐
                                                      │    complete      │
                                                      └──────────────────┘
```

---

## On-Disk Data Layout

All data persisted to: `{appPath}/.source-site/`

```
.source-site/
├── workflow-state.json          # Status, progress, pages built, errors
├── site-metadata.json           # siteType, colors, fonts, brand voice
├── sitemap.json                 # Discovered pages with scraped flags
├── pages/
│   ├── homepage.json            # PageContent (sanitizedContent, structure, navigation)
│   ├── homepage.html            # Raw HTML
│   ├── about.json
│   └── about.html
├── screenshots/
│   ├── homepage.png             # Full-page screenshot (decoded from base64)
│   └── about.png
└── assets/
    ├── manifest.json            # Asset catalog with metadata
    └── [downloaded files]       # Images, fonts, icons
```

---

## Phase-by-Phase Data Flow

### Phase 1: Tool Invocation

**File**: `src/tools/ai-lib-tools/website-rebuild.ts`

1. Validate app exists in `AppRepository`
2. Create `RebuildOrchestrationService(app.path)`
3. If `rebuildIntakeFormEnabled` (JWT flag **and** `!app.initialBuildComplete`): `beginRebuild()` → `waitForIntake()` (poll status; 600s timeout applies defaults) → background scrape. Otherwise: `startRebuild()` → immediate scrape.
4. Poll with `waitForCompletion()` (400ms fast → 1500ms slow, 5min timeout)
5. When intake flag is off, apply default style preferences before homepage build; when on, preferences come from intake submission.
6. Call `buildPage(appId, 'homepage')` → generates prompt via PagePromptAgent
7. `stateManager.switchAgent(socketId, 'develop', homepagePrompt)` → handoff

**Intake UI**: `RebuildIntakeForm` in develop chat (flag + tool running + `!initialBuildComplete`). Submits `POST /apps/:id/rebuild/intake`; estimates at `GET /apps/:id/rebuild/scope-estimates`.

### Phase 2: Scraping (Atlas Path)

**Files**: `src/services/AtlasCrawlerAdapter.ts` (REST client), `src/services/rebuild/scrape-pipeline.ts` (`runAtlas`, orchestration)

The adapter is a REST client over the Atlas service (`ATLAS_API_BASE_URL`). Auth is
S2S IAM JWT via `getS2SToken()` (cached, auto-refreshed), sent as
`Authorization: sso-jwt <token>` on every **Atlas API** request (submit, poll, results/home).
The screenshot fetch in step 5 is the exception — it hits a presigned/external URL and
deliberately sends **no** auth header. The flow is:

1. **Corpus short-circuit (local only)** — before any network call, `crawlSite()` checks
   `resolveCorpusEntry()`. When the corpus is enabled (see env vars below), a matching
   source URL replays a recorded `jobId` instead of submitting a live crawl — deterministic
   test/dev runs. A corpus fetch failure falls back to a live crawl.
2. **Submit** — `POST /crawl` with options below. Returns `{ jobId, status? }`. Timeout: 10s.
3. **Poll** — `GET /jobs/:jobId` every 2s for the first 30s (fast phase), then every 5s.
   Per-poll timeout: 10s. Outer budget: 5min. The poller is failure-tolerant: ≥3 consecutive
   `401/403` aborts with a credentials/`ATLAS_API_BASE_URL` hint; ≥10 consecutive transport
   or non-OK responses aborts; a `failed` job status throws immediately. It also watches for the
   intermediate `homepage_ready` status (see below).
4. **Results** — once status is `completed`, `GET /jobs/:jobId/results` returns the full
   `CrawlResult`. Timeout: 60s.
5. **Screenshot** — `fetch(result.screenshots[0].url)` to download the homepage screenshot bytes.
   Timeout: 30s. Body cap: 10MB (rejected up-front via `content-length`, then again post-buffer).

All Atlas JSON is validated through `parseAtlasJson()` against Zod schemas
(`src/types/atlas-api.ts`). Malformed JSON **or** a shape mismatch is converted into a named
`import_failed` `RebuildError` with a user-facing message — this prevents, e.g., a missing
`jobId` from making the poller spin on `/jobs/undefined` for the full 5min, or an HTML error
page surfacing as a bare `SyntaxError`.

#### Homepage-first early build (`homepage_ready`)

Atlas exposes an intermediate **`homepage_ready`** job status (a real state Atlas sits in for
multiple polls, not a one-time event) and a companion `GET /jobs/:jobId/home` endpoint that
returns the homepage's results before the full crawl finishes. The poller fires an
`onHomepageReady` callback **at most once** when it first sees this status — guarded by a
`homepageHandlerAttempted` flag set *before* the fetch, so a failed attempt is not retried (it
falls through to the full-crawl path instead). A separate `homepageCallbackFired` boolean tracks
whether the callback actually completed.

The callback (in `runAtlas`) does the full homepage sequence early — persist the homepage JSON,
save a **homepage-only sitemap** (so the page selector can't advertise inner pages whose JSON
isn't on disk yet), run `SiteAnalyzerAgent`, merge design tokens, process + download homepage
assets, self-host the favicon, and advance state to `style_questions` — so the homepage can
start building while inner pages are still crawling. Because `analyze()` is slow (~10–15s) and a
user `submitStylePreferences` can land during it, the callback **re-reads state** before its
final write and only sets `style_questions` if the user hasn't already advanced past it
(`USER_ADVANCED_STATUSES` = building/review/complete/error).

After the full crawl completes, `runAtlas` branches on whether the homepage was already processed:

- **homepage already processed** → persist inner pages + merge the full crawl asset set (the
  asset-thin `/home` payload may have missed homepage-exclusive assets), then widen the sitemap
  to all pages (or mark inner pages `scraped: false` if the inner batch failed to persist).
- **not processed** (the `homepage_ready` attempt never completed) → run the full sequential
  fallback: persist all pages, analyze the homepage, process assets.

Submit body:

```typescript
POST /crawl
{
  url: sourceUrl,                    // full source URL, including any sub-path
  options: {
    maxPages: 20,                    // scope-derived; see resolveMaxPagesToScrape
    maxDepth: 3,                     // NOTE: deprecated/ignored server-side by Atlas — a no-op
    concurrency: 3,
    timeout: 30000,
    useSitemap: true,
    headless: true,
    seedPaths: [rootPath],           // '/foo' for sub-path rebuilds, else '/'
    output: 'full',
    include: { html, text, assets, structuredData, visual },
    screenshot: { enabled: true, format: 'png', fullPage: true },
    downloadAssets: true,
    ssrfProtection: 'strict',        // SSRF protection stays strict for the whole crawl
    respectRobotsTxt: true,
    acceptInsecureCerts: true,       // import sites with expired/self-signed/CN-SAN-mismatch
                                     // certs (e.g. white-label vanity domains on a platform
                                     // cert); without it Atlas aborts with net::ERR_CERT_*
  }
}
```

For sub-path rebuilds (`rootPath !== '/'`), `runAtlas` post-filters both the sitemap and
`crawlOutput.pages` with an `inRootPath()` check, keeping only pages whose pathname matches
`rootPath` or `rootPath + '/...'`. This post-filter **is** necessary as the adapter calls Atlas
today (see "Verified against the Atlas source" below): Atlas does not confine the crawl to the
seed prefix unless `scope: 'subtree'` is passed, which the adapter does not set.

Returns `AtlasCrawlOutput`:

- `sitemapData` — discovered pages with slugs
- `pages[]` — `{ url, success, sanitizedContent, html, forms?, contentLinks?, metadata?, screenshotBase64? }`
- `assets[]` — `{ url, type, sourceUrl, altText?, dimensions?, placement? }` — expanded to **one entry
  per referrer page** from Atlas's network-observed `referencedBy` (fixes shared logos being
  misattributed to whichever page Atlas crawled first)
- `designTokenMetadata` — `{ colorPalette, typography }` extracted from the DOM
- `navigation[]` / `footerNavigation[]` — `{ label, url, isExternal }`; same-origin links
  normalized to path-only, external kept absolute; primary nav falls back to homepage links
- `contact?` — aggregated phones/emails/addresses/hours/social (deduped)
- `favicon?` — primary favicon `{ url, rel?, sizes?, mimeType? }`
- `homepageScreenshotBase64?` — for SiteAnalyzerAgent and PagePromptAgent
- `atlasReportedScreenshot` — true when Atlas advertised a screenshot URL regardless of fetch
  success, so a fetch failure can be logged as a regression
- `homepageScreenshotFailureReason?` — `timeout` / `http-NNN` / `content-length-cap` /
  `post-arrayBuffer-cap` / `transport-error: <message>` (the transport case appends the error
  message, so Loki queries should match the `transport-error:` prefix), for single-query diagnosis

### Phase 2: Scraping (External API Path)

**Files**: `src/services/SitemapDiscoveryService.ts`, `src/tools/ai-lib-tools/drivers/website-scraper-driver.ts`

1. **Discover pages**: `/sitemap.xml` → `/robots.txt` → crawl homepage links
2. **Scrape** via `WebsiteScraperDriver.scrapeMultiplePages()`:
   - Calls `GET /v1/scrape-website?url=` → returns `sanitizedContent`, `html`
   - Calls `GET /v1/screenshot-website?url=` → returns PNG binary
   - Batched (5 concurrent), rate-limited (600ms between batches)
3. **Extract assets** from HTML: `<img>`, `background-image`, `<link>` fonts/icons

### Phase 3: Analysis & Asset Processing

**Files**: `src/agents/site-analyzer-agent.ts`, `src/services/AssetProcessingService.ts`

Run in parallel (`Promise.all`):

**SiteAnalyzerAgent** (AI, temp=0.3):

- Input: homepage sanitized content + screenshot (vision)
- Output: `SiteMetadata` — siteType, sitePurpose, targetAudience, brandVoice, designStyle, colorPalette, typography
- With Atlas: colors/typography from design tokens override AI guesses; AI only needed for siteType

**AssetProcessingService**:

- Downloads images to `.source-site/assets/`
- Categorizes by dimensions: hero (>800px), logo (100-400px), feature (300-800px), icon (<100px)
- Generates `manifest.json` with dimensions, fileSize, sourcePages
- Lazy AI analysis: `analyzePageAssets()` adds description, composition, usageContext per image

### Phase 4: Page Prompt Generation

**File**: `src/agents/page-prompt-agent.ts`

**Input to PagePromptAgent** (AI, temp=0.4):

- `siteMetadata` — colors, fonts, siteType, purpose, plus (Atlas) contact, favicon, footer nav
- `pageContent` — sanitized text, navigation items with exact URLs, and (Atlas) detected
  interactive patterns, extracted forms, and in-content document links
- `stylePreferences` — design direction (incl. `designIntent` free text, `keepLogo`/`keepSourceImages`)
- `assetManifest` — categorized images with paths, dimensions, and placement signals
- `screenshotBase64` — homepage screenshot as vision input (first page only)

**Prompt includes**:

- Site metadata (colors, fonts, siteType)
- Navigation links with exact URL paths (e.g., `"About Us" → /about-us`)
- Extracted key content (headings, features, CTAs — quoted verbatim)
- Full sanitized content (first 4000 chars)
- Categorized assets (hero images, logo candidates, feature images)
- Interactive patterns (carousels/accordions/tabs/video-hero) so they aren't flattened
- Forms rebuilt as real `<form>` elements (not visual mockups), and document links preserved verbatim
- Design instructions based on style preferences

**Homepage** (isFirstPage=true): Full setup — project name, colors, fonts, header/nav, footer, all sections
**Inner pages** (isFirstPage=false): Content area only — no header/footer/colors/fonts

**Output**: 400-1000 word actionable build prompt

### Phase 5: Agent Handoff

**File**: `src/tools/ai-lib-tools/website-rebuild.ts`

```typescript
stateManager.switchAgent(socketId, "develop", homepagePrompt);
```

- WebSocket routes session from InitialAgent → DevelopAgent
- DevelopAgent receives prompt as initial message
- DevelopAgent builds the homepage code

### Phase 6: Page Building Loop

**File**: `src/tools/ai-lib-tools/rebuild-page-selector.ts`

1. Frontend `useRebuildPages` hook polls `GET /apps/:id/rebuild/pages`
2. `InputActionsPanel` renders page selector dropdown
3. User selects page → "Build" → message sent
4. DevelopAgent calls `rebuildPageSelector({ mode: 'build', pageSlug: '...' })`
5. Tool calls `RebuildOrchestrationService.buildPage()` → PagePromptAgent generates inner-page prompt
6. DevelopAgent builds that page
7. Repeat until all pages built

---

## Key Data Types

These are abridged for readability; the authoritative definitions live in
`src/types/rebuild.ts`.

```typescript
interface RebuildWorkflowState {
  appId: string;
  sourceUrl: string;
  rootPath: string; // "/" or "/subpath"
  status:
    | "awaiting_intake"   // intake-form path, before scope/design submitted
    | "scraping"
    | "analyzing"
    | "style_questions"
    | "building"
    | "review"
    | "complete"
    | "error";
  scrapingProgress: { total: number; completed: number; currentPage?: string };
  scrapeSettled?: boolean; // true once the scrape pipeline finishes (even if inner pages failed to persist)
  rebuildScope?: RebuildScope; // "homepage_only" | "small" | "large"
  intakeCompleted?: boolean;
  intakeSubmittedAt?: string;
  stylePreferences?: StylePreferences;
  pagesBuilt: string[];
  currentPage: string | null;
  error?: string;
  errorCode?: "import_failed";
  userMessage?: string;
  createdAt: string;
  updatedAt: string;
}

interface StylePreferences {
  designDirection: "keep-similar" | "modernize" | "simplify" | "bold";
  designIntent?: string; // free-text instruction carried close to verbatim (typed/NL path only)
  colorPreference: "keep-original" | "suggest-new" | "custom";
  customColors?: { primary?: string; secondary?: string; accent?: string };
  typographyStyle: "keep-original" | "modern" | "classic" | "playful";
  layoutApproach: "responsive" | "mobile-first" | "desktop-first";
  keepLogo: boolean;          // bring-over: keep the source logo asset (default true)
  keepSourceImages: boolean;  // bring-over: keep source content photos (default true)
}

interface SiteMetadata {
  sourceUrl: string;
  siteType?: "content" | "app" | "commerce" | "dashboard"; // optional; defaults to "content"
  sitePurpose: string;
  targetAudience: string;
  brandVoice: string;
  designStyle: string;
  colorPalette: { primary: string[]; secondary: string[]; accent: string[] };
  typography: {
    headingFonts: string[];
    bodyFonts: string[];
    scale?: TypographyScaleEntry[]; // full per-role CSS scale (Atlas only)
  };
  contact?: SiteContactInfo;            // Atlas only — phones/emails/addresses/hours/social
  favicon?: SiteFavicon;                // Atlas only — { url, rel?, sizes?, mimeType? }
  footerNavigation?: NavigationItem[];  // from Atlas navigation.footer
  scrapedAt: string;
  version: string;
}

interface PageContent {
  url: string;
  slug: string;
  title: string;
  sanitizedContent: string;
  html?: string;
  structure: {
    hasHeader: boolean;
    hasFooter: boolean;
    hasSidebar: boolean;
    sections: PageSection[];
    navigation: NavigationItem[];          // { label, url, isExternal }
    interactivePatterns?: InteractivePattern[]; // carousels/accordions/tabs/video-hero — so they aren't flattened
    forms?: FormHint[];                    // real <form>s to rebuild (Atlas-extracted)
    contentLinks?: ContentLink[];          // in-content document links (PDFs, etc.) — preserved verbatim
  };
  metadata: PageMetadata;
}

interface AssetInfo {
  url: string;
  localPath: string;
  type: "image" | "font" | "icon" | "other";
  description?: string;
  altText?: string;
  hasEmbeddedText?: boolean;  // image has brand/heading text burned into its pixels (vision-detected)
  embeddedText?: string | null;
  dimensions?: { width: number; height: number };
  sourcePages: string[];
  placement?: ImagePlacement; // Atlas image placement signals (inHeader/inFooter/nearH1/…)
}
```

#### `PageBuildSpec` — structured rebuild → develop handoff (Atlas path)

Separate from the markdown prompt that `PagePromptAgent` emits, the rebuild builds a
`PageBuildSpec` — the deterministic *facts* of a page (site metadata, primary + footer nav,
forms, contentLinks, detected interactive patterns, public asset paths, style preferences). The
design intent: **the markdown prompt is the home for creative direction; the spec is the home for
facts**, so develop doesn't reinterpret already-extracted data, and eval-time comparison reads the
same shape on both crawls.

It is produced by `buildPageSpec()` (`src/services/rebuild/prompt-builder.ts`) and written to
`.source-site/{pageSlug}-spec.json` **only on the Atlas path**. As of this writing it is a
written-but-dormant seam: persisted and surfaced in the `buildPage` result metadata, but **not
yet read by the develop agent**.

---

## Polling Mechanism

There are two distinct poll loops; don't conflate them.

**Tool-level** — `websiteRebuild` polls the workflow-state file for background scrape completion
(`wait-for-scrape-completion.ts`):

- **Iterations 0–17**: 400ms interval (~7.2s fast phase)
- **Iterations 18+**: 1500ms interval (slow phase)
- **Max timeout**: 300,000ms (5 minutes)
- **Returns when** `isRebuildReadyForUpfrontBuild(state)` (`scrape-completion.ts`) is true — status is one of `style_questions`/`building`/`review`/`complete` **and** the scrape has settled (`scrapeSettled`) or progress is complete. Multi-page scopes (`small`/`large`) additionally require >1 page, so an Atlas homepage-first callback that sets `style_questions` at 1/1 against a homepage-only sitemap doesn't satisfy readiness prematurely.
- **Throws when** status is `'error'` (re-thrown as a `RebuildError`) or the 5-minute budget elapses.

When the intake form is enabled, `waitForIntake()` (`wait-for-intake.ts`) runs first with the same
400ms→1500ms schedule and a **600,000ms (10 minute)** budget; on timeout it applies default
intake choices.

**Atlas adapter-internal** — `AtlasCrawlerAdapter.pollUntilComplete` polls the Atlas REST job
(`GET /jobs/:jobId`) on a separate 2s→5s schedule with its own 5min budget, watching for
`homepage_ready`/`completed`/`failed`. This is the loop described in Phase 2.

---

## Entry Points

| Entry Point     | Location                                                   | Trigger                               |
| --------------- | ---------------------------------------------------------- | ------------------------------------- |
| Homepage button | `app/src/app/[market]/components/HeroExamples.tsx`         | "Rebuild my site" card                |
| Chat input      | InitialAgent prompt (`agents/src/prompts/initial/core.md`) | "rebuild"/"recreate"/"redesign" + URL |
| Session restore | `app/src/app/[market]/develop/hooks/useInitialization.ts`  | `sessionStorage` rebuild key          |

---

## Component Architecture

### Frontend (app/ — Next.js)

| Component                         | Purpose                                                      |
| --------------------------------- | ------------------------------------------------------------ |
| `WebsiteRebuildToolRenderer`      | Progress bar, domain badge, pages/assets summary             |
| `RebuildPageSelectorToolRenderer` | Dropdown of unbuilt pages, "Build" button                    |
| `useRebuildPages` hook            | Polls `GET /apps/:id/rebuild/pages` (React Query, 30s stale) |
| `InputActionsPanel`               | Renders rebuild widget when `hasRebuildPages === true`       |

### Backend (agents/ — Express + AI)

| Component                     | Purpose                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `website-rebuild.ts`          | Entry tool — starts rebuild, polls, applies defaults, triggers handoff |
| `rebuild-page-selector.ts`    | Page selector tool — `show` (list) / `build` (generate prompt) modes   |
| `RebuildOrchestrationService` | Core orchestration — state machine, persistence, prompt generation     |
| `AtlasCrawlerAdapter`         | REST client for the Atlas service (submit + poll + results + screenshot fetch); maps output to pipeline types |
| `SitemapDiscoveryService`     | Page discovery (external API path)                                     |
| `WebsiteScraperDriver`        | HTTP scraping (external API path)                                      |
| `AssetProcessingService`      | Downloads images, generates manifest, lazy AI analysis                 |
| `SiteAnalyzerAgent`           | AI: siteType classification (+ colors/fonts in non-atlas path)         |
| `PagePromptAgent`             | AI: generates build prompts with screenshot vision input               |
| `GET /apps/:id/rebuild/pages` | API route for frontend page selector                                   |

---

## Key Design Decisions

1. **Default style preferences** — `designDirection` resolves in order: (1) valid client choice (`rebuildDesignDirection` from the homepage modal or intake submit), (2) agent tool arg (`websiteRebuild({ designDirection })` from Initial Agent intent inference on the **first** full-site rebuild prompt), (3) default `modernize`. Applied on intake timeout, intake-form-off, and when scrape completes without stored preferences. Other defaults: `keep-original` colors/typography, `responsive` layout. The `style_questions` state exists but is skipped.

   **First-touch only:** Semantic direction inference runs when **Initial Agent** calls `websiteRebuild` at app creation (or any turn still routed to Initial). `websiteRebuild` is registered on Initial Agent only (`agents/src/agents/initial-agent.ts`). After handoff, the persisted agent is `develop`, which rebuilds inner pages via `rebuildPageSelector` using style preferences already stored from the initial crawl. Mid-conversation *new* full-site rebuilds from develop chat are not covered here — adding `websiteRebuild` to develop is insufficient because the tool ends with `switchAgent(socketId, 'develop', homepagePrompt)` and a same-agent `develop`→`develop` switch is a no-op, so the homepage prompt never reaches develop through the normal channel. That path needs an explicit routing design.

   **Eval coverage:** `agents/src/evals/rebuild-design-direction.spec.ts` pins the prompt/tool contract in CI and, when provider API keys are present, drives Initial Agent over the phrase matrix in `rebuild-design-direction-matrix.ts` (semantic paraphrases, negation, ES/FR, bare rebuild). Precedence (modal → tool arg → default) is unit-tested in `intake-defaults` and `website-rebuild` tests.

2. **Homepage-first strategy** — Homepage gets full setup (colors, fonts, nav, footer). Inner pages only generate content-area prompts.

3. **Screenshot as visual reference** — Homepage screenshot is passed to both SiteAnalyzerAgent (siteType) and PagePromptAgent (layout fidelity) as a vision input.

4. **Navigation with exact paths** — Nav items include actual URL paths (e.g., `/about-us`) to prevent the DevelopAgent from inventing simplified paths.

5. **Lazy asset analysis** — Images analyzed on-demand per page via AI vision model, not during initial scrape.

6. **Blog filtering** — Blog posts discovered but excluded from rebuild candidates.

7. **Sub-path support** — URLs like `example.com/psycholand` scope the rebuild to that path prefix.

8. **Default 20-page cap** — Upper bound on scraping scope when no intake `rebuildScope` is set; scope selection lowers it further (see #15).

9. **Adaptive polling** — Fast then slow to balance responsiveness and CPU.

10. **Parallel analysis** — Site analysis + asset processing run concurrently via `Promise.all`.

11. **Atlas seeds the rebuild root** — `seedPaths: [rootPath]`. For root rebuilds this is `/` (always crawled even when sitemap only contains product pages). For sub-path rebuilds (`/foo`) the source URL itself is the seed; agents post-filters Atlas results to drop any page outside that prefix.

12. **Homepage-first early build (Atlas)** — Atlas's `homepage_ready` status lets the homepage be analyzed and built while inner pages are still crawling. Fired at most once; the full-crawl path picks up the slack if the early attempt doesn't complete. See Phase 2.

13. **Favicon self-hosting** — after homepage assets process, `selfHostFavicon` (`src/services/rebuild/favicon-selfhost.ts`) overwrites the template's placeholder `public/favicon.ico` with the cloned site's real favicon bytes **and** rewrites the `<link rel="icon">` `type` attribute in `index.html` to match the real format. This is what deterministically fixes the browser-tab favicon — it doesn't rely on the agent emitting a `<link>`. Best-effort: the caller (`selfHostHomepageFavicon` in `scrape-pipeline.ts`) wraps the call in a try/catch, so any favicon failure — including an fs error thrown inside `selfHostFavicon` itself — is logged and never fails the rebuild.

14. **Crawled source images in the Media tab** — gated by `appbuilder-rebuild-source-images`; `registerCrawledImagesAsUploads` runs best-effort in a `finally` so it executes even on a partial/failed scrape (no-op if the asset manifest is absent).

15. **Scope-based page limits** — the intake `RebuildScope` (`homepage_only`/`small`/`large`) caps both scraping and upfront builds via `resolveMaxPagesToScrape`/`capDiscoveredPages` (`src/services/rebuild/scope-estimates.ts`): `homepage_only` → 5 scrape / 1 build, `small` → 10 / 5, `large` → 15 / 10. With no scope set, the default cap is 20.

16. **Interactive-pattern preservation** — `interactive-pattern-detector.ts` flags carousels/accordions/tabs/video-heroes/lightboxes/modals from raw HTML so PagePromptAgent rebuilds them as interactive, not flattened static sections.

17. **Facts vs. creative direction (`PageBuildSpec`)** — deterministic page facts are captured in a `PageBuildSpec` (`.source-site/{slug}-spec.json`, Atlas path) separate from the creative markdown prompt. Currently written but not yet consumed by develop — see Key Data Types.

18. **Atlas response validation** — every Atlas payload is Zod-validated (`parseAtlasJson`); malformed JSON or shape drift becomes a user-facing `import_failed` error rather than a downstream crash.

---

## Verified against the Atlas source

The two questions below were previously open; both are now answered by reading the Atlas
service source (`gdcorp-partners/scrapers` → `atlas`). They describe Atlas behavior as of that
cross-reference — re-confirm if the Atlas API changes.

1. **`seedPaths` does NOT confine the crawl.** Atlas's `scope` option defaults to `'domain'`,
   under which `seedPaths` are only *prioritized* (prepended to the queue), not restricted —
   the crawler may visit anything on the origin (`src/services/crawler/prepare.ts`). Confinement
   happens only under `scope: 'subtree'`, which the adapter does **not** currently pass. With
   `useSitemap: true`, sitemap URLs are discovered independently, filtered by domain/scope, and
   **capped at `maxPages` before `seedPaths` are prepended** — so out-of-prefix sitemap URLs can
   both pull the crawl outside `rootPath` and eat into the page budget. **Conclusion:** the
   consumer-side `inRootPath()` post-filter is required as written. A cheaper alternative would
   be to pass `scope: 'subtree'` (and/or `priorityPage: 'seed'`) for sub-path rebuilds and let
   Atlas confine server-side — a code change, not yet made.

2. **`screenshots[0]` is the *priority page*, which is the domain root for the adapter's calls.**
   Atlas resolves the priority page via `resolvePriorityPage(explicit, maxPages, scope)`
   (`src/services/crawler/seeds.ts`): `scope: 'subtree'` → `'seed'`; else an explicit
   `priorityPage`; else `maxPages === 1` → `'seed'`; else falls back to `'root'` (the **domain
   root `/`**, which may be outside a sub-path seed). The adapter passes none of `scope`,
   `priorityPage`, and its `maxPages` is always ≥5, so the priority page resolves to `'root'`
   for **every** rebuild. For a root rebuild that is correctly the homepage. **For a sub-path
   rebuild (`/foo`), the priority page — and therefore both the `homepage_ready`/`/home` payload
   and `screenshots[0]` — is the site root `/`, not `/foo`.** This is a known correctness gap for
   sub-path rebuilds; the fix is the same `scope: 'subtree'` / `priorityPage: 'seed'` change
   noted above. Tracked in [AIROBUILD-3072](https://godaddy-corp.atlassian.net/browse/AIROBUILD-3072).

## Consumer notes from the Atlas cross-reference

- **`maxDepth` is deprecated and ignored** server-side; the adapter still sends `maxDepth: 3`
  but it has no effect.
- **Job results expire after ~90 days** (S3 lifecycle on the Atlas side). This corroborates the
  Atlas corpus's stale-entry warning (>80 days) — recorded `jobId`s eventually 404 on
  `/jobs/:id/results`.
- Atlas exposes additional crawl levers the adapter does not use: `scope` (`domain`/`subtree`),
  `priorityPage` (`root`/`seed`), and `strategy` (`auto`/`sitemap-bfs`/`homepage-priority`).
- The submit response `status` is always the literal `'pending'` on the Atlas side; the adapter's
  schema treats it as optional, which is harmlessly lenient.

---

## Error Handling

1. **Tool level** (`website-rebuild.ts`): Catches all errors, returns structured response with `errorCode` and `userMessage`
2. **Service level** (`RebuildOrchestrationService`): Updates workflow-state to `'error'`, stores message for polling
3. **Multi-page resilience**: Individual page failures don't block batch; succeeds if any pages scraped
4. **Graceful degradation**: Sitemap fails → robots.txt → crawl homepage links

---

## Environment Variables

| Variable                        | Default                                | Purpose                                                                                                                |
| ------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `USE_ATLAS_CRAWLER`             | unset                                  | Local override: when `true`, force the Atlas path regardless of JWT. Primary selection is the Switchboard flag instead |
| `ATLAS_API_BASE_URL`            | `https://atlas.dev-gdcorp.tools` (dev) | Atlas REST API base. Set per-env via `dev-runner` preflight locally and via the Nomad job spec in mhp-core for prod    |
| `ATLAS_JOB_CORPUS`              | unset                                  | When `true` **and** `GASKET_ENV` starts with `local`, enables corpus replay of recorded Atlas jobs (deterministic dev/test) |
| `ATLAS_JOB_CORPUS_FORCE`        | unset                                  | When `true`, bypass the corpus cache and force a live crawl                                                            |
| `ATLAS_JOB_CORPUS_PATH`         | `fixtures/atlas-job-corpus.json`       | Optional override for the corpus file location (a `.local.json` sibling is also honored)                              |
| `REBUILD_SCRAPE_BATCH_DELAY_MS` | 600                                    | Delay between batches (external API path)                                                                              |
| `REBUILD_SCRAPE_CONCURRENCY`    | 5                                      | Concurrent page scrapes (external API path)                                                                            |
| `WEB_SCRAPER_URL`               | `https://web-scraper.api.int.dev-gdcorp.tools` (dev) | External scraper API base                                                                                |
| `SSO_JWT`                       | —                                      | Auth token for external scraper API                                                                                    |

| Switchboard flag                  | JWT claim                    | Purpose                                                                                          |
| --------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `appbuilder-atlas-crawler`        | `useAtlasCrawler`            | Per-shopper toggle for the Atlas path                                                            |
| `appbuilder-rebuild-intake-form`  | `rebuildIntakeFormEnabled`   | Per-shopper toggle for the scope/design intake form (first rebuild only)                         |
| `appbuilder-rebuild-source-images`| `rebuildSourceImagesEnabled` | Surface crawled source images in the Media tab (`registerCrawledImagesAsUploads`)                |

All three are evaluated in the BFF agent-token route (`app/src/app/api/auth/agent-token/route.ts`),
embedded in the agent JWT (claim names above per `app/src/lib/jwt-config.ts`), and read by the
agents service in `src/server/middleware/jwt-auth.ts`.

---

## File Inventory

| File                                                     | Purpose                                              |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `agents/src/tools/ai-lib-tools/website-rebuild.ts`       | Entry tool — starts rebuild, polls, triggers handoff |
| `agents/src/tools/ai-lib-tools/rebuild-page-selector.ts` | Page selector tool — show/build modes                |
| `agents/src/services/RebuildOrchestrationService.ts`     | Core orchestration — state machine, persistence, `buildPage`; delegates scrape+analyze to the pipeline |
| `agents/src/services/rebuild/scrape-pipeline.ts`         | Two-strategy scrape+analyze body (`runAtlas`/`runLegacy`), homepage-first callback |
| `agents/src/services/AtlasCrawlerAdapter.ts`             | Atlas REST integration — submit/poll/results, maps types |
| `agents/src/services/atlas-job-corpus.ts`                | Corpus replay of recorded Atlas jobs (local dev/test) |
| `agents/src/services/rebuild/prompt-builder.ts`          | `buildPage` prompt + `buildPageSpec` (`PageBuildSpec`) |
| `agents/src/services/rebuild/scope-estimates.ts`         | Scope → max-pages caps (`resolveMaxPagesToScrape`, `capDiscoveredPages`) |
| `agents/src/services/rebuild/intake-defaults.ts`         | Default style preferences when intake times out / is off |
| `agents/src/services/rebuild/favicon-selfhost.ts`        | Overwrite `public/favicon.ico` + rewrite `<link>` type |
| `agents/src/services/rebuild/register-crawled-images.ts` | Register crawled source images as Media-tab uploads  |
| `agents/src/services/rebuild/document-links.ts`          | Map Atlas page links → in-content document links     |
| `agents/src/services/interactive-pattern-detector.ts`    | Detect carousels/accordions/tabs/video-hero from HTML |
| `agents/src/services/SitemapDiscoveryService.ts`         | Page discovery — sitemap.xml, robots.txt, crawl (legacy) |
| `agents/src/services/AssetProcessingService.ts`          | Asset download, categorization, manifest             |
| `agents/src/agents/site-analyzer-agent.ts`               | AI analysis — siteType (+ colors/fonts on legacy path) |
| `agents/src/agents/page-prompt-agent.ts`                 | Prompt generation — homepage vs inner pages          |
| `agents/src/types/rebuild.ts`                            | All TypeScript interfaces for rebuild feature        |
| `agents/src/types/atlas-api.ts`                          | Zod schemas + types for the Atlas REST API           |
| `agents/src/server/routes/rebuild.ts`                    | API route: `GET /apps/:id/rebuild/pages`             |
| `app/src/.../WebsiteRebuildToolRenderer.tsx`             | Progress/completion UI                               |
| `app/src/.../RebuildPageSelectorToolRenderer.tsx`        | Page selector dropdown UI                            |
| `app/src/.../hooks/useRebuildPages.ts`                   | React Query hook for rebuild pages                   |
| `app/src/.../components/chat/InputActionsPanel.tsx`      | Renders rebuild widget in chat                       |

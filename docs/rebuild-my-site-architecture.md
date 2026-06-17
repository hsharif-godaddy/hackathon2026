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

**File**: `src/services/AtlasCrawlerAdapter.ts`

The adapter is a REST client over the Atlas service (`ATLAS_API_BASE_URL`). Auth is
S2S IAM JWT via `getS2SToken()` (cached, auto-refreshed). The flow is:

1. **Submit** — `POST /crawl` with options below. Returns `{ jobId, status: 'pending' }`. Timeout: 10s.
2. **Poll** — `GET /jobs/:jobId` every 2s for the first 30s (fast phase), then every 5s. Per-poll timeout: 10s. Outer budget: 5min.
3. **Results** — once status is `completed`, `GET /jobs/:jobId/results` returns the full `CrawlResult`. Timeout: 60s.
4. **Screenshot** — `fetch(result.screenshots[0].url)` to download the homepage screenshot bytes. Timeout: 30s. Body cap: 10MB.

Submit body:

```typescript
POST /crawl
{
  url: sourceUrl,                    // full source URL, including any sub-path
  options: {
    maxPages: 20,
    maxDepth: 3,
    concurrency: 3,
    timeout: 30000,
    useSitemap: true,
    headless: true,
    seedPaths: [rootPath],           // '/foo' for sub-path rebuilds, else '/'
    output: 'full',
    include: { html, text, assets, structuredData, visual },
    screenshot: { enabled: true, format: 'png', fullPage: true },
    downloadAssets: true,
    ssrfProtection: 'strict',
    respectRobotsTxt: true,
  }
}
```

For sub-path rebuilds (`rootPath !== '/'`), `RebuildOrchestrationService` post-filters
`crawlOutput.pages` to keep only pages whose pathname matches `rootPath` or
`rootPath + '/...'`. This is a safety net: Atlas's `seedPaths` semantics regarding
prefix confinement are not yet documented in this repo, and `useSitemap: true` may
queue out-of-prefix URLs from the site's sitemap.xml. See "Open Questions" below.

Returns `AtlasCrawlOutput`:

- `sitemapData` — discovered pages with slugs
- `pages[]` — `{ url, sanitizedContent, html, screenshotBase64 }`
- `assets[]` — `{ url, type, altText, sourceUrl }`
- `designTokenMetadata` — `{ colorPalette, typography }` from DOM
- `navigation[]` — `{ label, url, isExternal }` from SSM or link fallback
- `homepageScreenshotBase64` — for SiteAnalyzerAgent

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

- `siteMetadata` — colors, fonts, siteType, purpose
- `pageContent` — sanitized text, navigation items with exact URLs
- `stylePreferences` — design direction
- `assetManifest` — categorized images with paths and dimensions
- `screenshotBase64` — homepage screenshot as vision input (first page only)

**Prompt includes**:

- Site metadata (colors, fonts, siteType)
- Navigation links with exact URL paths (e.g., `"About Us" → /about-us`)
- Extracted key content (headings, features, CTAs — quoted verbatim)
- Full sanitized content (first 4000 chars)
- Categorized assets (hero images, logo candidates, feature images)
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

```typescript
interface RebuildWorkflowState {
  appId: string;
  sourceUrl: string;
  rootPath: string; // "/" or "/subpath"
  status:
    | "scraping"
    | "analyzing"
    | "style_questions"
    | "building"
    | "complete"
    | "error";
  scrapingProgress: { total: number; completed: number };
  stylePreferences?: StylePreferences;
  pagesBuilt: string[];
  currentPage: string | null;
  error?: string;
  errorCode?: "import_failed";
}

interface StylePreferences {
  designDirection: "keep-similar" | "modernize" | "simplify" | "bold";
  colorPreference: "keep-original" | "suggest-new" | "custom";
  typographyStyle: "keep-original" | "modern" | "classic" | "playful";
  layoutApproach: "responsive" | "mobile-first" | "desktop-first";
}

interface SiteMetadata {
  siteType: "content" | "app" | "commerce" | "dashboard";
  sitePurpose: string;
  targetAudience: string;
  brandVoice: string;
  designStyle: string;
  colorPalette: { primary: string[]; secondary: string[]; accent: string[] };
  typography: { headingFonts: string[]; bodyFonts: string[] };
}

interface PageContent {
  url: string;
  slug: string;
  title: string;
  sanitizedContent: string;
  structure: {
    hasHeader: boolean;
    hasFooter: boolean;
    hasSidebar: boolean;
    sections: PageSection[];
    navigation: NavigationItem[]; // { label, url, isExternal }
  };
  metadata: PageMetadata;
}

interface AssetInfo {
  url: string;
  localPath: string;
  type: "image" | "font" | "icon" | "other";
  description?: string;
  dimensions?: { width: number; height: number };
  sourcePages: string[];
}
```

---

## Polling Mechanism

The `websiteRebuild` tool polls for background scrape completion:

- **Iterations 0–17**: 400ms interval (~7.2s fast phase)
- **Iterations 18+**: 1500ms interval (slow phase)
- **Max timeout**: 300,000ms (5 minutes)
- **Exits when**: status === `'style_questions'` or `'error'`

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

8. **Max 20 pages** — Hard limit on scraping scope.

9. **Adaptive polling** — Fast then slow to balance responsiveness and CPU.

10. **Parallel analysis** — Site analysis + asset processing run concurrently via `Promise.all`.

11. **Atlas seeds the rebuild root** — `seedPaths: [rootPath]`. For root rebuilds this is `/` (always crawled even when sitemap only contains product pages). For sub-path rebuilds (`/foo`) the source URL itself is the seed; agents post-filters Atlas results to drop any page outside that prefix.

---

## Open Questions

1. **Atlas `seedPaths` semantics**: does Atlas confine the crawl to subpaths of each
   seed, or are seeds only starting URLs? The current adapter assumes the latter and
   post-filters on the agents side. If Atlas already confines, the post-filter is
   redundant. With `useSitemap: true`, sitemap-discovered URLs may pull the crawl
   outside `rootPath` and eat into `maxPages` budget. Pending confirmation from
   the Atlas team. Track in followups.

2. **Screenshot index**: `result.screenshots[0]` is consumed as the homepage
   screenshot. For a root rebuild this is unambiguous. For a sub-path rebuild it is
   not yet verified that index 0 corresponds to the source URL (`/foo`) versus the
   site root (`/`).

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
| `REBUILD_SCRAPE_BATCH_DELAY_MS` | 600                                    | Delay between batches (external API path)                                                                              |
| `REBUILD_SCRAPE_CONCURRENCY`    | 5                                      | Concurrent page scrapes (external API path)                                                                            |
| `WEB_SCRAPER_URL`               | `https://web-scraper.api.int.dev-gdcorp.tools` (dev) | External scraper API base                                                                                |
| `SSO_JWT`                       | —                                      | Auth token for external scraper API                                                                                    |

| Switchboard flag             | Purpose                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `appbuilder-atlas-crawler`   | Per-shopper toggle for the Atlas path. Evaluated in BFF, embedded in agent JWT as `useAtlasCrawler` claim          |

---

## File Inventory

| File                                                     | Purpose                                              |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `agents/src/tools/ai-lib-tools/website-rebuild.ts`       | Entry tool — starts rebuild, polls, triggers handoff |
| `agents/src/tools/ai-lib-tools/rebuild-page-selector.ts` | Page selector tool — show/build modes                |
| `agents/src/services/RebuildOrchestrationService.ts`     | Core orchestration — scrape, analyze, build prompts  |
| `agents/src/services/AtlasCrawlerAdapter.ts`             | Atlas REST integration — submit/poll/results, maps types |
| `agents/src/services/SitemapDiscoveryService.ts`         | Page discovery — sitemap.xml, robots.txt, crawl      |
| `agents/src/services/AssetProcessingService.ts`          | Asset download, categorization, manifest             |
| `agents/src/agents/site-analyzer-agent.ts`               | AI analysis — siteType, colors, fonts, purpose       |
| `agents/src/agents/page-prompt-agent.ts`                 | Prompt generation — homepage vs inner pages          |
| `agents/src/types/rebuild.ts`                            | All TypeScript interfaces for rebuild feature        |
| `agents/src/server/routes/rebuild.ts`                    | API route: `GET /apps/:id/rebuild/pages`             |
| `app/src/.../WebsiteRebuildToolRenderer.tsx`             | Progress/completion UI                               |
| `app/src/.../RebuildPageSelectorToolRenderer.tsx`        | Page selector dropdown UI                            |
| `app/src/.../hooks/useRebuildPages.ts`                   | React Query hook for rebuild pages                   |
| `app/src/.../components/chat/InputActionsPanel.tsx`      | Renders rebuild widget in chat                       |

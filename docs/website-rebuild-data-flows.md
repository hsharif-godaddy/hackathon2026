# Website Rebuild Tool - Data Flows Documentation

## Overview

The website rebuild feature allows users to recreate their existing websites by scraping, analyzing, and generating build prompts. This document describes the complete data flow through the system.

## Architecture Components

### Core Services

- **websiteRebuildAITool** (`src/tools/ai-lib-tools/website-rebuild.ts`): AI tool entry point
- **RebuildOrchestrationService** (`src/services/RebuildOrchestrationService.ts`): Orchestrates rebuild workflow
- **WebsiteScraperDriver** (`src/tools/ai-lib-tools/drivers/website-scraper-driver.ts`): Scrapes website content
- **SitemapDiscoveryService** (`src/services/SitemapDiscoveryService.ts`): Discovers pages to scrape
- **AssetProcessingService** (`src/services/AssetProcessingService.ts`): Downloads and catalogs assets
- **SiteAnalyzerAgent** (`src/agents/site-analyzer-agent.ts`): AI agent that analyzes site metadata
- **PagePromptAgent** (`src/agents/page-prompt-agent.ts`): AI agent that generates build prompts

### Data Storage

All data is stored in: `/tmp/apps/{appId}/.source-site/`

- `workflow-state.json` - Current workflow state
- `site-metadata.json` - Analyzed site metadata
- `sitemap.json` - Discovered pages
- `pages/{slug}.json` - Individual page content
- `screenshots/{slug}.png` - Page screenshots
- `assets/` - Downloaded assets
- `assets/manifest.json` - Asset catalog

---

## Complete Data Flow

### Phase 1: Tool Invocation

**Location**: `website-rebuild.ts:84-108`

**Input**:

```typescript
{
  url: string; // URL to rebuild (e.g., "https://example.com")
}
```

**Context Required**:

- `appId`: Application identifier from context.metadata
- `socketId`: WebSocket connection ID for handoff
- `stateManager`: HandoffStateManager for agent switching

**Process**:

1. Validate app exists in AppRepository
2. Create `RebuildOrchestrationService` instance
3. Start rebuild process
4. Wait for completion (polling with 2s interval, 120s timeout)
5. Apply default style preferences
6. Generate homepage prompt
7. Trigger handoff to develop agent

**Output**:

```typescript
{
  success: boolean;
  message: string;
  sourceUrl: string;
  pagesFound: number;
  pagesScraped: number;
  homepagePrompt: string;
  handoffTriggered: boolean;
}
```

---

### Phase 2: Rebuild Orchestration Start

**Location**: `RebuildOrchestrationService.ts:49-92`

**Process**:

1. Create directory structure:
   - `.source-site/`
   - `.source-site/pages/`
   - `.source-site/screenshots/`

2. Initialize workflow state:

```typescript
{
  appId: string
  sourceUrl: string
  status: 'scraping'
  scrapingProgress: { total: 0, completed: 0 }
  pagesBuilt: []
  currentPage: null
  createdAt: ISO timestamp
  updatedAt: ISO timestamp
}
```

3. Save initial state to `workflow-state.json`
4. Start background scraping task (non-blocking)
5. Return initial state immediately

---

### Phase 3: Sitemap Discovery

**Location**: `SitemapDiscoveryService.ts:48-130`

**Process**:

1. **Canonical URL Resolution** (lines 59-65):
   - Follow redirects to find final URL
   - Example: `example.com` → `www.example.com`

2. **Sitemap Discovery Priority**:
   - Check `/sitemap.xml` at canonical URL (lines 68-74)
   - If not found, parse `/robots.txt` for sitemap URLs (lines 78-79)
   - Fallback to crawling homepage for links (lines 96-103)

3. **Sitemap Parsing** (lines 237-272):
   - Detect sitemap type (index vs urlset)
   - Extract page URLs with metadata:
     - `url`: Page URL
     - `priority`: SEO priority (0.0-1.0)
     - `changefreq`: Update frequency
     - `lastmod`: Last modification date
     - `source`: 'sitemap' | 'robots' | 'crawl'

4. **Page Filtering** (lines 112-131):
   - Filter to homepage and `/about` page only
   - Deduplicate URLs
   - Sort by priority
   - Limit to `maxPages` (default: 20)

**Output**:

```typescript
{
  success: boolean
  pages: DiscoveredPage[]  // URL, priority, source, etc.
  totalPages: number
}
```

---

### Phase 4: Multi-Page Scraping

**Location**: `WebsiteScraperDriver.ts:481-581` & `RebuildOrchestrationService.ts:137-174`

**Process**:

1. **Concurrent Scraping** (batch size: 5 pages):
   - For each page, call `scrapeAndScreenshot()` in parallel
   - Rate limit: 1000ms delay between batches
2. **Individual Page Scraping** (lines 140-255):
   - **Content Scraping** → `/v1/scrape-website` API:
     - Returns: `html`, `sanitizedContent`, `scrapeTime`
     - Sanitized content has clean text, images marked as `--IMAGE--`
   - **Screenshot Capture** → `/v1/screenshot-website` API:
     - Returns: base64-encoded PNG data URI
     - Format: `data:image/png;base64,iVBORw0KG...`

3. **Asset Extraction** (lines 590-717):
   - Parse HTML for assets:
     - `<img src>`, `<img srcset>`, `<img data-src>` (lazy loading)
     - `background-image: url()` in inline styles
     - `<picture><source srcset>`
     - `<link rel="icon">`, fonts (`.woff2`, `.ttf`, `.otf`)
   - Resolve relative URLs to absolute
   - Filter invalid URLs (data URIs, placeholders, templates)
4. **Progress Tracking**:
   - Update `workflow-state.json` with completed count
   - Status transitions: `scraping` → `analyzing`

**Per-Page Output**:

```typescript
{
  url: string
  success: boolean
  sanitizedContent?: string  // Clean text content
  screenshotBase64?: string  // PNG data URI
  html?: string             // Raw HTML for asset extraction
  error?: string
}
```

**Assets Collected**:

```typescript
{
  url: string               // Original asset URL
  type: 'image' | 'font' | 'icon' | 'other'
  altText?: string
  sourceUrl: string         // Page where asset was found
}
```

---

### Phase 5: Data Persistence

**Location**: `RebuildOrchestrationService.ts:197-258`

**Process**:

1. **Create Sitemap** (lines 183-197):

```typescript
// .source-site/sitemap.json
{
  pages: [
    {
      url: string
      slug: string  // URL → slug ("homepage", "about", etc.)
      priority?: number
      changefreq?: string
      lastmod?: string
      source: 'sitemap' | 'robots' | 'crawl'
      scraped: boolean  // Was this page successfully scraped?
    }
  ],
  totalPages: number
  discoveredAt: ISO timestamp
}
```

2. **Save Individual Pages** (lines 205-223, 465-495):

```typescript
// .source-site/pages/{slug}.json
{
  url: string
  slug: string
  title: string           // Extracted from <h1> or <title>
  content: string         // Original sanitized content
  sanitizedContent: string
  structure: {
    hasHeader: boolean
    hasFooter: boolean
    hasSidebar: boolean
    sections: []
    navigation: []
  }
  metadata: { title: string }
  scrapedAt: ISO timestamp
}
```

3. **Save Screenshots** (lines 490-494):
   - Convert base64 to PNG file
   - Save as `.source-site/screenshots/{slug}.png`

---

### Phase 6: Site Analysis

**Location**: `SiteAnalyzerAgent.ts:158-216` & `RebuildOrchestrationService.ts:225-239`

**Input**:

- Homepage sanitized content
- Homepage screenshot (base64)

**Process**:

1. **AI Analysis** (Agent with 0.3 temperature):
   - Analyze content and screenshot
   - Extract brand and design information
   - Generate structured JSON response

2. **Metadata Extraction**:

```typescript
{
  sourceUrl: string
  sitePurpose: string        // What the site does
  targetAudience: string     // Intended users
  brandVoice: string         // Tone (professional, friendly, etc.)
  designStyle: string        // Visual aesthetic
  colorPalette: {
    primary: string[]        // Hex colors
    secondary: string[]
    accent: string[]
  }
  typography: {
    headingFonts: string[]   // Font families
    bodyFonts: string[]
  }
  scrapedAt: ISO timestamp
  version: '1.0'
}
```

3. **Save Metadata** (lines 445-448):
   - Write to `.source-site/site-metadata.json`

---

### Phase 7: Asset Processing

**Location**: `AssetProcessingService.ts` (referenced line 243-254)

**Input**:

- Array of `ExtractedAsset` from scraping
- Map of asset URL → source pages

**Process**:

1. **Download Assets**:
   - Download each unique asset URL
   - Determine asset type from file extension/content-type
   - Capture dimensions for images (via image analysis)
   - Generate local file path in `.source-site/assets/`

2. **Generate Manifest**:

```typescript
// .source-site/assets/manifest.json
{
  assets: [
    {
      url: string              // Original URL
      localPath: string        // Local path in .source-site/assets/
      type: 'image' | 'font' | 'icon' | 'other'
      description?: string     // AI-generated description
      altText?: string
      usageContext?: string
      dimensions?: { width: number, height: number }
      fileSize?: number
      sourcePages: string[]    // Pages using this asset
    }
  ],
  totalAssets: number
  byType: { image: 0, font: 0, icon: 0, other: 0 }
  generatedAt: ISO timestamp
}
```

---

### Phase 8: Style Preferences

**Location**: `RebuildOrchestrationService.ts:286-309` & `website-rebuild.ts:119-120`

**Default Preferences Applied**:

```typescript
{
  designDirection: "keep-similar"; // Let Airo Decide
  colorPreference: "keep-original"; // Let Airo Decide
  typographyStyle: "keep-original"; // Let Airo Decide
  layoutApproach: "responsive"; // Responsive layout
}
```

**Options Available**:

- `designDirection`: 'keep-similar' | 'modernize' | 'simplify' | 'bold'
- `colorPreference`: 'keep-original' | 'suggest-new' | 'custom'
- `typographyStyle`: 'keep-original' | 'modern' | 'classic' | 'playful'
- `layoutApproach`: 'responsive' | 'mobile-first' | 'desktop-first'

**Process**:

1. Update workflow state with preferences
2. Change status: `style_questions` → `building`
3. Save updated state

---

### Phase 9: Page Prompt Generation

**Location**: `PagePromptAgent.ts:240-352` & `RebuildOrchestrationService.ts:318-370`

**Input**:

- `siteMetadata`: Analyzed brand/design info
- `pageContent`: Specific page to build
- `stylePreferences`: User's design choices
- `assetManifest`: Available assets

**Process**:

1. **Load Source Site Data** (lines 502-543):
   - Read site metadata
   - Read sitemap
   - Read all scraped pages
   - Read asset manifest
   - Combine into `SourceSiteData`

2. **Asset Categorization** (lines 556-633):
   - **Hero Images**: 800px+ (suitable for banners)
   - **Logo Candidates**: 100-400px with good proportions
   - **Feature Images**: 300-800px
   - **Small Images/Icons**: <300px
   - Include dimensions and descriptions for each

3. **Content Extraction** (lines 357-405):
   - Extract headings from content
   - Extract hero section (first 800 chars)
   - Extract feature/benefit statements
   - Extract CTA text
   - Extract navigation links

4. **Design Instructions** (lines 409-525):
   - **Color Instructions**:
     - If "keep-original": Agent chooses colors based on brand
     - If "suggest-new": Agent picks fresh colors
     - If "custom": Use user's specified colors
   - **Design Direction**:
     - If "keep-similar": Full redesign guidance (typography, layout, differentiation)
     - If "modernize": Contemporary patterns
     - If "simplify": Minimal design
     - If "bold": Striking, high-contrast design

5. **Prompt Assembly** (lines 282-348):

```
Generate a detailed prompt for building this page...

SITE METADATA:
- Purpose: [extracted purpose]
- Target Audience: [extracted audience]
- Brand Voice: [extracted voice]
...

STYLE PREFERENCES FROM USER:
- Design Direction: [user choice]
- Color Preference: [user choice]
...

[Color instructions]
[Design instructions]

PAGE CONTENT TO REBUILD:
- Title: [page title]
- URL: [page url]

=== EXTRACTED KEY CONTENT ===
[Headings, hero, features, CTAs, navigation]

=== FULL PAGE CONTENT ===
[First 4000 chars of sanitized content]

=== AVAILABLE ASSETS ===
[Categorized assets with dimensions]

**CRITICAL INSTRUCTIONS:**
1. Use actual content from source
2. Preserve key messaging
3. Choose appropriately sized images
4. Reference imported assets
5. Structure prompt for develop agent
```

**Output**:

- Comprehensive build prompt (400-1000 words)
- Includes actual content, design specs, asset references
- Ready for develop agent to execute

---

### Phase 10: Agent Handoff

**Location**: `website-rebuild.ts:131-155`

**Process**:

1. Check for `stateManager` and `socketId`
2. Call `stateManager.switchAgent(socketId, 'develop', homepagePrompt)`
3. Handoff switches active agent to DevelopAgent
4. DevelopAgent receives the generated prompt as initial message
5. DevelopAgent builds the homepage using the prompt

**Handoff Result**:

```typescript
{
  success: true,
  message: "Website analyzed successfully. Handing off to developer...",
  sourceUrl: "https://example.com",
  pagesFound: 20,
  pagesScraped: 2,
  homepagePrompt: "[Generated 800-word prompt]",
  handoffTriggered: true
}
```

---

## State Transitions

```
creating
  ↓
scraping (discovering pages, scraping content)
  ↓
analyzing (extracting metadata, processing assets)
  ↓
style_questions (collecting user preferences) ← SKIPPED (defaults applied)
  ↓
building (generating page prompts)
  ↓
complete | error
```

**Status Locations**: `RebuildOrchestrationService.ts`

- Line 63: Initial status = 'scraping'
- Line 134: Status = 'scraping' (after discovery)
- Line 177: Status = 'analyzing'
- Line 256: Status = 'style_questions'
- Line 291: Status = 'building' (after preferences)

---

## Key Design Patterns

### 1. Async Background Processing

- `startRebuild()` returns immediately (line 74-81)
- `scrapeAndAnalyze()` runs in background
- Tool polls `getStatus()` to check completion

### 2. Parallel Execution

- Scraping + screenshots in parallel per page (line 174-177)
- Batch processing with concurrency limit (5 concurrent requests)
- Rate limiting between batches (1000ms delay)

### 3. Graceful Degradation

- If sitemap fails → try robots.txt
- If robots.txt fails → crawl homepage
- If all scraping fails → throw error (line 161-174)
- Asset extraction failures don't block page processing

### 4. File-Based State

- All state persisted to JSON files
- Enables recovery from crashes
- Allows inspection/debugging of intermediate data

### 5. AI Agent Specialization

- **SiteAnalyzerAgent**: Brand/design analysis only
- **PagePromptAgent**: Prompt generation only
- **DevelopAgent** (handoff target): Code implementation

---

## Data Flow Summary

```
User URL
  ↓
[websiteRebuildAITool] → Validates input, creates service
  ↓
[RebuildOrchestrationService] → Orchestrates workflow
  ↓
[SitemapDiscoveryService] → Discovers pages to scrape
  ↓ (URLs)
[WebsiteScraperDriver] → Scrapes content + screenshots
  ↓ (HTML, content, images, assets)
[RebuildOrchestrationService] → Saves pages, screenshots, sitemap
  ↓
[SiteAnalyzerAgent] → Analyzes homepage → site-metadata.json
  ↓
[AssetProcessingService] → Downloads assets → assets/manifest.json
  ↓
[RebuildOrchestrationService] → Applies style preferences
  ↓
[PagePromptAgent] → Generates build prompt
  ↓
[websiteRebuildAITool] → Triggers handoff to DevelopAgent
  ↓
[DevelopAgent] → Builds the homepage
```

---

## Critical Files Reference

| Purpose           | File Path                                                  | Key Lines |
| ----------------- | ---------------------------------------------------------- | --------- |
| Tool entry        | `src/tools/ai-lib-tools/website-rebuild.ts`                | 84-186    |
| Orchestration     | `src/services/RebuildOrchestrationService.ts`              | 49-600    |
| Scraping          | `src/tools/ai-lib-tools/drivers/website-scraper-driver.ts` | 140-807   |
| Discovery         | `src/services/SitemapDiscoveryService.ts`                  | 48-505    |
| Site analysis     | `src/agents/site-analyzer-agent.ts`                        | 158-216   |
| Prompt generation | `src/agents/page-prompt-agent.ts`                          | 240-638   |
| Type definitions  | `src/types/rebuild.ts`                                     | 1-206     |

---

## Environment Variables

- `SSO_JWT`: Authentication for web scraper API
- `WEB_SCRAPER_BASE_URL`: Override base URL (default: `https://web-scraper.api.int.test-gdcorp.tools`)
- `WEB_SCRAPER_APP_KEY`: App identification (default: `airo-app-builder`)

---

## Error Handling

1. **Tool Level** (`website-rebuild.ts:167-184`):
   - Catches all errors from service
   - Returns structured error response
   - Logs error details

2. **Service Level** (`RebuildOrchestrationService.ts:265-276`):
   - Updates workflow state to 'error'
   - Stores error message in state
   - Allows status polling to discover errors

3. **Driver Level** (`WebsiteScraperDriver.ts:245-254`):
   - Wraps API errors with context
   - Returns success/error structure
   - Logs all failures

4. **Multi-Page Resilience** (lines 506-554):
   - Individual page failures don't stop batch
   - Collects both successful and failed results
   - Returns overall success if any pages succeed

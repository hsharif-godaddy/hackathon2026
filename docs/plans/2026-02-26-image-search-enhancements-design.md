# Image Search Service Enhancements Design

**Date:** 2026-02-26
**Status:** Approved

## Goal

Improve image quality from the agent's media selection by:

1. Expanding Getty filter support across all layers (Go service, TypeScript agent, debug console)
2. Adding an optional agent path through the image search service (vs direct Getty)
3. Building an eval harness to compare direct-Getty vs image-search-service results

## Architecture

Two agent paths for image search, switchable for comparison:

```
Path A (current - direct Getty):
  findMedia() → GettyMediaDriver → Getty proxy → Getty API

Path B (new - image search service):
  findMedia() → ImageSearchServiceDriver → Go service → Qdrant semantic search + Getty backfill
```

Toggle: `IMAGE_SEARCH_USE_SERVICE` env var sets default, per-request `useService` param overrides.

## Unified Filter Set

One combined filter set used across all APIs. Getty-native filters form the base; the service adds analysis-enriched filters that provide value beyond what Getty offers.

### Getty-native filters (base)

| Filter          | Type          | Values                                                                                                                                                                                                               |
| --------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| orientations    | multi-select  | horizontal, vertical, square, panoramic_horizontal, panoramic_vertical                                                                                                                                               |
| compositions    | multi-select  | abstract, candid, close_up, copy_space, cut_out, full_frame, full_length, headshot, looking_at_camera, macro, medium_shot, part_of_a_series, portrait, sparse, still_life, three_quarter_length, waist_up, wide_shot |
| moods           | multi-select  | dramatic, bold, vivid, warm, cool, natural, black_and_white                                                                                                                                                          |
| graphicalStyles | multi-select  | photography, illustration, fine_art, vector                                                                                                                                                                          |
| numberOfPeople  | multi-select  | none, one, two, group                                                                                                                                                                                                |
| ethnicity       | multi-select  | black, white, east_asian, hispanic_latinx, japanese, middle_eastern, multiracial_person, multiethnic_group, native_american_first_nations, pacific_islander, south_asian, southeast_asian                            |
| ageOfPeople     | multi-select  | newborn, baby, child, teenager, young_adult, adult, adults_only, mature_adult, senior_adult                                                                                                                          |
| minimumSize     | single-select | x_small, small, medium, large, x_large, xx_large, vector                                                                                                                                                             |
| sortOrder       | single-select | best_match, most_popular, newest, random                                                                                                                                                                             |
| color           | hex string    | e.g. "#FF0000"                                                                                                                                                                                                       |

### Analysis-enriched filters (service adds)

| Filter            | Type         | Values                                                                                                                  |
| ----------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| subjectCategory   | multi-select | person, people, animal, nature, technology, food, architecture, vehicle, product, abstract, workspace, lifestyle, other |
| copySpaceAmount   | multi-select | none, minimal, moderate, high                                                                                           |
| copySpaceLocation | multi-select | left, right, top, bottom, center, top-left, top-right, bottom-left, bottom-right, none, multiple                        |
| usageContext      | multi-select | hero, banner, background, product, profile, thumbnail, icon, content, testimonial, gallery, general                     |
| backgroundType    | multi-select | solid, gradient, blurred, detailed, transparent, pattern, natural, complex                                              |
| visualComplexity  | multi-select | minimal, low, moderate, high, very-high                                                                                 |
| tone              | multi-select | professional, casual, serious, playful, energetic, calm, dramatic, inspiring, luxurious, friendly, neutral              |
| peopleFocus       | multi-select | none, background, secondary, primary                                                                                    |

## Workstream 1: Go Image Search Service

### A. ImageAnalysis model expansion (`pkg/models/analysis.go`)

Add Getty metadata fields captured from Getty API responses:

```go
// Getty metadata (populated from Getty search results)
Orientation    string   `json:"orientation,omitempty"`
GraphicalStyle string   `json:"graphicalStyle,omitempty"`
Moods          []string `json:"moods,omitempty"`
NumberOfPeople string   `json:"numberOfPeople,omitempty"`
Ethnicity      []string `json:"ethnicity,omitempty"`
AgeOfPeople    []string `json:"ageOfPeople,omitempty"`
CollectionCode string   `json:"collectionCode,omitempty"`
Artist         string   `json:"artist,omitempty"`
GettyKeywords  []string `json:"gettyKeywords,omitempty"`
```

### B. Getty metadata capture (`internal/search/orchestrator.go`)

In `analyzeAndStore()`, populate the new fields from the Getty `ImageResult` response. The Getty response already includes orientation, graphical_style, keywords, etc. — we just need to extract and store them.

### C. Qdrant storage expansion (`internal/storage/qdrant/client.go`)

- Add new fields to `analysisToPayload()`
- Add keyword indexes in `EnsureCollection()`:
  ```go
  // New Getty metadata indexes
  "orientation",
  "graphicalStyle",
  "moods",
  "numberOfPeople",
  "ethnicity",
  "ageOfPeople",
  ```

### D. Unified SearchFilters (`pkg/models/api.go`)

Replace current `SearchFilters` with unified set:

```go
type SearchFilters struct {
    // Getty-native filters
    Orientations    []string `json:"orientations,omitempty"`
    Compositions    []string `json:"compositions,omitempty"`
    Moods           []string `json:"moods,omitempty"`
    GraphicalStyles []string `json:"graphicalStyles,omitempty"`
    NumberOfPeople  []string `json:"numberOfPeople,omitempty"`
    Ethnicity       []string `json:"ethnicity,omitempty"`
    AgeOfPeople     []string `json:"ageOfPeople,omitempty"`
    MinimumSize     string   `json:"minimumSize,omitempty"`
    SortOrder       string   `json:"sortOrder,omitempty"`
    Color           string   `json:"color,omitempty"`

    // Analysis-enriched filters
    SubjectCategory   []string `json:"subjectCategory,omitempty"`
    CopySpaceAmount   []string `json:"copySpaceAmount,omitempty"`
    CopySpaceLocation []string `json:"copySpaceLocation,omitempty"`
    UsageContext      []string `json:"usageContext,omitempty"`
    BackgroundType    []string `json:"backgroundType,omitempty"`
    VisualComplexity  []string `json:"visualComplexity,omitempty"`
    Tone              []string `json:"tone,omitempty"`
    PeopleFocus       []string `json:"peopleFocus,omitempty"`
}
```

### E. Filter mapping in Qdrant (`buildFilters()`)

Add new conditions for Getty metadata fields. Both Getty-native and analysis filters applied together as Qdrant `Must` conditions.

### F. Orchestrator backfill (`internal/search/orchestrator.go`)

Change `o.getty.Search()` calls to `o.getty.SearchWithOptions()`, mapping the unified filters to `getty.SearchOptions`:

```go
opts := getty.NewSearchOptions(params.Query)
opts.PageSize = params.Count * 2
opts.Orientations = mapToOrientations(params.Filters.Orientations)
opts.Compositions = mapToCompositions(params.Filters.Compositions)
opts.Moods = mapToMoods(params.Filters.Moods)
// ... etc for all Getty-native filters
```

This means Getty backfill queries use the same filters the user specified, producing more relevant candidates for analysis and caching.

## Workstream 2: TypeScript Agent Layer

### A. New `ImageSearchServiceDriver`

New file: `agents/src/tools/ai-lib-tools/drivers/image-search-service-driver.ts`

- HTTP client calling the Go service at `IMAGE_SEARCH_SERVICE_URL` (env var)
- Accepts the unified filter set
- Returns results in the same `GettyMediaResult` format as `GettyMediaDriver`
- Maps image search service response (with analysis metadata) back to the common format

### B. `GettyMediaDriver` expansion

Expand `GettyMediaOptions` with all Getty filters:

```typescript
export interface GettyMediaOptions {
  phrase: string;
  page?: number;
  pageSize?: number;
  sortOrder?: string;
  // Existing
  graphicalStyles?: string;
  orientations?: string;
  compositions?: string;
  color?: string;
  // New Getty filters
  moods?: string[];
  numberOfPeople?: string[];
  ethnicity?: string[];
  ageOfPeople?: string[];
  minimumSize?: string;
}
```

Fix `convertToGettyFormat()` to support multiple values (append multiple query params instead of taking only the first).

### C. `MediaSearchOptions` tiered params

```typescript
export interface MediaSearchOptions {
  prompt: string | string[];
  mediaType?: MediaType;
  count?: number;
  useService?: boolean; // per-request toggle

  // Core filters (top-level for LLM)
  orientations?: string[];
  compositions?: string[];
  moods?: string[];
  graphicalStyles?: string[];
  sortOrder?: string;
  color?: string;

  // Advanced filters (nested object)
  advancedFilters?: {
    numberOfPeople?: string[];
    ethnicity?: string[];
    ageOfPeople?: string[];
    minimumSize?: string;
    subjectCategory?: string[];
    copySpaceAmount?: string[];
    usageContext?: string[];
    backgroundType?: string[];
    visualComplexity?: string[];
    tone?: string[];
    peopleFocus?: string[];
  };

  // For image generation
  appId?: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
  filename?: string;
}
```

### D. Routing logic in `MediaSearchTool`

```typescript
private getDriver(useService?: boolean): GettyMediaDriver | ImageSearchServiceDriver {
  const envDefault = process.env.IMAGE_SEARCH_USE_SERVICE === 'true';
  const shouldUseService = useService ?? envDefault;

  if (shouldUseService) {
    return new ImageSearchServiceDriver();
  }
  return new GettyMediaDriver();
}
```

### E. LLM tool schema update

Update the Zod schema that defines the tool for the LLM with the new filter params and clear descriptions so the agent knows when to use each filter.

## Workstream 3: Debug Console

### A. Replace filter panel (`ImageSearchPanel.tsx`)

Replace current 10 semantic categories with the unified filter set:

**Getty-native filters (primary section):**

- Orientation, Composition, Mood, Style, People, Ethnicity, Age — multi-select chip buttons
- Sort — single-select dropdown
- Min Size — single-select dropdown
- Color — hex input field

**Analysis-enriched filters (secondary section):**

- Subject Category, Copy Space, Usage Context, Background, Visual Complexity, Tone, People Focus — multi-select chip buttons

### B. API request

Single `filters` object sent to `/api/image-search`, containing both Getty and analysis filter fields.

## Workstream 4: Eval Script

### A. Location

`image-search-service/eval/`

### B. Test scenarios

JSON file with 10-15 site-building prompts:

```json
[
  {
    "name": "restaurant",
    "prompt": "Build a restaurant website",
    "expectedNeeds": ["food photos", "interior shots", "hero with copy space"],
    "suggestedFilters": {
      "compositions": ["copy_space"],
      "subjectCategory": ["food"]
    }
  }
]
```

### C. Dual-path runner

For each scenario:

1. Simulate agent filter selection (or use suggestedFilters)
2. Run Path A: direct Getty via `GettyMediaDriver` with filters
3. Run Path B: image search service via `ImageSearchServiceDriver` with same filters
4. Collect results from both paths

### D. LLM-as-judge scoring

Use Haiku to score:

- **Filter quality** (0-10): Are the selected filters appropriate for this site type?
- **Image relevance** (0-10): Does each returned image fit the site context?

### E. Output

- Per-scenario comparison table
- Aggregate stats (mean relevance, filter usage patterns)
- JSON report at `eval/results/YYYY-MM-DD-run.json`
- Run via: `pnpm --filter image-search-service eval`

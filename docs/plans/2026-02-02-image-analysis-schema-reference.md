# Image Analysis Schema Reference

> **Source:** Tuned during Phase 0 evaluation. This defines all fields returned by image analysis.

## Field Categories

### Subject Focus (4 fields from Haiku)

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `primarySubject` | string | - | SPECIFIC description (e.g., "golden retriever puppy sitting on grass", NOT just "dog") |
| `subjectCategory` | enum | person, people, animal, nature, technology, food, architecture, vehicle, product, abstract, workspace, lifestyle, other | Broad category |
| `activity` | enum | working, meeting, presenting, relaxing, exercising, eating, traveling, celebrating, creating, communicating, shopping, learning, playing, static, none | Action depicted |
| `settingType` | enum | office, home, outdoor, studio, restaurant, retail, urban, nature, industrial, medical, educational, abstract, other | Environment type |

### Color (3 fields - 2 Haiku, 1 programmatic)

| Field | Type | Values | Source | Description |
|-------|------|--------|--------|-------------|
| `textSafeColors` | enum | light-only, dark-only, either, neither | Haiku | What text colors would be readable |
| `backgroundType` | enum | solid, gradient, blurred, detailed, transparent, pattern, natural, complex | Haiku | Background characteristics |
| `dominantColors` | array[3] | hex codes | **Programmatic** | Top 3 colors extracted via node-vibrant or similar |
| `colorMood` | enum | warm, cool, neutral, vibrant, muted | **Derived** | Derived from dominantColors |

### Composition (4 fields from Haiku)

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `composition` | enum | left, right, center, top, bottom, top-left, top-right, bottom-left, bottom-right, full-frame, scattered | WHERE visual interest is positioned |
| `copySpaceLocation` | enum | left, right, top, bottom, center, top-left, top-right, bottom-left, bottom-right, none, multiple | SINGLE best location for text overlay |
| `copySpaceAmount` | enum | none, minimal, moderate, high | Amount of empty space for text |
| `visualComplexity` | enum | minimal, low, moderate, high, very-high | Overall visual busyness |

### People (2 fields from Haiku)

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `peopleCount` | enum | 0, 1, 2-3, 4+ | Number of people visible |
| `peopleFocus` | enum | none, background, secondary, primary | How prominently people feature (INDEPENDENT of count) |

### Mood (1 field from Haiku)

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `tone` | array[1-3] | professional, casual, serious, playful, energetic, calm, dramatic, inspiring, luxurious, friendly, neutral | Emotional tones (pick 1-3) |

### Usage (1 field from Haiku)

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `usageContext` | array[1-3] | hero, banner, background, product, profile, thumbnail, icon, content, testimonial, gallery, general | Suitable content types (pick 1-3) |

### Style (2 fields - 1 Haiku, 1 programmatic)

| Field | Type | Values | Source | Description |
|-------|------|--------|--------|-------------|
| `authenticityStyle` | enum | stock, editorial, candid, artistic, documentary | Haiku | Visual style/authenticity feel |
| `aspectRatioCategory` | enum | square, landscape, portrait, panoramic, vertical-banner | **Programmatic** | Calculated from dimensions |

### Content (2 fields from Haiku)

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | 2-3 sentence detailed description |
| `searchTerms` | array[10-15] | Keywords/phrases for search (subjects, emotions, activities, use cases, synonyms) |

---

## Complete Go Struct

```go
// ImageAnalysis is the complete analysis for an image
type ImageAnalysis struct {
    // Core identification
    GettyID    string          `json:"gettyId"`
    Title      string          `json:"title"`
    Caption    string          `json:"caption,omitempty"`
    Dimensions ImageDimensions `json:"dimensions"`
    URLs       ImageURLs       `json:"urls"`

    // Subject Focus (Haiku)
    PrimarySubject  string `json:"primarySubject"`
    SubjectCategory string `json:"subjectCategory"`
    Activity        string `json:"activity"`
    SettingType     string `json:"settingType"`

    // Color (Mixed - programmatic + Haiku)
    DominantColors []string `json:"dominantColors"` // Programmatic
    ColorMood      string   `json:"colorMood"`      // Derived from colors
    TextSafeColors string   `json:"textSafeColors"` // Haiku
    BackgroundType string   `json:"backgroundType"` // Haiku

    // Composition (Haiku)
    Composition       string `json:"composition"`
    CopySpaceLocation string `json:"copySpaceLocation"`
    CopySpaceAmount   string `json:"copySpaceAmount"`
    VisualComplexity  string `json:"visualComplexity"`

    // People (Haiku)
    PeopleCount string `json:"peopleCount"`
    PeopleFocus string `json:"peopleFocus"`

    // Mood & Style (Haiku)
    Tone              []string `json:"tone"`              // Array of 1-3
    UsageContext      []string `json:"usageContext"`      // Array of 1-3
    AuthenticityStyle string   `json:"authenticityStyle"`

    // Programmatic
    AspectRatioCategory string `json:"aspectRatioCategory"`

    // Content (Haiku)
    Description string   `json:"description"`
    SearchTerms []string `json:"searchTerms"` // 10-15 keywords

    // Metadata
    AnalyzedAt      time.Time `json:"analyzedAt"`
    AnalysisVersion string    `json:"analysisVersion"`

    // Vector embedding (for Qdrant, not JSON serialized)
    Embedding []float32 `json:"-"`
}
```

---

## Qdrant Payload Schema

All fields stored as payload in Qdrant `image_analyses` collection:

```json
{
  "gettyId": "123456789",
  "title": "Business team meeting",
  "caption": "...",
  "width": 5000,
  "height": 3333,
  "thumbnailUrl": "...",
  "previewUrl": "...",
  "highResUrl": "...",

  "primarySubject": "four colleagues around conference table",
  "subjectCategory": "people",
  "activity": "meeting",
  "settingType": "office",

  "dominantColors": ["#2C3E50", "#ECF0F1", "#3498DB"],
  "colorMood": "cool",
  "textSafeColors": "either",
  "backgroundType": "complex",

  "composition": "center",
  "copySpaceLocation": "none",
  "copySpaceAmount": "low",
  "visualComplexity": "moderate",

  "peopleCount": "4+",
  "peopleFocus": "primary",

  "tone": ["professional", "friendly"],
  "usageContext": ["hero", "content"],
  "authenticityStyle": "stock",
  "aspectRatioCategory": "landscape",

  "description": "Four diverse business professionals discussing around a modern conference table...",
  "searchTerms": ["business meeting", "team collaboration", "corporate", "office", "professionals", "diverse team", "conference room", "teamwork", "discussion", "workplace"],

  "analyzedAt": "2026-02-02T10:30:00Z",
  "analysisVersion": "1"
}
```

---

## Embedding Strategy

**Text to embed:** Concatenate `primarySubject` + `description` + `activity` + `settingType` + `searchTerms.join(" ")`

**Model:** `text-embedding-3-small` (1536 dimensions)

**Normalization:** Normalize to unit vector for cosine similarity

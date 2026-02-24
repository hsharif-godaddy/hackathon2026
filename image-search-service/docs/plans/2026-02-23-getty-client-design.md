# Getty Client Design: Full API Parameter Support

**Date:** 2026-02-23
**Status:** Approved
**Author:** Claude + jeichorn

## Overview

Redesign the Go Getty client in `image-search-service` to support all 33+ Getty API query parameters and all 36 response fields, matching full parity with the `getty-images-api-proxy`.

## Goals

1. Support all Getty API parameters for precise image filtering at source
2. Extract all available response fields for analysis enrichment
3. Maintain backward compatibility with existing `Search(query, count)` usage
4. Provide type-safe enums with IDE autocomplete
5. Handle API drift gracefully (new fields/values from Getty)

## Non-Goals

- Video search support (images only for now)
- Direct Getty API access (continue using proxy)
- Code generation from proxy spec

## File Structure

```
internal/getty/
├── auth.go        # (existing) AuthProvider interface, BearerTokenAuth, SSOJWTAuth
├── client.go      # Client struct with Search(), SearchWithOptions(), GetByID()
├── options.go     # SearchOptions struct - all 33 query parameters
├── types.go       # Typed string enums - Orientation, Composition, Mood, etc.
├── response.go    # Full response structs - ImageResult with all 36 fields
└── url.go         # URL building logic extracted for testability
```

## Type System

### Open Enum Pattern

Typed strings that accept any value for forward compatibility:

```go
type Orientation string

const (
    OrientationHorizontal          Orientation = "horizontal"
    OrientationVertical            Orientation = "vertical"
    OrientationSquare              Orientation = "square"
    OrientationPanoramicHorizontal Orientation = "panoramic_horizontal"
    OrientationPanoramicVertical   Orientation = "panoramic_vertical"
)

// Unknown values still work - forward compatible
opts.Orientations = []Orientation{"future_value"}
```

### Enum Types

| Type           | Values    |
| -------------- | --------- |
| Orientation    | 5 values  |
| Composition    | 18 values |
| GraphicalStyle | 4 values  |
| Mood           | 7 values  |
| NumberOfPeople | 4 values  |
| Ethnicity      | 12 values |
| AgeOfPeople    | 42 values |
| SortOrder      | 4 values  |
| MinimumSize    | 7 values  |
| FileType       | 2 values  |
| FacetField     | 2 values  |
| Field          | 36 values |
| Market         | 46 values |
| FilterType     | 2 values  |

## SearchOptions Struct

All 33 configurable parameters organized by category:

```go
type SearchOptions struct {
    // Required
    Phrase string

    // Pagination
    Page     int
    PageSize int

    // Locale & Region
    AcceptLanguage string
    GICountryCode  string
    Market         Market

    // Sort & Search Behavior
    SortOrder      SortOrder
    EnhancedSearch *bool

    // Content Filters
    GraphicalStyles           []GraphicalStyle
    GraphicalStylesFilterType FilterType
    FileTypes                 []FileType
    MinimumSize               MinimumSize
    Color                     string
    EmbedContentOnly          *bool

    // Composition & Style
    Compositions []Composition
    Orientations []Orientation
    Moods        []Mood

    // People & Demographics
    AgeOfPeople    []AgeOfPeople
    NumberOfPeople []NumberOfPeople
    Ethnicity      []Ethnicity

    // Collection & Product
    Artists               string
    CollectionCodes       []string
    CollectionsFilterType FilterType
    DownloadProduct       string

    // Keyword Filters
    KeywordIDs        []int
    ExcludeKeywordIDs []int

    // Faceting
    FacetFields   []FacetField
    FacetMaxCount int
    IncludeFacets *bool

    // Response Control
    Fields []Field

    // Safety (defaults applied if nil)
    ExcludeEditorialUseOnly *bool
    ExcludeNudity           *bool
    SafeSearch              *bool
    IncludeRelatedSearches  *bool
}
```

## Response Structs

### ImageResult (36 fields)

```go
type ImageResult struct {
    // Core
    ID, Title, Caption, Copyright, URI string

    // Dimensions
    MaxDimensions *Dimensions
    DisplaySizes  []DisplaySize
    Orientation   string

    // Classification
    AssetFamily, GraphicalStyle, ColorType string

    // Licensing
    LicenseModel string
    AllowedUse   *AllowedUse
    ProductTypes []ProductType

    // Collection
    CollectionID, CollectionCode, CollectionName, IStockCollection string

    // Creator & Dates
    Artist, DateCreated, DateSubmitted, DateCameraShot string

    // Metadata
    Keywords       []Keyword
    AlternativeIDs []AltID
    QualityRank    int

    // Download
    DownloadSizes    []DownloadSize
    LargestDownloads []Download
    CallForImage     bool

    // Catch-all for future fields
    Extra map[string]any
}
```

### SearchResponse

```go
type SearchResponse struct {
    ResultCount     int
    Images          []ImageResult
    RelatedSearches []RelatedSearch
    Facets          []Facet
}
```

## Client API

### Backward Compatible

```go
// Existing method preserved - calls SearchWithOptions internally
func (c *Client) Search(ctx context.Context, query string, count int) ([]ImageResult, error)

// Existing method preserved
func (c *Client) GetByID(ctx context.Context, gettyID string) (*ImageResult, error)
```

### New Full-Featured Method

```go
// New method with full parameter control
func (c *Client) SearchWithOptions(ctx context.Context, opts *SearchOptions) (*SearchResponse, error)

// Constructor with sensible defaults
func NewSearchOptions(phrase string) *SearchOptions
```

## URL Building

Extracted to `url.go` for testability:

```go
func BuildSearchURL(baseURL string, opts *SearchOptions) string
```

Key behaviors:

- Required: `phrase`
- Defaults applied: `page=1`, `pageSize=50`, `sortOrder=best_match`
- Safety defaults: `excludeNudity=true`, `safeSearch=true`, `excludeEditorialUseOnly=true`
- Market overrides `acceptLanguage` + `giCountryCode` when set
- Empty slices omitted from URL
- Pointer bools distinguish unset vs explicit false

## Drift Handling

1. **Unknown enum values**: Typed strings accept any value
2. **Unknown response fields**: `Extra map[string]any` catches new fields
3. **Observability**: Log unknown fields at debug level
4. **Update cadence**: Add new known values when seen in logs

## Backward Compatibility

```go
// Type alias for existing code
type SearchResult = ImageResult

// Helper methods on ImageResult
func (r *ImageResult) GettyID() string
func (r *ImageResult) Thumbnail() string
func (r *ImageResult) Preview() string
```

## Usage Examples

### Simple (existing pattern)

```go
results, err := client.Search(ctx, "business meeting", 10)
```

### Advanced (new capability)

```go
opts := getty.NewSearchOptions("business meeting")
opts.PageSize = 20
opts.Orientations = []getty.Orientation{getty.OrientationHorizontal}
opts.Compositions = []getty.Composition{getty.CompositionCopySpace}
opts.NumberOfPeople = []getty.NumberOfPeople{getty.NumberOfPeopleTwo}
opts.Fields = []getty.Field{
    getty.FieldDisplaySet,
    getty.FieldMaxDimensions,
    getty.FieldKeywords,
    getty.FieldGraphicalStyle,
    getty.FieldArtist,
}

resp, err := client.SearchWithOptions(ctx, opts)
for _, img := range resp.Images {
    fmt.Println(img.ID, img.Keywords, img.GraphicalStyle)
}
```

## Testing Strategy

1. **Unit tests for URL building**: Verify all parameters serialized correctly
2. **Unit tests for response parsing**: Verify all fields extracted
3. **Integration tests**: Verify against real proxy (existing pattern)
4. **Backward compatibility tests**: Ensure existing Search() behavior unchanged

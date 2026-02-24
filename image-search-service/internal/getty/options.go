package getty

// SearchOptions contains all configurable parameters for Getty image search.
// All fields are optional except Phrase. Zero values are omitted from the API request.
type SearchOptions struct {
	// Required
	Phrase string

	// Pagination
	Page     int // Default: 1
	PageSize int // Default: 50, max: 100

	// Locale & Region
	AcceptLanguage string // Default: "en-US"
	GICountryCode  string // Default: "USA"
	Market         Market // Overrides AcceptLanguage and GICountryCode if set

	// Sort & Search Behavior
	SortOrder      SortOrder // Default: best_match
	EnhancedSearch *bool     // Default: true

	// Content Filters
	GraphicalStyles           []GraphicalStyle
	GraphicalStylesFilterType FilterType // "include" or "exclude"
	FileTypes                 []FileType
	MinimumSize               MinimumSize
	Color                     string // Hex color e.g. "#002244"
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
	Artists               string // Comma-separated
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
	Fields []Field // Which fields to include in response

	// Safety (defaults applied during URL building if nil)
	ExcludeEditorialUseOnly *bool // Default: true
	ExcludeNudity           *bool // Default: true
	SafeSearch              *bool // Default: true
	IncludeRelatedSearches  *bool // Default: false
}

// NewSearchOptions creates SearchOptions with sensible defaults.
func NewSearchOptions(phrase string) *SearchOptions {
	return &SearchOptions{
		Phrase:   phrase,
		Page:     1,
		PageSize: 50,
	}
}

// BoolPtr is a helper to create a pointer to a bool value.
func BoolPtr(b bool) *bool {
	return &b
}

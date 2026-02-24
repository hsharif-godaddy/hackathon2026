package getty

import (
	"net/url"
	"testing"
)

// parseURL is a test helper that parses a URL and returns the query values.
func parseURL(t *testing.T, rawURL string) url.Values {
	t.Helper()
	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("Failed to parse URL: %v", err)
	}
	return u.Query()
}

func TestBuildSearchURLMinimal(t *testing.T) {
	opts := &SearchOptions{
		Phrase: "sunset beach",
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	// Verify path
	u, _ := url.Parse(result)
	if u.Path != "/v1/search" {
		t.Errorf("Expected path /v1/search, got %s", u.Path)
	}

	// Required phrase
	if got := q.Get("phrase"); got != "sunset beach" {
		t.Errorf("Expected phrase 'sunset beach', got '%s'", got)
	}

	// Pagination defaults
	if got := q.Get("page"); got != "1" {
		t.Errorf("Expected page '1', got '%s'", got)
	}
	if got := q.Get("pageSize"); got != "50" {
		t.Errorf("Expected pageSize '50', got '%s'", got)
	}

	// Locale defaults (when market not set)
	if got := q.Get("acceptLanguage"); got != "en-US" {
		t.Errorf("Expected acceptLanguage 'en-US', got '%s'", got)
	}
	if got := q.Get("giCountryCode"); got != "USA" {
		t.Errorf("Expected giCountryCode 'USA', got '%s'", got)
	}

	// Sort default
	if got := q.Get("sortOrder"); got != "best_match" {
		t.Errorf("Expected sortOrder 'best_match', got '%s'", got)
	}

	// Safety defaults
	if got := q.Get("safeSearch"); got != "true" {
		t.Errorf("Expected safeSearch 'true', got '%s'", got)
	}
	if got := q.Get("excludeNudity"); got != "true" {
		t.Errorf("Expected excludeNudity 'true', got '%s'", got)
	}
	if got := q.Get("excludeEditorialUseOnly"); got != "true" {
		t.Errorf("Expected excludeEditorialUseOnly 'true', got '%s'", got)
	}
	if got := q.Get("enhancedSearch"); got != "true" {
		t.Errorf("Expected enhancedSearch 'true', got '%s'", got)
	}
	if got := q.Get("includeRelatedSearches"); got != "false" {
		t.Errorf("Expected includeRelatedSearches 'false', got '%s'", got)
	}
}

func TestBuildSearchURLWithFilters(t *testing.T) {
	opts := &SearchOptions{
		Phrase:         "business meeting",
		Orientations:   []Orientation{OrientationHorizontal, OrientationVertical},
		Compositions:   []Composition{CompositionHeadshot, CompositionPortrait},
		NumberOfPeople: []NumberOfPeople{NumberOfPeopleOne, NumberOfPeopleTwo},
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	// Orientations should be added as multiple values
	orientations := q["orientations"]
	if len(orientations) != 2 {
		t.Errorf("Expected 2 orientations, got %d", len(orientations))
	}
	if orientations[0] != "horizontal" || orientations[1] != "vertical" {
		t.Errorf("Expected orientations [horizontal, vertical], got %v", orientations)
	}

	// Compositions
	compositions := q["compositions"]
	if len(compositions) != 2 {
		t.Errorf("Expected 2 compositions, got %d", len(compositions))
	}
	if compositions[0] != "headshot" || compositions[1] != "portrait" {
		t.Errorf("Expected compositions [headshot, portrait], got %v", compositions)
	}

	// NumberOfPeople
	numPeople := q["numberOfPeople"]
	if len(numPeople) != 2 {
		t.Errorf("Expected 2 numberOfPeople, got %d", len(numPeople))
	}
	if numPeople[0] != "one" || numPeople[1] != "two" {
		t.Errorf("Expected numberOfPeople [one, two], got %v", numPeople)
	}
}

func TestBuildSearchURLWithMarket(t *testing.T) {
	opts := &SearchOptions{
		Phrase:         "flowers",
		Market:         MarketDeDE,
		AcceptLanguage: "en-US", // Should be ignored
		GICountryCode:  "USA",   // Should be ignored
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	// Market should be set
	if got := q.Get("market"); got != "de-DE" {
		t.Errorf("Expected market 'de-DE', got '%s'", got)
	}

	// AcceptLanguage and giCountryCode should NOT be set when market is present
	if q.Get("acceptLanguage") != "" {
		t.Errorf("Expected acceptLanguage to be empty when market is set, got '%s'", q.Get("acceptLanguage"))
	}
	if q.Get("giCountryCode") != "" {
		t.Errorf("Expected giCountryCode to be empty when market is set, got '%s'", q.Get("giCountryCode"))
	}
}

func TestBuildSearchURLWithoutMarket(t *testing.T) {
	opts := &SearchOptions{
		Phrase:         "mountains",
		AcceptLanguage: "fr-FR",
		GICountryCode:  "FRA",
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	// Market should not be set
	if q.Get("market") != "" {
		t.Errorf("Expected market to be empty, got '%s'", q.Get("market"))
	}

	// AcceptLanguage and giCountryCode should be set
	if got := q.Get("acceptLanguage"); got != "fr-FR" {
		t.Errorf("Expected acceptLanguage 'fr-FR', got '%s'", got)
	}
	if got := q.Get("giCountryCode"); got != "FRA" {
		t.Errorf("Expected giCountryCode 'FRA', got '%s'", got)
	}
}

func TestBuildSearchURLWithColor(t *testing.T) {
	opts := &SearchOptions{
		Phrase: "abstract",
		Color:  "#002244",
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	if got := q.Get("color"); got != "#002244" {
		t.Errorf("Expected color '#002244', got '%s'", got)
	}
}

func TestBuildSearchURLWithKeywordIDs(t *testing.T) {
	opts := &SearchOptions{
		Phrase:            "nature",
		KeywordIDs:        []int{123, 456, 789},
		ExcludeKeywordIDs: []int{999, 888},
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	// KeywordIDs
	keywords := q["keywordIds"]
	if len(keywords) != 3 {
		t.Errorf("Expected 3 keywordIds, got %d", len(keywords))
	}
	if keywords[0] != "123" || keywords[1] != "456" || keywords[2] != "789" {
		t.Errorf("Expected keywordIds [123, 456, 789], got %v", keywords)
	}

	// ExcludeKeywordIDs
	excludeKeywords := q["excludeKeywordIds"]
	if len(excludeKeywords) != 2 {
		t.Errorf("Expected 2 excludeKeywordIds, got %d", len(excludeKeywords))
	}
	if excludeKeywords[0] != "999" || excludeKeywords[1] != "888" {
		t.Errorf("Expected excludeKeywordIds [999, 888], got %v", excludeKeywords)
	}
}

func TestBuildSearchURLWithExplicitBools(t *testing.T) {
	// Test that explicit false values override defaults
	opts := &SearchOptions{
		Phrase:                  "test",
		SafeSearch:              BoolPtr(false),
		ExcludeNudity:           BoolPtr(false),
		ExcludeEditorialUseOnly: BoolPtr(false),
		EnhancedSearch:          BoolPtr(false),
		IncludeRelatedSearches:  BoolPtr(true), // Override default false
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	if got := q.Get("safeSearch"); got != "false" {
		t.Errorf("Expected safeSearch 'false', got '%s'", got)
	}
	if got := q.Get("excludeNudity"); got != "false" {
		t.Errorf("Expected excludeNudity 'false', got '%s'", got)
	}
	if got := q.Get("excludeEditorialUseOnly"); got != "false" {
		t.Errorf("Expected excludeEditorialUseOnly 'false', got '%s'", got)
	}
	if got := q.Get("enhancedSearch"); got != "false" {
		t.Errorf("Expected enhancedSearch 'false', got '%s'", got)
	}
	if got := q.Get("includeRelatedSearches"); got != "true" {
		t.Errorf("Expected includeRelatedSearches 'true', got '%s'", got)
	}
}

func TestBuildSearchURLWithFields(t *testing.T) {
	opts := &SearchOptions{
		Phrase: "cars",
		Fields: []Field{FieldID, FieldTitle, FieldDisplaySizes, FieldKeywords},
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	fields := q["fields"]
	if len(fields) != 4 {
		t.Errorf("Expected 4 fields, got %d", len(fields))
	}
	expected := []string{"id", "title", "display_sizes", "keywords"}
	for i, f := range expected {
		if fields[i] != f {
			t.Errorf("Expected field[%d] '%s', got '%s'", i, f, fields[i])
		}
	}
}

func TestBuildSearchURLWithFacets(t *testing.T) {
	opts := &SearchOptions{
		Phrase:        "wildlife",
		FacetFields:   []FacetField{FacetFieldArtists, FacetFieldLocations},
		FacetMaxCount: 25,
		IncludeFacets: BoolPtr(true),
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	// FacetFields
	facetFields := q["facetFields"]
	if len(facetFields) != 2 {
		t.Errorf("Expected 2 facetFields, got %d", len(facetFields))
	}
	if facetFields[0] != "artists" || facetFields[1] != "locations" {
		t.Errorf("Expected facetFields [artists, locations], got %v", facetFields)
	}

	// FacetMaxCount
	if got := q.Get("facetMaxCount"); got != "25" {
		t.Errorf("Expected facetMaxCount '25', got '%s'", got)
	}

	// IncludeFacets
	if got := q.Get("includeFacets"); got != "true" {
		t.Errorf("Expected includeFacets 'true', got '%s'", got)
	}
}

func TestBuildSearchURLEncodesSpecialChars(t *testing.T) {
	opts := &SearchOptions{
		Phrase: "cats & dogs",
		Color:  "#FF0000",
	}

	result := BuildSearchURL("https://proxy.example.com", opts)

	// The URL should be properly encoded
	// Check that it can be parsed back
	u, err := url.Parse(result)
	if err != nil {
		t.Fatalf("Failed to parse URL: %v", err)
	}

	q := u.Query()
	if got := q.Get("phrase"); got != "cats & dogs" {
		t.Errorf("Expected phrase 'cats & dogs', got '%s'", got)
	}

	// Verify the raw query contains encoded values
	if u.RawQuery == "" {
		t.Error("Expected RawQuery to be non-empty")
	}

	// The ampersand should be encoded as %26 in the raw query
	// (url.Parse will decode it when we access via Query())
}

func TestBuildSearchURLWithAllContentFilters(t *testing.T) {
	opts := &SearchOptions{
		Phrase:                    "food",
		GraphicalStyles:           []GraphicalStyle{GraphicalStylePhotography, GraphicalStyleVector},
		GraphicalStylesFilterType: FilterTypeInclude,
		FileTypes:                 []FileType{FileTypeJPG, FileTypeEPS},
		MinimumSize:               MinimumSizeLarge,
		EmbedContentOnly:          BoolPtr(true),
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	// GraphicalStyles
	styles := q["graphicalStyles"]
	if len(styles) != 2 {
		t.Errorf("Expected 2 graphicalStyles, got %d", len(styles))
	}
	if styles[0] != "photography" || styles[1] != "vector" {
		t.Errorf("Expected graphicalStyles [photography, vector], got %v", styles)
	}

	// GraphicalStylesFilterType
	if got := q.Get("graphicalStylesFilterType"); got != "include" {
		t.Errorf("Expected graphicalStylesFilterType 'include', got '%s'", got)
	}

	// FileTypes
	fileTypes := q["fileTypes"]
	if len(fileTypes) != 2 {
		t.Errorf("Expected 2 fileTypes, got %d", len(fileTypes))
	}

	// MinimumSize
	if got := q.Get("minimumSize"); got != "large" {
		t.Errorf("Expected minimumSize 'large', got '%s'", got)
	}

	// EmbedContentOnly
	if got := q.Get("embedContentOnly"); got != "true" {
		t.Errorf("Expected embedContentOnly 'true', got '%s'", got)
	}
}

func TestBuildSearchURLWithPeopleFilters(t *testing.T) {
	opts := &SearchOptions{
		Phrase:      "family",
		AgeOfPeople: []AgeOfPeople{AgeOfPeopleChild, AgeOfPeopleAdult},
		Ethnicity:   []Ethnicity{EthnicityMultiethnicGroup},
		Moods:       []Mood{MoodNatural, MoodWarm},
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	// AgeOfPeople
	ages := q["ageOfPeople"]
	if len(ages) != 2 {
		t.Errorf("Expected 2 ageOfPeople, got %d", len(ages))
	}
	if ages[0] != "child" || ages[1] != "adult" {
		t.Errorf("Expected ageOfPeople [child, adult], got %v", ages)
	}

	// Ethnicity
	ethnicities := q["ethnicity"]
	if len(ethnicities) != 1 {
		t.Errorf("Expected 1 ethnicity, got %d", len(ethnicities))
	}
	if ethnicities[0] != "multiethnic_group" {
		t.Errorf("Expected ethnicity [multiethnic_group], got %v", ethnicities)
	}

	// Moods
	moods := q["moods"]
	if len(moods) != 2 {
		t.Errorf("Expected 2 moods, got %d", len(moods))
	}
}

func TestBuildSearchURLWithCollectionFilters(t *testing.T) {
	opts := &SearchOptions{
		Phrase:                "sports",
		Artists:               "john doe, jane smith",
		CollectionCodes:       []string{"ABC", "XYZ"},
		CollectionsFilterType: FilterTypeExclude,
		DownloadProduct:       "premium",
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	// Artists
	if got := q.Get("artists"); got != "john doe, jane smith" {
		t.Errorf("Expected artists 'john doe, jane smith', got '%s'", got)
	}

	// CollectionCodes
	collections := q["collectionCodes"]
	if len(collections) != 2 {
		t.Errorf("Expected 2 collectionCodes, got %d", len(collections))
	}
	if collections[0] != "ABC" || collections[1] != "XYZ" {
		t.Errorf("Expected collectionCodes [ABC, XYZ], got %v", collections)
	}

	// CollectionsFilterType
	if got := q.Get("collectionsFilterType"); got != "exclude" {
		t.Errorf("Expected collectionsFilterType 'exclude', got '%s'", got)
	}

	// DownloadProduct
	if got := q.Get("downloadProduct"); got != "premium" {
		t.Errorf("Expected downloadProduct 'premium', got '%s'", got)
	}
}

func TestBuildSearchURLWithPagination(t *testing.T) {
	opts := &SearchOptions{
		Phrase:   "architecture",
		Page:     5,
		PageSize: 25,
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	if got := q.Get("page"); got != "5" {
		t.Errorf("Expected page '5', got '%s'", got)
	}
	if got := q.Get("pageSize"); got != "25" {
		t.Errorf("Expected pageSize '25', got '%s'", got)
	}
}

func TestBuildSearchURLWithSortOrder(t *testing.T) {
	opts := &SearchOptions{
		Phrase:    "trending",
		SortOrder: SortOrderNewest,
	}

	result := BuildSearchURL("https://proxy.example.com", opts)
	q := parseURL(t, result)

	if got := q.Get("sortOrder"); got != "newest" {
		t.Errorf("Expected sortOrder 'newest', got '%s'", got)
	}
}

func TestBuildSearchURLInvalidBaseURL(t *testing.T) {
	opts := &SearchOptions{
		Phrase: "test",
	}

	// Invalid URL should return empty string
	result := BuildSearchURL("://invalid", opts)
	if result != "" {
		t.Errorf("Expected empty string for invalid base URL, got '%s'", result)
	}
}

func TestBuildSearchURLWithExistingPath(t *testing.T) {
	opts := &SearchOptions{
		Phrase: "test",
	}

	// Base URL with existing path should be overwritten
	result := BuildSearchURL("https://proxy.example.com/old/path", opts)
	u, _ := url.Parse(result)

	if u.Path != "/v1/search" {
		t.Errorf("Expected path '/v1/search', got '%s'", u.Path)
	}
}

// Package getty provides URL building for Getty Images API search requests.
package getty

import (
	"log/slog"
	"net/url"
	"strconv"
)

// searchPath is the Getty proxy search endpoint path.
const searchPath = "/v1/search"

// BuildSearchURL constructs the Getty proxy search URL from options.
// Returns empty string if baseURL is invalid or opts is nil.
func BuildSearchURL(baseURL string, opts *SearchOptions) string {
	if opts == nil {
		slog.Error("getty.url.build.error", "error", "opts cannot be nil")
		return ""
	}

	u, err := url.Parse(baseURL)
	if err != nil {
		slog.Error("getty.url.build.error", "error", err, "baseURL", baseURL)
		return ""
	}

	u.Path = searchPath
	q := u.Query()

	// Required
	q.Set("phrase", opts.Phrase)

	// Pagination with defaults
	q.Set("page", strconv.Itoa(coalesceInt(opts.Page, 1)))
	q.Set("pageSize", strconv.Itoa(coalesceInt(opts.PageSize, 50)))

	// Locale - market overrides individual settings
	if opts.Market != "" {
		q.Set("market", string(opts.Market))
	} else {
		q.Set("acceptLanguage", coalesceString(opts.AcceptLanguage, "en-US"))
		q.Set("giCountryCode", coalesceString(opts.GICountryCode, "USA"))
	}

	// Sort
	if opts.SortOrder != "" {
		q.Set("sortOrder", string(opts.SortOrder))
	} else {
		q.Set("sortOrder", string(SortOrderBestMatch))
	}

	// Safety defaults (applied if nil, overridable if explicitly set)
	setBoolWithDefault(q, "enhancedSearch", opts.EnhancedSearch, true)
	setBoolWithDefault(q, "excludeEditorialUseOnly", opts.ExcludeEditorialUseOnly, true)
	setBoolWithDefault(q, "excludeNudity", opts.ExcludeNudity, true)
	setBoolWithDefault(q, "safeSearch", opts.SafeSearch, true)
	setBoolWithDefault(q, "includeRelatedSearches", opts.IncludeRelatedSearches, false)

	// Content Filters
	addStringSlice(q, "graphicalStyles", opts.GraphicalStyles)
	if opts.GraphicalStylesFilterType != "" {
		q.Set("graphicalStylesFilterType", string(opts.GraphicalStylesFilterType))
	}
	addStringSlice(q, "fileTypes", opts.FileTypes)
	if opts.MinimumSize != "" {
		q.Set("minimumSize", string(opts.MinimumSize))
	}
	if opts.Color != "" {
		q.Set("color", opts.Color)
	}
	setBoolIfSet(q, "embedContentOnly", opts.EmbedContentOnly)

	// Composition & Style
	addStringSlice(q, "compositions", opts.Compositions)
	addStringSlice(q, "orientations", opts.Orientations)
	addStringSlice(q, "moods", opts.Moods)

	// People & Demographics
	addStringSlice(q, "ageOfPeople", opts.AgeOfPeople)
	addStringSlice(q, "numberOfPeople", opts.NumberOfPeople)
	addStringSlice(q, "ethnicity", opts.Ethnicity)

	// Collection & Product
	if opts.Artists != "" {
		q.Set("artists", opts.Artists)
	}
	addStrings(q, "collectionCodes", opts.CollectionCodes)
	if opts.CollectionsFilterType != "" {
		q.Set("collectionsFilterType", string(opts.CollectionsFilterType))
	}
	if opts.DownloadProduct != "" {
		q.Set("downloadProduct", opts.DownloadProduct)
	}

	// Keyword Filters
	addInts(q, "keywordIds", opts.KeywordIDs)
	addInts(q, "excludeKeywordIds", opts.ExcludeKeywordIDs)

	// Faceting
	addStringSlice(q, "facetFields", opts.FacetFields)
	if opts.FacetMaxCount > 0 {
		q.Set("facetMaxCount", strconv.Itoa(opts.FacetMaxCount))
	}
	setBoolIfSet(q, "includeFacets", opts.IncludeFacets)

	// Response Control
	addStringSlice(q, "fields", opts.Fields)

	u.RawQuery = q.Encode()
	return u.String()
}

// Helper functions

func coalesceInt(val, def int) int {
	if val == 0 {
		return def
	}
	return val
}

func coalesceString(val, def string) string {
	if val == "" {
		return def
	}
	return val
}

func setBoolWithDefault(q url.Values, key string, val *bool, def bool) {
	if val != nil {
		q.Set(key, strconv.FormatBool(*val))
	} else {
		q.Set(key, strconv.FormatBool(def))
	}
}

func setBoolIfSet(q url.Values, key string, val *bool) {
	if val != nil {
		q.Set(key, strconv.FormatBool(*val))
	}
}

// addStringSlice adds typed string slice values to query params.
func addStringSlice[T ~string](q url.Values, key string, values []T) {
	for _, v := range values {
		q.Add(key, string(v))
	}
}

// addStrings adds string slice values to query params.
func addStrings(q url.Values, key string, values []string) {
	for _, v := range values {
		q.Add(key, v)
	}
}

// addInts adds int slice values to query params.
func addInts(q url.Values, key string, values []int) {
	for _, v := range values {
		q.Add(key, strconv.Itoa(v))
	}
}

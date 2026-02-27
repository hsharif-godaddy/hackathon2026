// Package models defines the data structures for image analysis.
package models

// SearchFilters for narrowing search results.
// Getty-native filters are passed through to Getty API during backfill.
// Analysis-enriched filters are applied during Qdrant vector search.
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
	PeopleCount       []string `json:"peopleCount,omitempty"`
	PeopleFocus       []string `json:"peopleFocus,omitempty"`
	Tone              []string `json:"tone,omitempty"`
	CopySpaceAmount   []string `json:"copySpaceAmount,omitempty"`
	CopySpaceLocation []string `json:"copySpaceLocation,omitempty"`
	ColorMood         []string `json:"colorMood,omitempty"`
	Composition       []string `json:"composition,omitempty"`
	UsageContext      []string `json:"usageContext,omitempty"`
	BackgroundType    []string `json:"backgroundType,omitempty"`
	VisualComplexity  []string `json:"visualComplexity,omitempty"`
}

// SearchRequest is the POST body for /api/v1/search
type SearchRequest struct {
	Query           string        `json:"query"`
	Count           int           `json:"count,omitempty"`
	Filters         SearchFilters `json:"filters,omitempty"`
	MinCachedResult int           `json:"minCachedResults,omitempty"`
	MaxWaitSeconds  int           `json:"maxWaitSeconds,omitempty"`
}

// SearchResult is a single image in search results
type SearchResult struct {
	GettyID        string                 `json:"gettyId"`
	URLs           ImageURLs              `json:"urls"`
	RelevanceScore float32                `json:"relevanceScore"`
	Analysis       *ImageAnalysisResponse `json:"analysis,omitempty"`
	FromCache      bool                   `json:"fromCache"`
}

// ImageAnalysisResponse is the subset of analysis returned in search results
type ImageAnalysisResponse struct {
	PrimarySubject    string   `json:"primarySubject"`
	SubjectCategory   string   `json:"subjectCategory"`
	Activity          string   `json:"activity"`
	Composition       string   `json:"composition"`
	CopySpaceLocation string   `json:"copySpaceLocation"`
	CopySpaceAmount   string   `json:"copySpaceAmount"`
	Tone              []string `json:"tone"`
	PeopleCount       string   `json:"peopleCount"`
	DominantColors    []string `json:"dominantColors"`
}

// SearchMeta provides metadata about the search operation
type SearchMeta struct {
	Total           int  `json:"total"`
	Cached          int  `json:"cached"`
	Analyzed        int  `json:"analyzed"`
	Filtered        int  `json:"filtered"`
	Complete        bool `json:"complete"`
	PendingAnalysis int  `json:"pendingAnalysis"`
}

// SearchResponse is the full response for /api/v1/search
type SearchResponse struct {
	Results []SearchResult `json:"results"`
	Meta    SearchMeta     `json:"meta"`
}

// BatchLookupRequest for /api/v1/images/batch
type BatchLookupRequest struct {
	GettyIDs []string `json:"gettyIds"`
}

// BatchLookupResponse for /api/v1/images/batch
type BatchLookupResponse struct {
	Images  map[string]*ImageAnalysis `json:"images"`
	Missing []string                  `json:"missing,omitempty"`
}

// HealthResponse for /api/v1/health
type HealthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

// StatsResponse for /api/v1/stats
type StatsResponse struct {
	QueueDepth    int     `json:"queueDepth"`
	CacheHitRate  float64 `json:"cacheHitRate"`
	TotalSearches int64   `json:"totalSearches"`
	TotalAnalyzed int64   `json:"totalAnalyzed"`
	GettyPoolBusy int     `json:"gettyPoolBusy"`
	HaikuPoolBusy int     `json:"haikuPoolBusy"`
}

// ErrorResponse for API errors
type ErrorResponse struct {
	Error   string `json:"error"`
	Code    string `json:"code,omitempty"`
	Details string `json:"details,omitempty"`
}

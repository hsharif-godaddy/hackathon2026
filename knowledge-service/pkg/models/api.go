package models

// SearchRequest is the POST body for /api/v1/search.
type SearchRequest struct {
	Query   string        `json:"query"`
	TopN    int           `json:"topN,omitempty"`
	Filters SearchFilters `json:"filters,omitempty"`
}

// SearchFilters for narrowing search results.
type SearchFilters struct {
	DocNames []string `json:"docNames,omitempty"`
	Tags     []string `json:"tags,omitempty"`
}

// SearchResult is a single chunk in search results.
type SearchResult struct {
	DocName     string  `json:"docName"`
	SectionPath string  `json:"sectionPath"`
	Content     string  `json:"content"`
	Score       float32 `json:"score"`
	ChunkIndex  int     `json:"chunkIndex"`
}

// SearchMeta provides metadata about the search operation.
type SearchMeta struct {
	Total            int    `json:"total"`
	Query            string `json:"query"`
	SearchDurationMs int64  `json:"searchDurationMs"`
}

// SearchResponse is the full response for /api/v1/search.
type SearchResponse struct {
	Results []SearchResult `json:"results"`
	Meta    SearchMeta     `json:"meta"`
}

// IngestRequest is the POST body for /api/v1/ingest.
type IngestRequest struct {
	Documents []IngestDocument `json:"documents"`
}

// IngestDocument is a single document in an ingest request.
type IngestDocument struct {
	Name    string   `json:"name"`
	Content string   `json:"content"`
	Tags    []string `json:"tags,omitempty"`
}

// IngestResult is the result of ingesting a single document.
type IngestResult struct {
	DocName       string `json:"docName"`
	ChunksCreated int    `json:"chunksCreated"`
	ChunksUpdated int    `json:"chunksUpdated"`
	ChunksDeleted int    `json:"chunksDeleted"`
	Status        string `json:"status"`
}

// IngestResponse is the full response for /api/v1/ingest.
type IngestResponse struct {
	Results         []IngestResult `json:"results"`
	TotalDurationMs int64          `json:"totalDurationMs"`
}

// HealthResponse for /api/v1/health.
type HealthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
	Qdrant  string `json:"qdrant"`
}

// StatsResponse for /api/v1/stats.
type StatsResponse struct {
	Collection    string `json:"collection"`
	PointCount    uint64 `json:"pointCount"`
	DocumentCount uint64 `json:"documentCount"`
	IndexStatus   string `json:"indexStatus"`
	LastIngestAt  string `json:"lastIngestAt,omitempty"`
}

// ErrorResponse for API errors.
type ErrorResponse struct {
	Error   string `json:"error"`
	Code    string `json:"code,omitempty"`
	Details string `json:"details,omitempty"`
}

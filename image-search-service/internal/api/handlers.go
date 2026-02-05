package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/gorilla/mux"

	"github.com/airo-ai-builder/image-search-service/internal/search"
	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

// handleHealth returns the health status of the service.
func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	resp := models.HealthResponse{
		Status:  "ok",
		Version: s.version,
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleStats returns service statistics.
func (s *Server) handleStats(w http.ResponseWriter, _ *http.Request) {
	var gettyBusy, haikuBusy int

	if s.getty != nil {
		gettyBusy, _ = s.getty.Stats()
	}

	if s.analysis != nil {
		haikuBusy, _ = s.analysis.Stats()
	}

	resp := models.StatsResponse{
		GettyPoolBusy: gettyBusy,
		HaikuPoolBusy: haikuBusy,
		// TODO: Populate other stats when tracking is implemented
		QueueDepth:    0,
		CacheHitRate:  0,
		TotalSearches: 0,
		TotalAnalyzed: 0,
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleSearch performs a semantic image search.
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	// Check required orchestrator
	if s.orchestrator == nil {
		writeError(w, http.StatusServiceUnavailable, "service not initialized", "orchestrator not available")
		return
	}

	// Limit request body size
	const maxBodySize = 1 << 20 // 1MB
	r.Body = http.MaxBytesReader(w, r.Body, maxBodySize)

	var req models.SearchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return
	}

	// Validate query
	if req.Query == "" {
		writeError(w, http.StatusBadRequest, "query is required", "")
		return
	}

	// Apply defaults
	if req.Count <= 0 {
		req.Count = 10
	}
	if req.MinCachedResult <= 0 {
		req.MinCachedResult = s.config.DefaultMinCached
	}
	if req.MaxWaitSeconds <= 0 {
		req.MaxWaitSeconds = s.config.DefaultMaxWaitSecs
	}

	// Execute hybrid search
	result, err := s.orchestrator.Search(r.Context(), search.SearchParams{
		Query:          req.Query,
		Count:          req.Count,
		Filters:        req.Filters,
		MinCached:      req.MinCachedResult,
		MaxWaitSeconds: req.MaxWaitSeconds,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed", err.Error())
		return
	}

	// Build search results
	results := make([]models.SearchResult, 0, len(result.Results))
	for _, analysis := range result.Results {
		searchResult := models.SearchResult{
			GettyID:        analysis.GettyID,
			URLs:           analysis.URLs,
			RelevanceScore: analysis.RelevanceScore,
			FromCache:      true,
			Analysis: &models.ImageAnalysisResponse{
				PrimarySubject:    analysis.PrimarySubject,
				SubjectCategory:   string(analysis.SubjectCategory),
				Activity:          string(analysis.Activity),
				Composition:       string(analysis.Composition),
				CopySpaceLocation: string(analysis.CopySpaceLocation),
				CopySpaceAmount:   string(analysis.CopySpaceAmount),
				Tone:              analysis.Tone,
				PeopleCount:       string(analysis.PeopleCount),
				DominantColors:    analysis.DominantColors,
			},
		}
		results = append(results, searchResult)
	}

	resp := models.SearchResponse{
		Results: results,
		Meta: models.SearchMeta{
			Total:           len(results),
			Cached:          result.CachedCount,
			Analyzed:        result.AnalyzedCount,
			Filtered:        0, // TODO: Track filtered count
			Complete:        result.Complete,
			PendingAnalysis: result.PendingAnalysis,
		},
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleGetImage retrieves a single image analysis by Getty ID.
func (s *Server) handleGetImage(w http.ResponseWriter, r *http.Request) {
	// Check required clients
	if s.qdrant == nil {
		writeError(w, http.StatusServiceUnavailable, "service not initialized", "qdrant client not available")
		return
	}

	vars := mux.Vars(r)
	gettyID := vars["gettyId"]

	if gettyID == "" {
		writeError(w, http.StatusBadRequest, "gettyId is required", "")
		return
	}

	analyses, err := s.qdrant.GetByIDs(r.Context(), []string{gettyID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get image", err.Error())
		return
	}

	analysis, found := analyses[gettyID]
	if !found {
		writeError(w, http.StatusNotFound, "image not found", "")
		return
	}

	writeJSON(w, http.StatusOK, analysis)
}

// handleBatchLookup retrieves multiple image analyses by Getty IDs.
func (s *Server) handleBatchLookup(w http.ResponseWriter, r *http.Request) {
	// Check required clients
	if s.qdrant == nil {
		writeError(w, http.StatusServiceUnavailable, "service not initialized", "qdrant client not available")
		return
	}

	// Limit request body size
	const maxBodySize = 1 << 20 // 1MB
	r.Body = http.MaxBytesReader(w, r.Body, maxBodySize)

	var req models.BatchLookupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return
	}

	if len(req.GettyIDs) == 0 {
		writeError(w, http.StatusBadRequest, "gettyIds is required", "")
		return
	}

	analyses, err := s.qdrant.GetByIDs(r.Context(), req.GettyIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get images", err.Error())
		return
	}

	// Determine missing IDs
	var missing []string
	for _, id := range req.GettyIDs {
		if _, found := analyses[id]; !found {
			missing = append(missing, id)
		}
	}

	resp := models.BatchLookupResponse{
		Images:  analyses,
		Missing: missing,
	}
	writeJSON(w, http.StatusOK, resp)
}

// writeJSON writes a JSON response with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("json.encode.failed", "error", err)
	}
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, status int, message, details string) {
	resp := models.ErrorResponse{
		Error:   message,
		Details: details,
	}
	writeJSON(w, status, resp)
}

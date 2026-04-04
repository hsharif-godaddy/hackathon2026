package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/airo-ai-builder/knowledge-service/pkg/models"
)

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	resp := models.HealthResponse{
		Status:  "ok",
		Version: s.config.Version,
		Qdrant:  "ok",
	}

	if err := s.qdrant.HealthCheck(r.Context()); err != nil {
		resp.Status = "degraded"
		resp.Qdrant = "error"
		slog.Warn("health.qdrant.failed", "error", err)
		writeJSON(w, http.StatusServiceUnavailable, resp)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.qdrant.GetCollectionStats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get stats", "STATS_ERROR")
		return
	}

	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	var req models.SearchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "INVALID_REQUEST")
		return
	}

	if req.Query == "" {
		writeError(w, http.StatusBadRequest, "query is required", "MISSING_QUERY")
		return
	}

	resp, err := s.searcher.Search(r.Context(), req)
	if err != nil {
		slog.Error("search.failed", "query", req.Query, "error", err)
		writeError(w, http.StatusInternalServerError, "search failed", "SEARCH_ERROR")
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleIngest(w http.ResponseWriter, r *http.Request) {
	var req models.IngestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "INVALID_REQUEST")
		return
	}

	if len(req.Documents) == 0 {
		writeError(w, http.StatusBadRequest, "at least one document is required", "MISSING_DOCUMENTS")
		return
	}

	// Ensure the collection exists before ingesting — guards against Qdrant
	// restarts or Raft sync gaps where some nodes lose the collection.
	if err := s.qdrant.EnsureCollection(r.Context()); err != nil {
		slog.Error("ingest.ensure_collection.failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, "qdrant collection unavailable", "QDRANT_ERROR")
		return
	}

	resp, err := s.pipeline.IngestDocuments(r.Context(), req.Documents, req.Force)
	if err != nil {
		slog.Error("ingest.failed", "error", err)
		writeError(w, http.StatusInternalServerError, "ingestion failed", "INGEST_ERROR")
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleDropCollection(w http.ResponseWriter, r *http.Request) {
	if err := s.qdrant.DropCollection(r.Context()); err != nil {
		slog.Error("collection.drop.failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to drop collection", "DROP_ERROR")
		return
	}

	// Recreate with new schema immediately so the service is ready for re-ingest.
	if err := s.qdrant.EnsureCollection(r.Context()); err != nil {
		slog.Error("collection.recreate.failed", "error", err)
		writeError(w, http.StatusInternalServerError, "collection dropped but recreation failed", "RECREATE_ERROR")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "message": "collection dropped and recreated"})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("http.response.encode.failed", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, message, code string) {
	writeJSON(w, status, models.ErrorResponse{
		Error: message,
		Code:  code,
	})
}

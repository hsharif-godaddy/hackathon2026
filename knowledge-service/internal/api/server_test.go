package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/airo-ai-builder/knowledge-service/internal/auth"
	"github.com/airo-ai-builder/knowledge-service/internal/config"
	"github.com/airo-ai-builder/knowledge-service/pkg/models"
)

func TestWriteJSON(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusOK, map[string]string{"hello": "world"})

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected application/json, got %q", ct)
	}
}

func TestWriteError(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, "bad request", "BAD_REQUEST")

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}

	var errResp models.ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if errResp.Error != "bad request" {
		t.Errorf("expected 'bad request', got %q", errResp.Error)
	}
	if errResp.Code != "BAD_REQUEST" {
		t.Errorf("expected 'BAD_REQUEST', got %q", errResp.Code)
	}
}

func TestHandleSearch_EmptyQuery(t *testing.T) {
	cfg := &config.Config{
		AuthType: "none",
		Version:  "test",
	}
	s := &Server{
		config:         cfg,
		authMiddleware: auth.NewMiddleware("none", "", "", "", ""),
	}
	s.setupRoutes()

	body := `{"query":""}`
	req := httptest.NewRequest("POST", "/api/v1/search", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	s.router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty query, got %d", w.Code)
	}
}

func TestHandleIngest_EmptyDocuments(t *testing.T) {
	cfg := &config.Config{
		AuthType:     "none",
		IngestAPIKey: "test-key",
		Version:      "test",
	}
	s := &Server{
		config:         cfg,
		authMiddleware: auth.NewMiddleware("none", "", "", "", ""),
	}
	s.setupRoutes()

	body := `{"documents":[]}`
	req := httptest.NewRequest("POST", "/api/v1/ingest", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", "test-key")
	w := httptest.NewRecorder()

	s.router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty documents, got %d", w.Code)
	}
}

func TestHandleSearch_InvalidJSON(t *testing.T) {
	cfg := &config.Config{
		AuthType: "none",
		Version:  "test",
	}
	s := &Server{
		config:         cfg,
		authMiddleware: auth.NewMiddleware("none", "", "", "", ""),
	}
	s.setupRoutes()

	req := httptest.NewRequest("POST", "/api/v1/search", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	s.router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid JSON, got %d", w.Code)
	}
}

func TestLoggingMiddleware(t *testing.T) {
	handler := loggingMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

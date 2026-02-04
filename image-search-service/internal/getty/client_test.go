// Package getty provides a client for interacting with the Getty Images API.
package getty

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/airo-ai-builder/image-search-service/internal/config"
)

func TestBuildSearchURL(t *testing.T) {
	baseURL := "https://proxy.example.com"
	query := "business meeting"
	count := 10

	url := buildSearchURL(baseURL, query, count)

	if url == "" {
		t.Error("expected non-empty URL")
	}

	// Check that query parameters are set correctly
	if !strings.Contains(url, "phrase=business+meeting") {
		t.Errorf("expected URL to contain phrase parameter, got %s", url)
	}
	if !strings.Contains(url, "pageSize=10") {
		t.Errorf("expected URL to contain pageSize parameter, got %s", url)
	}
	if !strings.Contains(url, "/v1/search") {
		t.Errorf("expected URL to contain /v1/search path, got %s", url)
	}
}

func TestBuildSearchURL_InvalidBaseURL(t *testing.T) {
	url := buildSearchURL("://invalid", "query", 10)
	if url != "" {
		t.Errorf("expected empty URL for invalid base URL, got %s", url)
	}
}

func TestParseSearchResponse(t *testing.T) {
	// Mock Getty API response
	responseJSON := `{
		"result_count": 2,
		"images": [
			{
				"id": "123456789",
				"title": "Business meeting",
				"display_sizes": [
					{"name": "thumb", "uri": "https://example.com/thumb.jpg"},
					{"name": "preview", "uri": "https://example.com/preview.jpg"}
				],
				"max_dimensions": {"width": 5000, "height": 3333}
			}
		]
	}`

	results, err := parseSearchResponse([]byte(responseJSON))
	if err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	if len(results) != 1 {
		t.Errorf("expected 1 result, got %d", len(results))
	}

	if results[0].GettyID != "123456789" {
		t.Errorf("expected getty ID 123456789, got %s", results[0].GettyID)
	}

	if results[0].Title != "Business meeting" {
		t.Errorf("expected title 'Business meeting', got %s", results[0].Title)
	}

	if results[0].Width != 5000 {
		t.Errorf("expected width 5000, got %d", results[0].Width)
	}

	if results[0].Height != 3333 {
		t.Errorf("expected height 3333, got %d", results[0].Height)
	}

	if results[0].Thumbnail != "https://example.com/thumb.jpg" {
		t.Errorf("expected thumbnail URL, got %s", results[0].Thumbnail)
	}

	if results[0].Preview != "https://example.com/preview.jpg" {
		t.Errorf("expected preview URL, got %s", results[0].Preview)
	}
}

func TestParseSearchResponse_MultipleImages(t *testing.T) {
	responseJSON := `{
		"result_count": 2,
		"images": [
			{"id": "111", "title": "First"},
			{"id": "222", "title": "Second"}
		]
	}`

	results, err := parseSearchResponse([]byte(responseJSON))
	if err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	if len(results) != 2 {
		t.Errorf("expected 2 results, got %d", len(results))
	}

	if results[0].GettyID != "111" {
		t.Errorf("expected first ID 111, got %s", results[0].GettyID)
	}

	if results[1].GettyID != "222" {
		t.Errorf("expected second ID 222, got %s", results[1].GettyID)
	}
}

func TestParseSearchResponse_EmptyImages(t *testing.T) {
	responseJSON := `{"result_count": 0, "images": []}`

	results, err := parseSearchResponse([]byte(responseJSON))
	if err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	if len(results) != 0 {
		t.Errorf("expected 0 results, got %d", len(results))
	}
}

func TestParseSearchResponse_InvalidJSON(t *testing.T) {
	_, err := parseSearchResponse([]byte("invalid json"))
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestParseSingleImageResponse(t *testing.T) {
	responseJSON := `{
		"images": [
			{
				"id": "987654321",
				"title": "Single Image",
				"caption": "Test caption",
				"display_sizes": [
					{"name": "thumb", "uri": "https://example.com/single-thumb.jpg"},
					{"name": "preview", "uri": "https://example.com/single-preview.jpg"}
				],
				"max_dimensions": {"width": 4000, "height": 2666}
			}
		]
	}`

	result, err := parseSingleImageResponse([]byte(responseJSON))
	if err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	if result == nil {
		t.Fatal("expected non-nil result")
	}

	if result.GettyID != "987654321" {
		t.Errorf("expected getty ID 987654321, got %s", result.GettyID)
	}

	if result.Caption != "Test caption" {
		t.Errorf("expected caption 'Test caption', got %s", result.Caption)
	}
}

func TestParseSingleImageResponse_EmptyImages(t *testing.T) {
	responseJSON := `{"images": []}`

	result, err := parseSingleImageResponse([]byte(responseJSON))
	if err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	if result != nil {
		t.Error("expected nil result for empty images")
	}
}

func TestClient_Search(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request - check Bearer token auth
		authHeader := r.Header.Get("Authorization")
		if authHeader != "Bearer test-token" {
			t.Errorf("expected Authorization header 'Bearer test-token', got '%s'", authHeader)
		}

		if r.Header.Get("x-app-key") != "test-app-key" {
			t.Errorf("expected x-app-key header 'test-app-key', got '%s'", r.Header.Get("x-app-key"))
		}

		if !strings.Contains(r.URL.Path, "/v1/search") {
			t.Errorf("expected /v1/search path, got %s", r.URL.Path)
		}

		// Return mock response
		response := gettySearchResponse{
			ResultCount: 1,
			Images: []gettyImage{
				{
					ID:    "test-123",
					Title: "Test Image",
					DisplaySizes: []gettyDisplaySize{
						{Name: "thumb", URI: "https://example.com/thumb.jpg"},
						{Name: "preview", URI: "https://example.com/preview.jpg"},
					},
					MaxDimensions: gettyDimensions{Width: 3000, Height: 2000},
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	cfg := &config.Config{
		GettyUpstream:     server.URL,
		GettyToken:        "test-token",
		GettyXAppKey:      "test-app-key",
		GettyRateLimitRPS: 10,
		GettyConcurrency:  5,
	}

	client, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}

	results, err := client.Search(context.Background(), "test query", 10)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	if len(results) != 1 {
		t.Errorf("expected 1 result, got %d", len(results))
	}

	if results[0].GettyID != "test-123" {
		t.Errorf("expected getty ID 'test-123', got '%s'", results[0].GettyID)
	}
}

func TestClient_Search_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("Internal Server Error"))
	}))
	defer server.Close()

	cfg := &config.Config{
		GettyUpstream:     server.URL,
		GettyToken:        "test-token",
		GettyXAppKey:      "test-app-key",
		GettyRateLimitRPS: 10,
		GettyConcurrency:  5,
	}

	client, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}

	_, searchErr := client.Search(context.Background(), "test query", 10)
	if searchErr == nil {
		t.Error("expected error for HTTP 500")
	}

	if !strings.Contains(searchErr.Error(), "500") {
		t.Errorf("expected error to mention status 500, got: %v", searchErr)
	}
}

func TestClient_GetByID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// GetByID uses the search endpoint with ID filter via the proxy
		if !strings.Contains(r.URL.Path, "/v1/search") {
			t.Errorf("expected /v1/search path, got %s", r.URL.Path)
		}

		response := struct {
			Images []gettyImage `json:"images"`
		}{
			Images: []gettyImage{
				{
					ID:            "single-123",
					Title:         "Single Test",
					Caption:       "Caption text",
					MaxDimensions: gettyDimensions{Width: 2000, Height: 1500},
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	cfg := &config.Config{
		GettyUpstream:     server.URL,
		GettyToken:        "test-token",
		GettyXAppKey:      "test-app-key",
		GettyRateLimitRPS: 10,
		GettyConcurrency:  5,
	}

	client, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}

	result, err := client.GetByID(context.Background(), "single-123")
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}

	if result == nil {
		t.Fatal("expected non-nil result")
	}

	if result.GettyID != "single-123" {
		t.Errorf("expected getty ID 'single-123', got '%s'", result.GettyID)
	}
}

func TestClient_GetByID_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	cfg := &config.Config{
		GettyUpstream:     server.URL,
		GettyToken:        "test-token",
		GettyXAppKey:      "test-app-key",
		GettyRateLimitRPS: 10,
		GettyConcurrency:  5,
	}

	client, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}

	result, err := client.GetByID(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}

	if result != nil {
		t.Error("expected nil result for 404")
	}
}

func TestClient_Stats(t *testing.T) {
	cfg := &config.Config{
		GettyUpstream:     "https://proxy.example.com",
		GettyToken:        "test-token",
		GettyXAppKey:      "test-app-key",
		GettyRateLimitRPS: 10,
		GettyConcurrency:  5,
	}

	client, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}

	busy, available := client.Stats()
	if busy != 0 {
		t.Errorf("expected 0 busy, got %d", busy)
	}
	if available != 5 {
		t.Errorf("expected 5 available, got %d", available)
	}
}

func TestClient_Search_ContextCanceled(t *testing.T) {
	cfg := &config.Config{
		GettyUpstream:     "https://proxy.example.com",
		GettyToken:        "test-token",
		GettyXAppKey:      "test-app-key",
		GettyRateLimitRPS: 10,
		GettyConcurrency:  5,
	}

	client, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, searchErr := client.Search(ctx, "test", 10)
	if searchErr == nil {
		t.Error("expected error for canceled context")
	}
}

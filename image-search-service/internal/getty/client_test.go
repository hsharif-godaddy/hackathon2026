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

// mockAuth implements AuthProvider for testing without rate limiting.
type mockAuth struct {
	name   string
	called bool
}

func (m *mockAuth) ApplyAuth(_ context.Context, req *http.Request) error {
	m.called = true
	req.Header.Set("Authorization", "Bearer test-token")
	req.Header.Set("X-App-Key", "test-app-key")
	return nil
}

func (m *mockAuth) Name() string {
	return m.name
}

// newTestClient creates a Client for testing with optional mock auth.
func newTestClient(baseURL string, auth AuthProvider) *Client {
	return &Client{
		httpClient: &http.Client{},
		baseURL:    baseURL,
		auth:       auth,
		limiter:    nil, // nil limiter for tests
	}
}

func TestSearchWithOptionsIntegration(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request path
		if r.URL.Path != "/v1/search" {
			t.Errorf("expected /v1/search path, got %s", r.URL.Path)
		}

		// Verify query parameters
		phrase := r.URL.Query().Get("phrase")
		if phrase != "business meeting" {
			t.Errorf("expected phrase 'business meeting', got '%s'", phrase)
		}

		pageSize := r.URL.Query().Get("pageSize")
		if pageSize != "20" {
			t.Errorf("expected pageSize '20', got '%s'", pageSize)
		}

		sortOrder := r.URL.Query().Get("sortOrder")
		if sortOrder != "most_popular" {
			t.Errorf("expected sortOrder 'most_popular', got '%s'", sortOrder)
		}

		// Return mock response with full ImageResult structure
		response := SearchResponse{
			ResultCount: 2,
			Images: []ImageResult{
				{
					ID:      "123456789",
					Title:   "Business meeting",
					Caption: "Team collaboration",
					MaxDimensions: &Dimensions{
						Width:  5000,
						Height: 3333,
					},
					DisplaySizes: []DisplaySize{
						{Name: "thumb", URI: "https://example.com/thumb.jpg"},
						{Name: "preview", URI: "https://example.com/preview.jpg"},
					},
					AssetFamily:    "creative",
					GraphicalStyle: "photography",
					LicenseModel:   "royaltyfree",
					CollectionName: "iStock",
					Artist:         "John Doe",
					DateCreated:    "2024-01-15",
				},
				{
					ID:      "987654321",
					Title:   "Team discussion",
					Caption: "Office meeting",
					MaxDimensions: &Dimensions{
						Width:  4000,
						Height: 2666,
					},
					DisplaySizes: []DisplaySize{
						{Name: "thumb", URI: "https://example.com/thumb2.jpg"},
						{Name: "comp", URI: "https://example.com/comp2.jpg"},
					},
					AssetFamily: "creative",
				},
			},
			RelatedSearches: []RelatedSearch{
				{Text: "office"},
				{Text: "teamwork"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	auth := &mockAuth{name: "TestAuth"}
	client := newTestClient(server.URL, auth)

	opts := &SearchOptions{
		Phrase:    "business meeting",
		PageSize:  20,
		SortOrder: SortOrderMostPopular,
	}

	resp, err := client.SearchWithOptions(context.Background(), opts)
	if err != nil {
		t.Fatalf("SearchWithOptions failed: %v", err)
	}

	// Verify auth was called
	if !auth.called {
		t.Error("expected auth provider to be called")
	}

	// Verify response
	if resp.ResultCount != 2 {
		t.Errorf("expected result count 2, got %d", resp.ResultCount)
	}

	if len(resp.Images) != 2 {
		t.Fatalf("expected 2 images, got %d", len(resp.Images))
	}

	// Verify first image
	img := resp.Images[0]
	if img.ID != "123456789" {
		t.Errorf("expected ID '123456789', got '%s'", img.ID)
	}
	if img.Title != "Business meeting" {
		t.Errorf("expected title 'Business meeting', got '%s'", img.Title)
	}
	if img.GettyID() != "123456789" {
		t.Errorf("expected GettyID() '123456789', got '%s'", img.GettyID())
	}
	if img.Width() != 5000 {
		t.Errorf("expected Width() 5000, got %d", img.Width())
	}
	if img.Height() != 3333 {
		t.Errorf("expected Height() 3333, got %d", img.Height())
	}
	if img.Thumbnail() != "https://example.com/thumb.jpg" {
		t.Errorf("expected Thumbnail() URL, got '%s'", img.Thumbnail())
	}
	if img.Preview() != "https://example.com/preview.jpg" {
		t.Errorf("expected Preview() URL, got '%s'", img.Preview())
	}
	if img.Artist != "John Doe" {
		t.Errorf("expected Artist 'John Doe', got '%s'", img.Artist)
	}
	if img.LicenseModel != "royaltyfree" {
		t.Errorf("expected LicenseModel 'royaltyfree', got '%s'", img.LicenseModel)
	}

	// Verify second image uses comp as preview fallback
	img2 := resp.Images[1]
	if img2.Preview() != "https://example.com/comp2.jpg" {
		t.Errorf("expected Preview() to fall back to comp URL, got '%s'", img2.Preview())
	}

	// Verify related searches
	if len(resp.RelatedSearches) != 2 {
		t.Errorf("expected 2 related searches, got %d", len(resp.RelatedSearches))
	}
}

func TestSearchWithOptionsWithFilters(t *testing.T) {
	// Create mock server that verifies advanced filter parameters
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()

		// Verify filter parameters are passed correctly
		orientations := q["orientations"]
		if len(orientations) != 2 || orientations[0] != "horizontal" || orientations[1] != "vertical" {
			t.Errorf("expected orientations [horizontal, vertical], got %v", orientations)
		}

		graphicalStyles := q["graphicalStyles"]
		if len(graphicalStyles) != 1 || graphicalStyles[0] != "photography" {
			t.Errorf("expected graphicalStyles [photography], got %v", graphicalStyles)
		}

		minimumSize := q.Get("minimumSize")
		if minimumSize != "large" {
			t.Errorf("expected minimumSize 'large', got '%s'", minimumSize)
		}

		excludeNudity := q.Get("excludeNudity")
		if excludeNudity != "false" {
			t.Errorf("expected excludeNudity 'false', got '%s'", excludeNudity)
		}

		response := SearchResponse{
			ResultCount: 1,
			Images: []ImageResult{
				{ID: "filter-test", Title: "Filtered Image"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	auth := &mockAuth{name: "TestAuth"}
	client := newTestClient(server.URL, auth)

	excludeNudity := false
	opts := &SearchOptions{
		Phrase:          "landscape",
		Orientations:    []Orientation{OrientationHorizontal, OrientationVertical},
		GraphicalStyles: []GraphicalStyle{GraphicalStylePhotography},
		MinimumSize:     MinimumSizeLarge,
		ExcludeNudity:   &excludeNudity,
	}

	resp, err := client.SearchWithOptions(context.Background(), opts)
	if err != nil {
		t.Fatalf("SearchWithOptions failed: %v", err)
	}

	if resp.ResultCount != 1 {
		t.Errorf("expected result count 1, got %d", resp.ResultCount)
	}
}

func TestSearchBackwardCompatibility(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify old Search() parameters are mapped correctly
		q := r.URL.Query()

		phrase := q.Get("phrase")
		if phrase != "legacy search" {
			t.Errorf("expected phrase 'legacy search', got '%s'", phrase)
		}

		pageSize := q.Get("pageSize")
		if pageSize != "15" {
			t.Errorf("expected pageSize '15', got '%s'", pageSize)
		}

		// Verify default safety settings are applied
		excludeNudity := q.Get("excludeNudity")
		if excludeNudity != "true" {
			t.Errorf("expected excludeNudity 'true' (default), got '%s'", excludeNudity)
		}

		safeSearch := q.Get("safeSearch")
		if safeSearch != "true" {
			t.Errorf("expected safeSearch 'true' (default), got '%s'", safeSearch)
		}

		// Return response using old format (what legacy Search expects)
		response := SearchResponse{
			ResultCount: 1,
			Images: []ImageResult{
				{
					ID:    "legacy-123",
					Title: "Legacy Image",
					MaxDimensions: &Dimensions{
						Width:  3000,
						Height: 2000,
					},
					DisplaySizes: []DisplaySize{
						{Name: "thumb", URI: "https://example.com/legacy-thumb.jpg"},
						{Name: "preview", URI: "https://example.com/legacy-preview.jpg"},
					},
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	auth := &mockAuth{name: "TestAuth"}
	client := newTestClient(server.URL, auth)

	// Use the legacy Search method
	results, err := client.Search(context.Background(), "legacy search", 15)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	// Verify results
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	// Legacy Search returns []ImageResult (backward compatible)
	result := results[0]
	if result.ID != "legacy-123" {
		t.Errorf("expected ID 'legacy-123', got '%s'", result.ID)
	}
	if result.GettyID() != "legacy-123" {
		t.Errorf("expected GettyID() 'legacy-123', got '%s'", result.GettyID())
	}
	if result.Title != "Legacy Image" {
		t.Errorf("expected title 'Legacy Image', got '%s'", result.Title)
	}
	if result.Width() != 3000 {
		t.Errorf("expected Width() 3000, got %d", result.Width())
	}
	if result.Height() != 2000 {
		t.Errorf("expected Height() 2000, got %d", result.Height())
	}
	if result.Thumbnail() != "https://example.com/legacy-thumb.jpg" {
		t.Errorf("expected Thumbnail() URL, got '%s'", result.Thumbnail())
	}
	if result.Preview() != "https://example.com/legacy-preview.jpg" {
		t.Errorf("expected Preview() URL, got '%s'", result.Preview())
	}
}

func TestGetByIDWithNewTypes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// GetByID uses search endpoint
		if !strings.Contains(r.URL.Path, "/v1/search") {
			t.Errorf("expected /v1/search path, got %s", r.URL.Path)
		}

		response := SearchResponse{
			ResultCount: 1,
			Images: []ImageResult{
				{
					ID:            "single-456",
					Title:         "Single Test Image",
					Caption:       "Test caption",
					Copyright:     "(c) 2024",
					AssetFamily:   "creative",
					LicenseModel:  "royaltyfree",
					MaxDimensions: &Dimensions{Width: 2000, Height: 1500},
					DisplaySizes: []DisplaySize{
						{Name: "thumb", URI: "https://example.com/thumb.jpg"},
						{Name: "preview", URI: "https://example.com/preview.jpg"},
					},
					Keywords: []Keyword{
						{KeywordID: "1", Text: "business"},
						{KeywordID: "2", Text: "meeting"},
					},
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	auth := &mockAuth{name: "TestAuth"}
	client := newTestClient(server.URL, auth)

	result, err := client.GetByID(context.Background(), "single-456")
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}

	if result == nil {
		t.Fatal("expected non-nil result")
	}

	// Verify new type fields
	if result.ID != "single-456" {
		t.Errorf("expected ID 'single-456', got '%s'", result.ID)
	}
	if result.GettyID() != "single-456" {
		t.Errorf("expected GettyID() 'single-456', got '%s'", result.GettyID())
	}
	if result.Caption != "Test caption" {
		t.Errorf("expected caption 'Test caption', got '%s'", result.Caption)
	}
	if result.Copyright != "(c) 2024" {
		t.Errorf("expected copyright '(c) 2024', got '%s'", result.Copyright)
	}
	if result.LicenseModel != "royaltyfree" {
		t.Errorf("expected license model 'royaltyfree', got '%s'", result.LicenseModel)
	}
	if len(result.Keywords) != 2 {
		t.Errorf("expected 2 keywords, got %d", len(result.Keywords))
	}
}

func TestSearchWithOptionsHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("Internal Server Error"))
	}))
	defer server.Close()

	auth := &mockAuth{name: "TestAuth"}
	client := newTestClient(server.URL, auth)

	opts := NewSearchOptions("test query")
	_, err := client.SearchWithOptions(context.Background(), opts)
	if err == nil {
		t.Error("expected error for HTTP 500")
	}

	if !strings.Contains(err.Error(), "500") {
		t.Errorf("expected error to mention status 500, got: %v", err)
	}
}

func TestSearchWithOptionsInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("invalid json"))
	}))
	defer server.Close()

	auth := &mockAuth{name: "TestAuth"}
	client := newTestClient(server.URL, auth)

	opts := NewSearchOptions("test query")
	_, err := client.SearchWithOptions(context.Background(), opts)
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestSearchWithOptionsContextCanceled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		// Never respond - context will be canceled first
	}))
	defer server.Close()

	auth := &mockAuth{name: "TestAuth"}
	client := newTestClient(server.URL, auth)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	opts := NewSearchOptions("test")
	_, err := client.SearchWithOptions(ctx, opts)
	if err == nil {
		t.Error("expected error for canceled context")
	}
}

// Tests for URL builder function (previously in client.go, now delegated to url.go)
func TestBuildSearchURLDelegation(t *testing.T) {
	baseURL := "https://proxy.example.com"
	opts := &SearchOptions{
		Phrase:   "business meeting",
		PageSize: 10,
	}

	url := BuildSearchURL(baseURL, opts)

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

// Tests with real rate limiter (existing tests)
func TestClient_Search_WithRateLimiter(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request - check Bearer token auth
		authHeader := r.Header.Get("Authorization")
		if authHeader != "Bearer test-token" {
			t.Errorf("expected Authorization header 'Bearer test-token', got '%s'", authHeader)
		}

		if r.Header.Get("X-App-Key") != "test-app-key" {
			t.Errorf("expected X-App-Key header 'test-app-key', got '%s'", r.Header.Get("X-App-Key"))
		}

		if !strings.Contains(r.URL.Path, "/v1/search") {
			t.Errorf("expected /v1/search path, got %s", r.URL.Path)
		}

		// Return mock response
		response := SearchResponse{
			ResultCount: 1,
			Images: []ImageResult{
				{
					ID:    "test-123",
					Title: "Test Image",
					DisplaySizes: []DisplaySize{
						{Name: "thumb", URI: "https://example.com/thumb.jpg"},
						{Name: "preview", URI: "https://example.com/preview.jpg"},
					},
					MaxDimensions: &Dimensions{Width: 3000, Height: 2000},
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

	if results[0].ID != "test-123" {
		t.Errorf("expected ID 'test-123', got '%s'", results[0].ID)
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

		response := SearchResponse{
			Images: []ImageResult{
				{
					ID:            "single-123",
					Title:         "Single Test",
					Caption:       "Caption text",
					MaxDimensions: &Dimensions{Width: 2000, Height: 1500},
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

	if result.ID != "single-123" {
		t.Errorf("expected ID 'single-123', got '%s'", result.ID)
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

func TestSearchWithOptionsNilLimiter(t *testing.T) {
	// Test that client works correctly when limiter is nil (common in test scenarios)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		response := SearchResponse{
			ResultCount: 1,
			Images: []ImageResult{
				{ID: "nil-limiter-test", Title: "Test"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	// Create client directly with nil limiter
	client := &Client{
		httpClient: &http.Client{},
		baseURL:    server.URL,
		auth:       &mockAuth{name: "TestAuth"},
		limiter:    nil, // Explicitly nil
	}

	opts := NewSearchOptions("test")
	resp, err := client.SearchWithOptions(context.Background(), opts)
	if err != nil {
		t.Fatalf("SearchWithOptions with nil limiter failed: %v", err)
	}

	if resp.ResultCount != 1 {
		t.Errorf("expected result count 1, got %d", resp.ResultCount)
	}
}

// pkg/models/api_test.go
package models

import (
	"encoding/json"
	"testing"
)

func TestSearchRequest_Defaults(t *testing.T) {
	input := `{"query": "business meeting"}`

	var req SearchRequest
	if err := json.Unmarshal([]byte(input), &req); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if req.Query != "business meeting" {
		t.Errorf("expected query 'business meeting', got %s", req.Query)
	}
	if req.Count != 0 {
		t.Errorf("expected count 0 (default), got %d", req.Count)
	}
}

func TestSearchFilters_JSONParsing(t *testing.T) {
	input := `{
		"orientations": ["horizontal", "square"],
		"subjectCategory": ["people", "workspace"],
		"peopleCount": ["2-3", "4+"],
		"tone": ["professional"]
	}`

	var filters SearchFilters
	if err := json.Unmarshal([]byte(input), &filters); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if len(filters.Orientations) != 2 {
		t.Errorf("expected 2 orientations, got %d", len(filters.Orientations))
	}
	if len(filters.SubjectCategory) != 2 {
		t.Errorf("expected 2 subject categories, got %d", len(filters.SubjectCategory))
	}
}

func TestSearchRequest_WithFilters(t *testing.T) {
	input := `{
		"query": "team collaboration",
		"count": 20,
		"filters": {
			"orientations": ["horizontal"],
			"tone": ["professional", "friendly"]
		},
		"minCachedResults": 5,
		"maxWaitSeconds": 10
	}`

	var req SearchRequest
	if err := json.Unmarshal([]byte(input), &req); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if req.Query != "team collaboration" {
		t.Errorf("expected query 'team collaboration', got %s", req.Query)
	}
	if req.Count != 20 {
		t.Errorf("expected count 20, got %d", req.Count)
	}
	if len(req.Filters.Orientations) != 1 {
		t.Errorf("expected 1 orientation, got %d", len(req.Filters.Orientations))
	}
	if len(req.Filters.Tone) != 2 {
		t.Errorf("expected 2 tones, got %d", len(req.Filters.Tone))
	}
	if req.MinCachedResult != 5 {
		t.Errorf("expected minCachedResults 5, got %d", req.MinCachedResult)
	}
	if req.MaxWaitSeconds != 10 {
		t.Errorf("expected maxWaitSeconds 10, got %d", req.MaxWaitSeconds)
	}
}

func TestSearchResponse_JSONSerialization(t *testing.T) {
	resp := SearchResponse{
		Results: []SearchResult{
			{
				GettyID: "12345",
				URLs: ImageURLs{
					Thumbnail: "https://example.com/thumb.jpg",
					Preview:   "https://example.com/preview.jpg",
				},
				RelevanceScore: 0.95,
				FromCache:      true,
				Analysis: &ImageAnalysisResponse{
					PrimarySubject:  "business meeting",
					SubjectCategory: "people",
					PeopleCount:     "2-3",
				},
			},
		},
		Meta: SearchMeta{
			Total:    100,
			Cached:   50,
			Analyzed: 20,
			Filtered: 10,
			Complete: true,
		},
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded SearchResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if len(decoded.Results) != 1 {
		t.Errorf("expected 1 result, got %d", len(decoded.Results))
	}
	if decoded.Results[0].GettyID != "12345" {
		t.Errorf("expected gettyId '12345', got %s", decoded.Results[0].GettyID)
	}
	if decoded.Meta.Total != 100 {
		t.Errorf("expected total 100, got %d", decoded.Meta.Total)
	}
}

func TestBatchLookupRequest_JSONParsing(t *testing.T) {
	input := `{"gettyIds": ["123", "456", "789"]}`

	var req BatchLookupRequest
	if err := json.Unmarshal([]byte(input), &req); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if len(req.GettyIDs) != 3 {
		t.Errorf("expected 3 getty IDs, got %d", len(req.GettyIDs))
	}
}

func TestErrorResponse_JSONSerialization(t *testing.T) {
	errResp := ErrorResponse{
		Error:   "invalid request",
		Code:    "INVALID_REQUEST",
		Details: "query field is required",
	}

	data, err := json.Marshal(errResp)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded ErrorResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.Error != "invalid request" {
		t.Errorf("expected error 'invalid request', got %s", decoded.Error)
	}
	if decoded.Code != "INVALID_REQUEST" {
		t.Errorf("expected code 'INVALID_REQUEST', got %s", decoded.Code)
	}
}

func TestHealthResponse_JSONSerialization(t *testing.T) {
	health := HealthResponse{
		Status:  "healthy",
		Version: "1.0.0",
	}

	data, err := json.Marshal(health)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded HealthResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.Status != "healthy" {
		t.Errorf("expected status 'healthy', got %s", decoded.Status)
	}
}

func TestStatsResponse_JSONSerialization(t *testing.T) {
	stats := StatsResponse{
		QueueDepth:    10,
		CacheHitRate:  0.85,
		TotalSearches: 1000,
		TotalAnalyzed: 500,
		GettyPoolBusy: 3,
		HaikuPoolBusy: 5,
	}

	data, err := json.Marshal(stats)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded StatsResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.CacheHitRate != 0.85 {
		t.Errorf("expected cacheHitRate 0.85, got %f", decoded.CacheHitRate)
	}
}

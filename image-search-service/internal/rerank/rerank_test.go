package rerank

import (
	"testing"

	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

func TestTokenize(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{"therapist counseling office", []string{"therapist", "counseling", "office"}},
		{"Golf Course Fairway", []string{"golf", "course", "fairway"}},
		{"3D render of a bakery", []string{"3d", "render", "of", "bakery"}},
		{"well-lit modern space", []string{"well", "lit", "modern", "space"}},
		{"", nil},
		{"a b", nil}, // single-char tokens filtered
	}

	for _, tt := range tests {
		result := tokenize(tt.input)
		if len(result) != len(tt.expected) {
			t.Errorf("tokenize(%q) = %v (len %d), want %v (len %d)", tt.input, result, len(result), tt.expected, len(tt.expected))
			continue
		}
		for i := range result {
			if result[i] != tt.expected[i] {
				t.Errorf("tokenize(%q)[%d] = %q, want %q", tt.input, i, result[i], tt.expected[i])
			}
		}
	}
}

func TestScoreCandidate_ExactMatch(t *testing.T) {
	query := []string{"therapist", "counseling", "office"}

	// Good match: title contains "therapist" and "counseling"
	good := &models.ImageAnalysis{
		Title:         "Professional Therapist in Counseling Session",
		Caption:       "A therapist provides counseling in a modern office setting",
		SearchTerms:   []string{"therapist", "counseling", "mental health"},
		GettyKeywords: []string{"therapy", "counseling", "office", "professional"},
	}

	// Bad match: physical therapy (different domain)
	bad := &models.ImageAnalysis{
		Title:         "Physical Therapy Rehabilitation Session",
		Caption:       "Patient receiving physical therapy treatment",
		SearchTerms:   []string{"physical therapy", "rehabilitation", "medical"},
		GettyKeywords: []string{"physical therapy", "rehabilitation", "clinic", "medical"},
	}

	goodScore := scoreCandidate(query, good)
	badScore := scoreCandidate(query, bad)

	if goodScore <= badScore {
		t.Errorf("good candidate score (%f) should be higher than bad candidate score (%f)", goodScore, badScore)
	}
}

func TestScoreCandidate_GolfVsMiniGolf(t *testing.T) {
	query := []string{"golf", "course", "fairway", "green"}

	golf := &models.ImageAnalysis{
		Title:         "Golf Course Aerial View",
		Caption:       "Beautiful golf course with lush green fairway",
		SearchTerms:   []string{"golf", "course", "fairway", "sport"},
		GettyKeywords: []string{"golf", "golf course", "fairway", "green", "sport"},
	}

	miniGolf := &models.ImageAnalysis{
		Title:         "Miniature Golf Course Fun",
		Caption:       "Colorful miniature golf course with obstacles",
		SearchTerms:   []string{"mini golf", "entertainment", "fun"},
		GettyKeywords: []string{"miniature golf", "entertainment", "fun", "course"},
	}

	golfScore := scoreCandidate(query, golf)
	miniScore := scoreCandidate(query, miniGolf)

	if golfScore <= miniScore {
		t.Errorf("golf score (%f) should be higher than mini-golf score (%f)", golfScore, miniScore)
	}
}

func TestByKeywordMatch_ReordersResults(t *testing.T) {
	// Simulate HybridSearch returning wrong-domain first
	analyses := []*models.ImageAnalysis{
		{
			GettyID:       "wrong-1",
			Title:         "Physical Therapy Clinic",
			Caption:       "Modern physical therapy facility",
			SearchTerms:   []string{"physical therapy", "clinic"},
			GettyKeywords: []string{"physical therapy", "rehabilitation"},
		},
		{
			GettyID:       "wrong-2",
			Title:         "Physical Therapy Session",
			Caption:       "Patient in therapy session",
			SearchTerms:   []string{"therapy", "patient"},
			GettyKeywords: []string{"physical therapy", "treatment"},
		},
		{
			GettyID:       "correct-1",
			Title:         "Therapist Counseling Office",
			Caption:       "Professional therapist in counseling office",
			SearchTerms:   []string{"therapist", "counseling", "office"},
			GettyKeywords: []string{"therapist", "counseling", "mental health", "office"},
		},
	}

	results := ByKeywordMatch("therapist counseling office", analyses, 3)

	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}
	if results[0].GettyID != "correct-1" {
		t.Errorf("expected correct-1 first, got %s", results[0].GettyID)
	}
}

func TestByKeywordMatch_RespectsLimit(t *testing.T) {
	analyses := make([]*models.ImageAnalysis, 10)
	for i := range analyses {
		analyses[i] = &models.ImageAnalysis{
			GettyID: "id",
			Title:   "test image",
		}
	}

	results := ByKeywordMatch("test", analyses, 5)
	if len(results) != 5 {
		t.Errorf("expected 5 results, got %d", len(results))
	}
}

func TestByKeywordMatch_EmptyQuery(t *testing.T) {
	analyses := []*models.ImageAnalysis{
		{GettyID: "1", Title: "test"},
		{GettyID: "2", Title: "test"},
	}

	results := ByKeywordMatch("", analyses, 5)
	if len(results) != 2 {
		t.Errorf("expected 2 results (passthrough), got %d", len(results))
	}
}

func TestByKeywordMatch_EmptyAnalyses(t *testing.T) {
	results := ByKeywordMatch("test query", nil, 5)
	if len(results) != 0 {
		t.Errorf("expected 0 results, got %d", len(results))
	}
}

func TestByKeywordMatch_TieBreaksByOriginalRank(t *testing.T) {
	// Same keyword scores — should preserve original order
	analyses := []*models.ImageAnalysis{
		{GettyID: "first", Title: "test image alpha"},
		{GettyID: "second", Title: "test image beta"},
	}

	results := ByKeywordMatch("test image", analyses, 2)
	if results[0].GettyID != "first" {
		t.Errorf("expected tie to preserve original rank, got %s first", results[0].GettyID)
	}
}

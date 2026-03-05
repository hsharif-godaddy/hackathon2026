package search

import (
	"testing"

	"github.com/qdrant/go-client/qdrant"
)

func makeScoredPoint(docName string, score float32) *qdrant.ScoredPoint {
	return &qdrant.ScoredPoint{
		Score: score,
		Payload: map[string]*qdrant.Value{
			"docName":     {Kind: &qdrant.Value_StringValue{StringValue: docName}},
			"sectionPath": {Kind: &qdrant.Value_StringValue{StringValue: docName + " > Section"}},
			"content":     {Kind: &qdrant.Value_StringValue{StringValue: "Content for " + docName}},
			"chunkIndex":  {Kind: &qdrant.Value_IntegerValue{IntegerValue: 0}},
		},
	}
}

func TestDedupByDocName_NoDuplicates(t *testing.T) {
	points := []*qdrant.ScoredPoint{
		makeScoredPoint("doc-a", 0.9),
		makeScoredPoint("doc-b", 0.8),
		makeScoredPoint("doc-c", 0.7),
	}

	result := dedupByDocName(points)
	if len(result) != 3 {
		t.Errorf("expected 3 results, got %d", len(result))
	}
}

func TestDedupByDocName_WithDuplicates(t *testing.T) {
	points := []*qdrant.ScoredPoint{
		makeScoredPoint("doc-a", 0.9),
		makeScoredPoint("doc-b", 0.85),
		makeScoredPoint("doc-a", 0.8), // duplicate
		makeScoredPoint("doc-c", 0.7),
		makeScoredPoint("doc-b", 0.6), // duplicate
	}

	result := dedupByDocName(points)
	if len(result) != 3 {
		t.Errorf("expected 3 results, got %d", len(result))
	}

	// Verify highest scores kept
	if result[0].Score != 0.9 {
		t.Errorf("expected first result score 0.9, got %f", result[0].Score)
	}
	if result[1].Score != 0.85 {
		t.Errorf("expected second result score 0.85, got %f", result[1].Score)
	}
}

func TestDedupByDocName_Empty(t *testing.T) {
	result := dedupByDocName(nil)
	if len(result) != 0 {
		t.Errorf("expected 0 results, got %d", len(result))
	}
}

func TestPointToSearchResult(t *testing.T) {
	point := makeScoredPoint("deployment", 0.95)
	result := pointToSearchResult(point)

	if result.DocName != "deployment" {
		t.Errorf("expected docName 'deployment', got %q", result.DocName)
	}
	if result.Score != 0.95 {
		t.Errorf("expected score 0.95, got %f", result.Score)
	}
	if result.Content != "Content for deployment" {
		t.Errorf("expected content, got %q", result.Content)
	}
}

func TestGetPayloadString_Missing(t *testing.T) {
	payload := map[string]*qdrant.Value{}
	if got := getPayloadString(payload, "missing"); got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

func TestGetPayloadInt_Missing(t *testing.T) {
	payload := map[string]*qdrant.Value{}
	if got := getPayloadInt(payload, "missing"); got != 0 {
		t.Errorf("expected 0, got %d", got)
	}
}

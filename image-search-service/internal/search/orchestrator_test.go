package search

import (
	"testing"

	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

func TestSortByRelevance(t *testing.T) {
	analyses := []*models.ImageAnalysis{
		{GettyID: "low", RelevanceScore: 0.3},
		{GettyID: "high", RelevanceScore: 0.9},
		{GettyID: "mid", RelevanceScore: 0.6},
	}

	sorted := sortByRelevance(analyses)

	if len(sorted) != 3 {
		t.Fatalf("expected 3 results, got %d", len(sorted))
	}
	if sorted[0].GettyID != "high" {
		t.Errorf("first result should be 'high', got %s", sorted[0].GettyID)
	}
	if sorted[1].GettyID != "mid" {
		t.Errorf("second result should be 'mid', got %s", sorted[1].GettyID)
	}
	if sorted[2].GettyID != "low" {
		t.Errorf("third result should be 'low', got %s", sorted[2].GettyID)
	}
}

func TestSortByRelevance_EmptySlice(t *testing.T) {
	var analyses []*models.ImageAnalysis
	sorted := sortByRelevance(analyses)
	if len(sorted) != 0 {
		t.Errorf("expected empty slice, got %d items", len(sorted))
	}
}

func TestSortByRelevance_SingleItem(t *testing.T) {
	analyses := []*models.ImageAnalysis{
		{GettyID: "only", RelevanceScore: 0.5},
	}
	sorted := sortByRelevance(analyses)
	if len(sorted) != 1 || sorted[0].GettyID != "only" {
		t.Errorf("single item should be returned unchanged")
	}
}

func TestCollectResults_AppliesLimit(t *testing.T) {
	analyses := []*models.ImageAnalysis{
		{GettyID: "1", RelevanceScore: 0.9},
		{GettyID: "2", RelevanceScore: 0.8},
		{GettyID: "3", RelevanceScore: 0.7},
		{GettyID: "4", RelevanceScore: 0.6},
		{GettyID: "5", RelevanceScore: 0.5},
	}

	result := collectResults(analyses, 3)

	if len(result) != 3 {
		t.Errorf("expected 3 results, got %d", len(result))
	}
}

func TestCollectResults_LimitGreaterThanLength(t *testing.T) {
	analyses := []*models.ImageAnalysis{
		{GettyID: "1", RelevanceScore: 0.9},
		{GettyID: "2", RelevanceScore: 0.8},
	}

	result := collectResults(analyses, 10)

	if len(result) != 2 {
		t.Errorf("expected 2 results (all available), got %d", len(result))
	}
}

func TestSortByRelevance_EqualScores(t *testing.T) {
	// When scores are equal, order should be stable (preserve input order)
	analyses := []*models.ImageAnalysis{
		{GettyID: "first", RelevanceScore: 0.5},
		{GettyID: "second", RelevanceScore: 0.5},
		{GettyID: "third", RelevanceScore: 0.5},
	}

	sorted := sortByRelevance(analyses)

	if len(sorted) != 3 {
		t.Fatalf("expected 3 results, got %d", len(sorted))
	}

	// All items should still be present
	ids := make(map[string]bool)
	for _, a := range sorted {
		ids[a.GettyID] = true
	}
	if !ids["first"] || !ids["second"] || !ids["third"] {
		t.Error("all items should be present after sorting")
	}
}

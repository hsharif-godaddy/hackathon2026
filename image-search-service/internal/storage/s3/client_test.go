package s3

import (
	"testing"

	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

func TestBuildKey(t *testing.T) {
	prefix := "analyses/v1"
	gettyID := "123456789"

	key := buildKey(prefix, gettyID)

	expected := "analyses/v1/getty-123456789.json"
	if key != expected {
		t.Errorf("expected %s, got %s", expected, key)
	}
}

func TestAnalysisToJSON(t *testing.T) {
	analysis := &models.ImageAnalysis{
		GettyID:         "123456789",
		Title:           "Test image",
		PrimarySubject:  "test subject",
		SubjectCategory: models.SubjectCategoryPeople,
	}

	data, err := analysisToJSON(analysis)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	if len(data) == 0 {
		t.Error("expected non-empty JSON")
	}
}

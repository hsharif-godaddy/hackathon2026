package qdrant

import (
	"strings"
	"testing"
	"time"

	"github.com/qdrant/go-client/qdrant"

	"github.com/airo-ai-builder/knowledge-service/pkg/models"
)

func TestBuildSearchFilter_Empty(t *testing.T) {
	c := &Client{}
	filter := c.buildSearchFilter(nil, nil)
	if filter != nil {
		t.Error("expected nil filter for empty inputs")
	}
}

func TestBuildSearchFilter_DocNamesOnly(t *testing.T) {
	c := &Client{}
	filter := c.buildSearchFilter([]string{"deployment", "hosting"}, nil)
	if filter == nil {
		t.Fatal("expected non-nil filter")
	}
	if len(filter.Must) != 1 {
		t.Errorf("expected 1 condition, got %d", len(filter.Must))
	}
}

func TestBuildSearchFilter_TagsOnly(t *testing.T) {
	c := &Client{}
	filter := c.buildSearchFilter(nil, []string{"getting-started"})
	if filter == nil {
		t.Fatal("expected non-nil filter")
	}
	if len(filter.Must) != 1 {
		t.Errorf("expected 1 condition, got %d", len(filter.Must))
	}
}

func TestBuildSearchFilter_Both(t *testing.T) {
	c := &Client{}
	filter := c.buildSearchFilter([]string{"deployment"}, []string{"getting-started"})
	if filter == nil {
		t.Fatal("expected non-nil filter")
	}
	if len(filter.Must) != 2 {
		t.Errorf("expected 2 conditions, got %d", len(filter.Must))
	}
}

func TestChunkToPayload(t *testing.T) {
	chunk := &models.Chunk{
		DocName:           "deployment",
		SectionPath:       "Deployment > Vercel",
		Content:           "Deploy your app to Vercel",
		ContextualContent: "This section covers deploying.\nDeploy your app to Vercel",
		ContentHash:       "abc123",
		ContextualHash:    "def456",
		ChunkIndex:        0,
		Tags:              []string{"getting-started", "deployment"},
		CreatedAt:         time.Date(2026, 2, 25, 0, 0, 0, 0, time.UTC),
		UpdatedAt:         time.Date(2026, 2, 25, 0, 0, 0, 0, time.UTC),
	}

	payload := chunkToPayload(chunk)

	if payload == nil {
		t.Fatal("expected non-nil payload")
	}

	if getStringValue(payload, "docName") != "deployment" {
		t.Errorf("expected docName=deployment, got %q", getStringValue(payload, "docName"))
	}
	if getStringValue(payload, "sectionPath") != "Deployment > Vercel" {
		t.Errorf("expected sectionPath, got %q", getStringValue(payload, "sectionPath"))
	}
	if getStringValue(payload, "contentHash") != "abc123" {
		t.Errorf("expected contentHash=abc123, got %q", getStringValue(payload, "contentHash"))
	}
	if getIntValue(payload, "chunkIndex") != 0 {
		t.Errorf("expected chunkIndex=0, got %d", getIntValue(payload, "chunkIndex"))
	}
}

func TestGetStringValue(t *testing.T) {
	payload := map[string]*qdrant.Value{
		"test": {Kind: &qdrant.Value_StringValue{StringValue: "hello"}},
	}

	if got := getStringValue(payload, "test"); got != "hello" {
		t.Errorf("expected hello, got %q", got)
	}

	if got := getStringValue(payload, "missing"); got != "" {
		t.Errorf("expected empty string for missing key, got %q", got)
	}
}

func TestGetIntValue(t *testing.T) {
	payload := map[string]*qdrant.Value{
		"test": {Kind: &qdrant.Value_IntegerValue{IntegerValue: 42}},
	}

	if got := getIntValue(payload, "test"); got != 42 {
		t.Errorf("expected 42, got %d", got)
	}

	if got := getIntValue(payload, "missing"); got != 0 {
		t.Errorf("expected 0 for missing key, got %d", got)
	}
}

func TestExtractPointID_UUID(t *testing.T) {
	id := qdrant.NewID("abc-123")
	got := extractPointID(id)
	if got != "abc-123" {
		t.Errorf("expected abc-123, got %q", got)
	}
}

func TestExtractPointID_Nil(t *testing.T) {
	got := extractPointID(nil)
	if got != "" {
		t.Errorf("expected empty string for nil, got %q", got)
	}
}

func TestContentHashToUUID(t *testing.T) {
	// SHA-256 of "hello" — 64 hex chars
	hash := "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
	got := contentHashToUUID(hash)

	// Must be exactly UUID format: 8-4-4-4-12
	parts := strings.Split(got, "-")
	if len(parts) != 5 {
		t.Fatalf("expected 5 dash-separated parts, got %d: %q", len(parts), got)
	}
	lengths := []int{8, 4, 4, 4, 12}
	for i, p := range parts {
		if len(p) != lengths[i] {
			t.Errorf("part %d: expected length %d, got %d (%q)", i, lengths[i], len(p), p)
		}
	}

	// Must be deterministic
	if got != contentHashToUUID(hash) {
		t.Error("contentHashToUUID is not deterministic")
	}
}

func TestContentHashToUUID_Short(t *testing.T) {
	// Should not panic on short input
	got := contentHashToUUID("abc")
	if got != "abc" {
		t.Errorf("expected passthrough for short hash, got %q", got)
	}
}

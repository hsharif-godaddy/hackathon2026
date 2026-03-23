package ingest

import (
	"testing"

	"github.com/airo-ai-builder/knowledge-service/pkg/models"
)

func TestSelectChunks_ForceBypassesHashSkip(t *testing.T) {
	chunks := []*models.Chunk{
		{ContentHash: "abc"},
		{ContentHash: "def"},
	}
	existingByHash := map[string]string{"abc": "point-1"}

	skipped := 0
	selected := selectChunks(chunks, existingByHash, true, &skipped)

	if len(selected) != 2 {
		t.Errorf("force=true: expected 2 chunks selected, got %d", len(selected))
	}
	if skipped != 0 {
		t.Errorf("force=true: expected ChunksSkipped=0, got %d", skipped)
	}
}

func TestSelectChunks_HashMatchSkipsWithoutForce(t *testing.T) {
	chunks := []*models.Chunk{
		{ContentHash: "abc"},
		{ContentHash: "def"},
	}
	existingByHash := map[string]string{"abc": "point-1"}

	skipped := 0
	selected := selectChunks(chunks, existingByHash, false, &skipped)

	if len(selected) != 1 {
		t.Errorf("force=false: expected 1 chunk selected, got %d", len(selected))
	}
	if selected[0].ContentHash != "def" {
		t.Errorf("force=false: expected unmatched chunk to be selected, got hash %q", selected[0].ContentHash)
	}
	if skipped != 1 {
		t.Errorf("force=false: expected ChunksSkipped=1, got %d", skipped)
	}
}

func TestSelectChunks_NoExistingHashesSelectsAll(t *testing.T) {
	chunks := []*models.Chunk{
		{ContentHash: "abc"},
		{ContentHash: "def"},
	}

	skipped := 0
	selected := selectChunks(chunks, map[string]string{}, false, &skipped)

	if len(selected) != 2 {
		t.Errorf("no existing hashes: expected all 2 chunks selected, got %d", len(selected))
	}
	if skipped != 0 {
		t.Errorf("no existing hashes: expected ChunksSkipped=0, got %d", skipped)
	}
}

func TestSelectChunks_AllMatchedSkipsAllWithoutForce(t *testing.T) {
	chunks := []*models.Chunk{
		{ContentHash: "abc"},
		{ContentHash: "def"},
	}
	existingByHash := map[string]string{"abc": "p1", "def": "p2"}

	skipped := 0
	selected := selectChunks(chunks, existingByHash, false, &skipped)

	if len(selected) != 0 {
		t.Errorf("all matched: expected 0 selected, got %d", len(selected))
	}
	if skipped != 2 {
		t.Errorf("all matched: expected ChunksSkipped=2, got %d", skipped)
	}
}

func TestChunkMarkdown_PipelineIntegration(t *testing.T) {
	// Verify chunker + tokenizer work together
	content := `# API Reference

The API provides REST endpoints for managing resources.

## Authentication

All requests require a Bearer token in the Authorization header.

## Endpoints

GET /api/v1/resources - List all resources.
POST /api/v1/resources - Create a new resource.`

	chunks := ChunkMarkdown("api-reference", content, []string{"api", "docs"}, 50, 0, 0)

	if len(chunks) == 0 {
		t.Fatal("expected chunks")
	}

	// Tokenize each chunk's content
	for _, chunk := range chunks {
		sparse := Tokenize(chunk.Content)
		if sparse == nil {
			t.Errorf("chunk %d: expected non-nil sparse vector", chunk.ChunkIndex)
			continue
		}
		if len(sparse.Indices) == 0 {
			t.Errorf("chunk %d: expected non-empty sparse indices", chunk.ChunkIndex)
		}
	}
}

func TestChunkAndHash(t *testing.T) {
	content := `# Test Document

Some content for testing the pipeline integration.`

	chunks := ChunkMarkdown("test-doc", content, nil, 10, 0, 0)
	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}

	// Verify hash is set
	if chunks[0].ContentHash == "" {
		t.Error("expected contentHash to be set")
	}
	if len(chunks[0].ContentHash) != 64 {
		t.Errorf("expected 64-char SHA-256 hash, got %d chars", len(chunks[0].ContentHash))
	}
}

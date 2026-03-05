package ingest

import (
	"testing"
)

func TestChunkMarkdown_PipelineIntegration(t *testing.T) {
	// Verify chunker + tokenizer work together
	content := `# API Reference

The API provides REST endpoints for managing resources.

## Authentication

All requests require a Bearer token in the Authorization header.

## Endpoints

GET /api/v1/resources - List all resources.
POST /api/v1/resources - Create a new resource.`

	chunks := ChunkMarkdown("api-reference", content, []string{"api", "docs"}, 50)

	if len(chunks) == 0 {
		t.Fatal("expected chunks")
	}

	// Tokenize each chunk's content
	for _, chunk := range chunks {
		sparse := Tokenize(chunk.Content)
		if sparse == nil {
			t.Errorf("chunk %d: expected non-nil sparse vector", chunk.ChunkIndex)
		}
		if len(sparse.Indices) == 0 {
			t.Errorf("chunk %d: expected non-empty sparse indices", chunk.ChunkIndex)
		}
	}
}

func TestChunkAndHash(t *testing.T) {
	content := `# Test Document

Some content for testing the pipeline integration.`

	chunks := ChunkMarkdown("test-doc", content, nil, 10)
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

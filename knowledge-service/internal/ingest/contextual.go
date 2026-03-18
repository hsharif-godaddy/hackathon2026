package ingest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"

	"github.com/airo-ai-builder/knowledge-service/internal/llm"
	"github.com/airo-ai-builder/knowledge-service/pkg/models"
)

// ContextualRetriever generates contextual prefixes for chunks using an LLM.
type ContextualRetriever struct {
	llm *llm.Client
}

// NewContextualRetriever creates a new ContextualRetriever.
func NewContextualRetriever(llmClient *llm.Client) *ContextualRetriever {
	return &ContextualRetriever{llm: llmClient}
}

// EnrichChunk generates a contextual prefix for a chunk using the LLM.
// Sets chunk.ContextualContent = prefix + "\n" + content
// Sets chunk.ContextualHash = sha256hex(contextualContent)
// Returns true if enrichment was successful, false if skipped or failed.
func (cr *ContextualRetriever) EnrichChunk(ctx context.Context, chunk *models.Chunk) (bool, error) {
	prefix, err := cr.llm.GenerateContext(ctx, chunk.DocName, chunk.Content)
	if err != nil {
		slog.Warn("ingest.contextual.failed",
			"docName", chunk.DocName,
			"chunkIndex", chunk.ChunkIndex,
			"error", err)
		// Fall back to content without prefix
		chunk.ContextualContent = chunk.Content
		chunk.ContextualHash = chunk.ContentHash
		return false, nil
	}

	chunk.ContextualContent = prefix + "\n" + chunk.Content
	h := sha256.Sum256([]byte(chunk.ContextualContent))
	chunk.ContextualHash = hex.EncodeToString(h[:])

	return true, nil
}

// ShouldSkipEnrichment returns true if the chunk's content hasn't changed
// and it already has contextual content (existing contextual hash is non-empty).
func ShouldSkipEnrichment(contentHash, existingContentHash, existingContextualHash string) bool {
	return contentHash == existingContentHash && existingContextualHash != ""
}

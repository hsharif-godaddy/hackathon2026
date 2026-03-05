package ingest

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/airo-ai-builder/knowledge-service/internal/config"
	"github.com/airo-ai-builder/knowledge-service/internal/embeddings"
	"github.com/airo-ai-builder/knowledge-service/internal/llm"
	qdrantStorage "github.com/airo-ai-builder/knowledge-service/internal/storage/qdrant"
	"github.com/airo-ai-builder/knowledge-service/pkg/models"
)

// Pipeline orchestrates the full document ingestion flow.
type Pipeline struct {
	embeddings  *embeddings.Client
	contextual  *ContextualRetriever
	qdrant      *qdrantStorage.Client
	cfg         *config.Config
}

// NewPipeline creates a new ingestion pipeline.
func NewPipeline(cfg *config.Config, emb *embeddings.Client, llmClient *llm.Client, qd *qdrantStorage.Client) *Pipeline {
	return &Pipeline{
		embeddings:  emb,
		contextual:  NewContextualRetriever(llmClient),
		qdrant:      qd,
		cfg:         cfg,
	}
}

// IngestDocument processes a single document through the full pipeline:
// chunk → contextual enrichment → embed → BM25 tokenize → upsert → stale cleanup.
func (p *Pipeline) IngestDocument(ctx context.Context, doc models.IngestDocument) (*models.IngestResult, error) {
	start := time.Now()
	result := &models.IngestResult{
		DocName: doc.Name,
		Status:  "success",
	}

	slog.Info("ingest.document.begin", "docName", doc.Name)

	// 1. Chunk by headers
	chunks := ChunkMarkdown(doc.Name, doc.Content, doc.Tags, p.cfg.IngestMinChunkSize)
	if len(chunks) == 0 {
		result.Status = "skipped"
		slog.Info("ingest.document.empty", "docName", doc.Name)
		return result, nil
	}

	// 2. Get existing points for stale cleanup
	existingPoints, err := p.qdrant.ScrollByDocName(ctx, doc.Name)
	if err != nil {
		slog.Warn("ingest.scroll.failed", "docName", doc.Name, "error", err)
		// Continue without stale cleanup
		existingPoints = make(map[string]string)
	}

	// Build lookup: contentHash -> existing pointID (for skip check)
	existingByHash := make(map[string]string)
	for pointID, contentHash := range existingPoints {
		existingByHash[contentHash] = pointID
	}

	// 3. Contextual enrichment — separate changed from unchanged chunks
	var changedChunks []*models.Chunk
	for _, chunk := range chunks {
		if _, exists := existingByHash[chunk.ContentHash]; exists {
			// Content unchanged — skip LLM, embedding, and upsert entirely
			result.ChunksUpdated++
			continue
		}
		enriched, enrichErr := p.contextual.EnrichChunk(ctx, chunk)
		if enrichErr != nil {
			return nil, fmt.Errorf("contextual enrichment failed for chunk %d: %w", chunk.ChunkIndex, enrichErr)
		}
		if !enriched {
			slog.Debug("ingest.contextual.fallback", "docName", doc.Name, "chunkIndex", chunk.ChunkIndex)
		}
		changedChunks = append(changedChunks, chunk)
		result.ChunksCreated++
	}

	// 4. Batch embed only new/changed chunks
	if len(changedChunks) > 0 {
		texts := make([]string, len(changedChunks))
		for i, c := range changedChunks {
			texts[i] = c.ContextualContent
		}

		vectors, err := p.embeddings.GenerateBatch(ctx, texts)
		if err != nil {
			return nil, fmt.Errorf("batch embedding failed: %w", err)
		}

		// 5. Assign embeddings and BM25 sparse vectors
		for i, chunk := range changedChunks {
			chunk.DenseVector = vectors[i]
			chunk.SparseVector = Tokenize(chunk.ContextualContent)
		}

		// 6. Upsert only changed chunks to Qdrant
		if err := p.qdrant.BatchUpsert(ctx, changedChunks); err != nil {
			return nil, fmt.Errorf("upsert failed: %w", err)
		}
	}

	// 7. Stale cleanup — delete points not in new chunk set
	newHashes := make(map[string]bool)
	for _, chunk := range chunks {
		newHashes[chunk.ContentHash] = true
	}

	var staleIDs []string
	for pointID, contentHash := range existingPoints {
		if !newHashes[contentHash] {
			staleIDs = append(staleIDs, pointID)
		}
	}

	if len(staleIDs) > 0 {
		if err := p.qdrant.DeletePoints(ctx, staleIDs); err != nil {
			slog.Warn("ingest.cleanup.failed", "docName", doc.Name, "error", err)
		} else {
			result.ChunksDeleted = len(staleIDs)
		}
	}

	slog.Info("ingest.document.complete",
		"docName", doc.Name,
		"chunks", len(chunks),
		"created", result.ChunksCreated,
		"updated", result.ChunksUpdated,
		"deleted", result.ChunksDeleted,
		"durationMs", time.Since(start).Milliseconds())

	return result, nil
}

// IngestDocuments processes multiple documents sequentially.
func (p *Pipeline) IngestDocuments(ctx context.Context, docs []models.IngestDocument) (*models.IngestResponse, error) {
	start := time.Now()
	resp := &models.IngestResponse{
		Results: make([]models.IngestResult, 0, len(docs)),
	}

	for _, doc := range docs {
		result, err := p.IngestDocument(ctx, doc)
		if err != nil {
			resp.Results = append(resp.Results, models.IngestResult{
				DocName: doc.Name,
				Status:  fmt.Sprintf("error: %s", err.Error()),
			})
			continue
		}
		resp.Results = append(resp.Results, *result)
	}

	resp.TotalDurationMs = time.Since(start).Milliseconds()
	return resp, nil
}

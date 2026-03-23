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
	embeddings *embeddings.Client
	contextual *ContextualRetriever
	qdrant     *qdrantStorage.Client
	cfg        *config.Config
}

// NewPipeline creates a new ingestion pipeline.
func NewPipeline(cfg *config.Config, emb *embeddings.Client, llmClient *llm.Client, qd *qdrantStorage.Client) *Pipeline {
	return &Pipeline{
		embeddings: emb,
		contextual: NewContextualRetriever(llmClient),
		qdrant:     qd,
		cfg:        cfg,
	}
}

// IngestDocument processes a single document through the full pipeline:
// chunk → contextual enrichment → embed → BM25 tokenize → upsert → stale cleanup.
// When force is true the content-hash skip is bypassed so all chunks are
// re-embedded even if their content has not changed (useful after pipeline upgrades).
func (p *Pipeline) IngestDocument(ctx context.Context, doc models.IngestDocument, force bool) (*models.IngestResult, error) {
	start := time.Now()
	result := &models.IngestResult{
		DocName: doc.Name,
		Status:  "success",
	}

	slog.Info("ingest.document.begin", "docName", doc.Name)

	// 1. Chunk by headers, with max size + overlap applied within each section
	chunks := ChunkMarkdown(doc.Name, doc.Content, doc.Tags,
		p.cfg.IngestMinChunkSize, p.cfg.IngestMaxChunkSize, p.cfg.IngestChunkOverlap)
	if len(chunks) == 0 {
		result.Status = "skipped"
		slog.Info("ingest.document.empty", "docName", doc.Name)
		return result, nil
	}

	// 2. Get existing points for stale cleanup
	existingPoints, err := p.qdrant.ScrollByDocName(ctx, doc.Name)
	if err != nil {
		slog.Warn("ingest.scroll.failed", "docName", doc.Name, "error", err)
		existingPoints = make(map[string]string)
	}

	existingByHash := invertPointMap(existingPoints)

	// 3. Contextual enrichment for chunks that need processing
	changedChunks, err := p.enrichSelected(ctx, doc.Name, chunks, existingByHash, force, result)
	if err != nil {
		return nil, err
	}

	// 4. Batch embed + upsert only changed chunks
	if err := p.embedAndUpsert(ctx, changedChunks); err != nil {
		return nil, err
	}

	// 5. Stale cleanup — delete points not in new chunk set
	result.ChunksDeleted = p.cleanupStalePoints(ctx, doc.Name, chunks, existingPoints)

	slog.Info("ingest.document.complete",
		"docName", doc.Name,
		"chunks", len(chunks),
		"created", result.ChunksCreated,
		"skipped", result.ChunksSkipped,
		"deleted", result.ChunksDeleted,
		"durationMs", time.Since(start).Milliseconds())

	return result, nil
}

// invertPointMap returns a contentHash→pointID map from the pointID→contentHash map
// returned by ScrollByDocName.
func invertPointMap(points map[string]string) map[string]string {
	m := make(map[string]string, len(points))
	for pointID, contentHash := range points {
		m[contentHash] = pointID
	}
	return m
}

// selectChunks partitions chunks into those that need processing vs those that
// can be skipped because their content hash already exists in Qdrant. When
// force is true every chunk is selected regardless of hash state.
// skipped is incremented for each bypassed chunk.
func selectChunks(chunks []*models.Chunk, existingByHash map[string]string, force bool, skipped *int) []*models.Chunk {
	selected := make([]*models.Chunk, 0, len(chunks))
	for _, chunk := range chunks {
		if !force {
			if _, exists := existingByHash[chunk.ContentHash]; exists {
				*skipped++
				continue
			}
		}
		selected = append(selected, chunk)
	}
	return selected
}

// enrichSelected runs contextual enrichment on chunks that need processing,
// updating result counters and logging skip diagnostics.
func (p *Pipeline) enrichSelected(ctx context.Context, docName string, chunks []*models.Chunk, existingByHash map[string]string, force bool, result *models.IngestResult) ([]*models.Chunk, error) {
	toProcess := selectChunks(chunks, existingByHash, force, &result.ChunksSkipped)

	if result.ChunksSkipped > 0 {
		slog.Debug("ingest.document.skipped_chunks",
			"docName", docName,
			"skipped", result.ChunksSkipped,
			"hint", "skipped chunks reuse stored embeddings; use force=true on the ingest request to re-embed after a pipeline upgrade")
	}

	enriched := make([]*models.Chunk, 0, len(toProcess))
	for _, chunk := range toProcess {
		ok, err := p.contextual.EnrichChunk(ctx, chunk)
		if err != nil {
			return nil, fmt.Errorf("contextual enrichment failed for chunk %d: %w", chunk.ChunkIndex, err)
		}
		if !ok {
			slog.Debug("ingest.contextual.fallback", "docName", docName, "chunkIndex", chunk.ChunkIndex)
		}
		enriched = append(enriched, chunk)
		result.ChunksCreated++
	}
	return enriched, nil
}

// embedAndUpsert generates dense + sparse vectors for the given chunks and
// upserts them to Qdrant. It is a no-op when chunks is empty.
func (p *Pipeline) embedAndUpsert(ctx context.Context, chunks []*models.Chunk) error {
	if len(chunks) == 0 {
		return nil
	}

	texts := make([]string, len(chunks))
	for i, c := range chunks {
		// Prepend sectionPath so the dense embedding captures document
		// hierarchy (e.g. "Deployment > Publishing Sites") in addition to
		// the contextual prefix and raw content.
		if c.SectionPath != "" {
			texts[i] = c.SectionPath + "\n" + c.ContextualContent
		} else {
			texts[i] = c.ContextualContent
		}
	}

	vectors, err := p.embeddings.GenerateBatch(ctx, texts)
	if err != nil {
		return fmt.Errorf("batch embedding failed: %w", err)
	}

	for i, chunk := range chunks {
		chunk.DenseVector = vectors[i]
		chunk.SparseVector = Tokenize(chunk.ContextualContent)
	}

	if err := p.qdrant.BatchUpsert(ctx, chunks); err != nil {
		return fmt.Errorf("upsert failed: %w", err)
	}
	return nil
}

// IngestDocuments processes multiple documents sequentially.
func (p *Pipeline) IngestDocuments(ctx context.Context, docs []models.IngestDocument, force bool) (*models.IngestResponse, error) {
	start := time.Now()
	resp := &models.IngestResponse{
		Results: make([]models.IngestResult, 0, len(docs)),
	}

	if force {
		slog.Info("ingest.force_mode", "docs", len(docs),
			"hint", "content-hash skip bypassed; all chunks will be re-embedded")
	}

	for _, doc := range docs {
		result, err := p.IngestDocument(ctx, doc, force)
		if err != nil {
			resp.Results = append(resp.Results, models.IngestResult{
				DocName: doc.Name,
				Status:  "error: " + err.Error(),
			})
			continue
		}
		resp.Results = append(resp.Results, *result)
	}

	resp.TotalDurationMs = time.Since(start).Milliseconds()
	return resp, nil
}

// cleanupStalePoints deletes points whose content hashes are no longer present in the
// new chunk set. Returns the number of points deleted.
func (p *Pipeline) cleanupStalePoints(ctx context.Context, docName string, chunks []*models.Chunk, existingPoints map[string]string) int {
	newHashes := make(map[string]bool, len(chunks))
	for _, chunk := range chunks {
		newHashes[chunk.ContentHash] = true
	}

	var staleIDs []string
	for pointID, contentHash := range existingPoints {
		if !newHashes[contentHash] {
			staleIDs = append(staleIDs, pointID)
		}
	}

	if len(staleIDs) == 0 {
		return 0
	}

	if err := p.qdrant.DeletePoints(ctx, staleIDs); err != nil {
		slog.Warn("ingest.cleanup.failed", "docName", docName, "error", err)
		return 0
	}

	return len(staleIDs)
}

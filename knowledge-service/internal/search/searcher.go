package search

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/qdrant/go-client/qdrant"

	"github.com/airo-ai-builder/knowledge-service/internal/config"
	"github.com/airo-ai-builder/knowledge-service/internal/embeddings"
	"github.com/airo-ai-builder/knowledge-service/internal/ingest"
	qdrantStorage "github.com/airo-ai-builder/knowledge-service/internal/storage/qdrant"
	"github.com/airo-ai-builder/knowledge-service/pkg/models"
)

// Searcher orchestrates the search flow: embed → tokenize → hybrid search → dedup → format.
type Searcher struct {
	embeddings *embeddings.Client
	qdrant     *qdrantStorage.Client
	cfg        *config.Config
}

// New creates a new Searcher.
func New(cfg *config.Config, emb *embeddings.Client, qd *qdrantStorage.Client) *Searcher {
	return &Searcher{
		embeddings: emb,
		qdrant:     qd,
		cfg:        cfg,
	}
}

// Search executes the full search pipeline.
func (s *Searcher) Search(ctx context.Context, req models.SearchRequest) (*models.SearchResponse, error) {
	start := time.Now()

	topN := req.TopN
	if topN <= 0 {
		topN = s.cfg.SearchTopN
	}
	if topN > 50 {
		topN = 50
	}

	slog.Info("search.begin", "query", req.Query, "topN", topN)

	// 1. Embed query
	denseVector, err := s.embeddings.Generate(ctx, req.Query)
	if err != nil {
		return nil, fmt.Errorf("failed to embed query: %w", err)
	}

	// 2. Tokenize query for sparse search
	sparseVector := ingest.Tokenize(req.Query)

	// 3. Hybrid search
	results, err := s.qdrant.HybridSearch(ctx, qdrantStorage.HybridSearchParams{
		DenseVector:    denseVector,
		SparseVector:   sparseVector,
		Limit:          uint64(topN), //nolint:gosec // G115: topN is bounds-checked above (1..50)
		DocNamesFilter: req.Filters.DocNames,
		TagsFilter:     req.Filters.Tags,
	})
	if err != nil {
		return nil, fmt.Errorf("hybrid search failed: %w", err)
	}

	// 4. Per-document dedup (keep highest-scoring chunk per docName)
	deduped := dedupByDocName(results)

	// 5. Trim to topN
	if len(deduped) > topN {
		deduped = deduped[:topN]
	}

	// 6. Format response
	searchResults := make([]models.SearchResult, len(deduped))
	for i, point := range deduped {
		searchResults[i] = pointToSearchResult(point)
	}

	duration := time.Since(start).Milliseconds()
	slog.Info("search.complete",
		"query", req.Query,
		"results", len(searchResults),
		"durationMs", duration)

	return &models.SearchResponse{
		Results: searchResults,
		Meta: models.SearchMeta{
			Total:            len(searchResults),
			Query:            req.Query,
			SearchDurationMs: duration,
		},
	}, nil
}

// dedupByDocName keeps only the highest-scoring result per docName.
// Input is assumed to be sorted by score descending (Qdrant default).
func dedupByDocName(points []*qdrant.ScoredPoint) []*qdrant.ScoredPoint {
	seen := make(map[string]bool)
	var result []*qdrant.ScoredPoint

	for _, point := range points {
		docName := getPayloadString(point.Payload, "docName")
		if docName == "" {
			result = append(result, point)
			continue
		}
		if seen[docName] {
			continue
		}
		seen[docName] = true
		result = append(result, point)
	}

	return result
}

// pointToSearchResult converts a Qdrant ScoredPoint to a SearchResult.
func pointToSearchResult(point *qdrant.ScoredPoint) models.SearchResult {
	return models.SearchResult{
		DocName:     getPayloadString(point.Payload, "docName"),
		SectionPath: getPayloadString(point.Payload, "sectionPath"),
		Content:     getPayloadString(point.Payload, "content"),
		Score:       point.Score,
		ChunkIndex:  getPayloadInt(point.Payload, "chunkIndex"),
	}
}

func getPayloadString(payload map[string]*qdrant.Value, key string) string {
	if v, ok := payload[key]; ok {
		if sv, ok := v.Kind.(*qdrant.Value_StringValue); ok {
			return sv.StringValue
		}
	}
	return ""
}

func getPayloadInt(payload map[string]*qdrant.Value, key string) int {
	if v, ok := payload[key]; ok {
		if iv, ok := v.Kind.(*qdrant.Value_IntegerValue); ok {
			return int(iv.IntegerValue)
		}
	}
	return 0
}

package search

import (
	"context"
	"log/slog"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/qdrant/go-client/qdrant"

	"github.com/airo-ai-builder/knowledge-service/internal/config"
	"github.com/airo-ai-builder/knowledge-service/internal/embeddings"
	"github.com/airo-ai-builder/knowledge-service/internal/ingest"
	qdrantStorage "github.com/airo-ai-builder/knowledge-service/internal/storage/qdrant"
	"github.com/airo-ai-builder/knowledge-service/pkg/models"
)

// Searcher orchestrates the search flow: rewrite → embed → hybrid search → calibrate → format.
type Searcher struct {
	embeddings *embeddings.Client
	qdrant     *qdrantStorage.Client
	cfg        *config.Config
	rewriter   *QueryRewriter
	calibrator *Calibrator
}

// New creates a new Searcher.
func New(cfg *config.Config, emb *embeddings.Client, qd *qdrantStorage.Client, rewriter *QueryRewriter) *Searcher {
	return &Searcher{
		embeddings: emb,
		qdrant:     qd,
		cfg:        cfg,
		rewriter:   rewriter,
		calibrator: NewCalibrator(
			cfg.SearchCalibrationMidpoint,
			cfg.SearchCalibrationSteepness,
			cfg.SearchConfidenceThreshold,
		),
	}
}

// Search executes the full search pipeline with HyDE, multi-query retrieval,
// and parent-section context expansion.
//
// Up to three search strategies run concurrently:
//  1. Original query → embed → hybrid search (always)
//  2. HyDE: LLM generates a hypothetical document → embed → search (when enabled)
//  3. Multi-query: LLM generates N query variants → embed each → search (when enabled)
//
// Results from all strategies are merged by point ID (best score wins),
// then calibrated, filtered, and enriched with section context.
func (s *Searcher) Search(ctx context.Context, req models.SearchRequest) (*models.SearchResponse, error) {
	start := time.Now()

	topN := s.clampTopN(req.TopN)
	fetchLimit := s.fetchLimit(topN)
	slog.Info("search.begin", "query", req.Query, "topN", topN)

	var (
		originalPoints []*qdrant.ScoredPoint
		originalErr    error
		hydePoints     []*qdrant.ScoredPoint
		hydeDoc        string
		multiPoints    [][]*qdrant.ScoredPoint
		multiCount     int
		wg             sync.WaitGroup
	)

	// 1. Original query search — starts immediately
	wg.Add(1)
	go func() {
		defer wg.Done()
		originalPoints, originalErr = s.hybridSearchFor(ctx, req.Query, fetchLimit, req.Filters)
	}()

	// 2. HyDE search — runs concurrently when enabled
	if s.rewriter != nil && s.cfg.SearchLLMEnhanced {
		wg.Add(1)
		go func() {
			defer wg.Done()
			hydeDoc, hydePoints = s.hydeSearch(ctx, req.Query, fetchLimit, req.Filters)
		}()
	}

	// 3. Multi-query retrieval — generates N query variants and searches each
	if s.rewriter != nil && s.cfg.SearchLLMEnhanced {
		wg.Add(1)
		go func() {
			defer wg.Done()
			multiCount, multiPoints = s.multiQuerySearch(ctx, req.Query, fetchLimit, req.Filters)
		}()
	}

	wg.Wait()

	hasAlternatives := len(hydePoints) > 0 || len(multiPoints) > 0
	if originalErr != nil && !hasAlternatives {
		return nil, originalErr
	}
	if originalErr != nil && hasAlternatives {
		slog.Warn("search.original.failed_with_alternatives",
			"error", originalErr,
			"hydeResults", len(hydePoints),
			"multiQueryResults", len(multiPoints))
	}

	// Merge all result sets: original + HyDE + multi-query variants
	merged := originalPoints
	if len(hydePoints) > 0 {
		merged = mergeResults(merged, hydePoints)
	}
	for _, mp := range multiPoints {
		merged = mergeResults(merged, mp)
	}

	// Limit per doc → trim → calibrate → expand context
	searchResults, filtered := s.processResults(ctx, merged, topN)

	duration := time.Since(start).Milliseconds()
	slog.Info("search.complete",
		"query", req.Query,
		"hydeEnabled", hydeDoc != "",
		"multiQueryVariants", multiCount,
		"results", len(searchResults),
		"filtered", filtered,
		"durationMs", duration)

	return &models.SearchResponse{
		Results: searchResults,
		Meta: models.SearchMeta{
			Total:            len(searchResults),
			Query:            req.Query,
			HyDE:             hydeDoc,
			MultiQueryCount:  multiCount,
			SearchDurationMs: duration,
			Filtered:         filtered,
		},
	}, nil
}

// clampTopN applies defaults and upper bounds to topN.
func (s *Searcher) clampTopN(topN int) int {
	if topN <= 0 {
		topN = s.cfg.SearchTopN
	}
	if topN > 50 {
		topN = 50
	}
	return topN
}

// fetchLimit computes the over-fetch limit to give per-doc dedup enough candidates.
func (s *Searcher) fetchLimit(topN int) uint64 {
	maxPerDoc := s.cfg.SearchMaxChunksPerDoc
	if maxPerDoc <= 0 {
		maxPerDoc = 3
	}
	limit := topN * maxPerDoc
	if limit < 30 {
		limit = 30
	}
	return uint64(limit) //nolint:gosec // G115: limit is bounds-checked above
}

// hydeSearch generates a hypothetical document and searches with it.
func (s *Searcher) hydeSearch(ctx context.Context, query string, limit uint64, filters models.SearchFilters) (string, []*qdrant.ScoredPoint) {
	hydeDoc := s.rewriter.Hypothesize(ctx, query)
	if hydeDoc == "" {
		return "", nil
	}
	points, err := s.hybridSearchFor(ctx, hydeDoc, limit, filters)
	if err != nil {
		slog.Warn("search.hyde.search.failed", "error", err)
		return hydeDoc, nil
	}
	return hydeDoc, points
}

// multiQuerySearch generates N query variants and searches each in parallel.
func (s *Searcher) multiQuerySearch(ctx context.Context, query string, limit uint64, filters models.SearchFilters) (int, [][]*qdrant.ScoredPoint) {
	variants := s.rewriter.GenerateMultiQueries(ctx, query, s.cfg.SearchMultiQueryCount)
	if len(variants) == 0 {
		return 0, nil
	}

	var (
		mu      sync.Mutex
		results [][]*qdrant.ScoredPoint
		wg      sync.WaitGroup
	)
	for _, v := range variants {
		wg.Add(1)
		go func(q string) {
			defer wg.Done()
			points, err := s.hybridSearchFor(ctx, q, limit, filters)
			if err != nil {
				slog.Warn("search.multiquery.search.failed", "variant", q, "error", err)
				return
			}
			mu.Lock()
			results = append(results, points)
			mu.Unlock()
		}(v)
	}
	wg.Wait()
	return len(variants), results
}

// hybridSearchFor embeds a query and runs multi-stage hybrid search.
func (s *Searcher) hybridSearchFor(ctx context.Context, query string, limit uint64, filters models.SearchFilters) ([]*qdrant.ScoredPoint, error) {
	pair, err := s.embeddings.GenerateDual(ctx, query)
	if err != nil {
		return nil, err
	}
	sparse := ingest.Tokenize(query)

	return s.qdrant.HybridSearch(ctx, qdrantStorage.HybridSearchParams{
		DenseFastVector:    pair.Fast,
		DensePreciseVector: pair.Precise,
		SparseVector:       sparse,
		Limit:              limit,
		DocNamesFilter:     filters.DocNames,
		TagsFilter:         filters.Tags,
	})
}

// processResults applies per-doc limiting, topN trimming, score calibration,
// confidence filtering, and adjacent context expansion.
// Adjacent content fetches run concurrently to avoid N+1 latency.
func (s *Searcher) processResults(ctx context.Context, results []*qdrant.ScoredPoint, topN int) ([]models.SearchResult, int) {
	maxPerDoc := s.cfg.SearchMaxChunksPerDoc
	if maxPerDoc <= 0 {
		maxPerDoc = 3
	}

	limited := limitPerDocName(results, maxPerDoc)
	if len(limited) > topN {
		limited = limited[:topN]
	}

	filtered := 0
	searchResults := make([]models.SearchResult, 0, len(limited))
	for _, point := range limited {
		confidence := s.calibrator.Calibrate(point.Score)
		if !s.calibrator.AboveThreshold(confidence) {
			filtered++
			continue
		}
		sr := pointToSearchResult(point)
		sr.RawScore = point.Score
		sr.Confidence = s.calibrator.ConfidenceLevel(confidence)
		sr.Score = confidence
		searchResults = append(searchResults, sr)
	}

	// Fetch parent-section context concurrently for all results
	if len(searchResults) > 0 {
		var wg sync.WaitGroup
		for i := range searchResults {
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()
				sr := &searchResults[idx]
				if sectionCtx := s.qdrant.FetchSectionContent(ctx, sr.DocName, sr.SectionPath, sr.ChunkIndex); sectionCtx != "" {
					sr.Context = sectionCtx
				}
			}(i)
		}
		wg.Wait()
	}

	return searchResults, filtered
}

// mergeResults combines two scored-point slices, deduplicating by point ID
// and keeping the higher score when duplicates are found. Result is sorted by
// score descending.
func mergeResults(a, b []*qdrant.ScoredPoint) []*qdrant.ScoredPoint {
	seen := make(map[string]*qdrant.ScoredPoint, len(a))
	for _, p := range a {
		id := extractPointID(p.Id)
		seen[id] = p
	}
	for _, p := range b {
		id := extractPointID(p.Id)
		if existing, ok := seen[id]; ok {
			if p.Score > existing.Score {
				seen[id] = p
			}
		} else {
			seen[id] = p
		}
	}

	merged := make([]*qdrant.ScoredPoint, 0, len(seen))
	for _, p := range seen {
		merged = append(merged, p)
	}
	slices.SortFunc(merged, func(a, b *qdrant.ScoredPoint) int {
		if b.Score > a.Score {
			return 1
		}
		if b.Score < a.Score {
			return -1
		}
		return 0
	})
	return merged
}

func extractPointID(id *qdrant.PointId) string {
	if id == nil {
		return ""
	}
	switch v := id.PointIdOptions.(type) {
	case *qdrant.PointId_Uuid:
		return v.Uuid
	case *qdrant.PointId_Num:
		return strconv.FormatUint(v.Num, 10)
	default:
		return ""
	}
}

// limitPerDocName keeps up to maxPerDoc highest-scoring results per docName.
// Input is assumed to be sorted by score descending (Qdrant default).
// If maxPerDoc <= 0 it defaults to 1 (equivalent to the old dedup behavior).
func limitPerDocName(points []*qdrant.ScoredPoint, maxPerDoc int) []*qdrant.ScoredPoint {
	if maxPerDoc <= 0 {
		maxPerDoc = 1
	}
	counts := make(map[string]int)
	var result []*qdrant.ScoredPoint

	for _, point := range points {
		docName := getPayloadString(point.Payload, "docName")
		if docName == "" {
			result = append(result, point)
			continue
		}
		if counts[docName] >= maxPerDoc {
			continue
		}
		counts[docName]++
		result = append(result, point)
	}

	return result
}

// pointToSearchResult converts a Qdrant ScoredPoint to a SearchResult.
func pointToSearchResult(point *qdrant.ScoredPoint) models.SearchResult {
	return models.SearchResult{
		DocName:           getPayloadString(point.Payload, "docName"),
		SectionPath:       getPayloadString(point.Payload, "sectionPath"),
		Content:           getPayloadString(point.Payload, "content"),
		ContextualContent: getPayloadString(point.Payload, "contextualContent"),
		Score:             point.Score,
		ChunkIndex:        getPayloadInt(point.Payload, "chunkIndex"),
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

// Package search provides the hybrid search orchestration logic.
package search

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/airo-ai-builder/image-search-service/internal/analysis"
	"github.com/airo-ai-builder/image-search-service/internal/embeddings"
	"github.com/airo-ai-builder/image-search-service/internal/getty"
	"github.com/airo-ai-builder/image-search-service/internal/storage/qdrant"
	"github.com/airo-ai-builder/image-search-service/internal/storage/s3"
	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

// Orchestrator coordinates the hybrid search flow.
type Orchestrator struct {
	getty             *getty.Client
	analysis          *analysis.Client
	embeddings        *embeddings.Client
	qdrant            *qdrant.Client
	s3                *s3.Client
	minRelevanceScore float32
}

// New creates a new search orchestrator.
func New(
	getty *getty.Client,
	analysis *analysis.Client,
	embeddings *embeddings.Client,
	qdrant *qdrant.Client,
	s3 *s3.Client,
	minRelevanceScore float32,
) *Orchestrator {
	return &Orchestrator{
		getty:             getty,
		analysis:          analysis,
		embeddings:        embeddings,
		qdrant:            qdrant,
		s3:                s3,
		minRelevanceScore: minRelevanceScore,
	}
}

// SearchParams contains the parameters for a search request.
type SearchParams struct {
	Query          string
	Count          int
	Filters        models.SearchFilters
	MinCached      int
	MaxWaitSeconds int
}

// SearchResult contains the results of a search.
type SearchResult struct {
	Results         []*models.ImageAnalysis
	CachedCount     int
	AnalyzedCount   int
	PendingAnalysis int
	Complete        bool
}

// Search performs the hybrid search flow:
// 1. Generate embedding from query
// 2. Search Qdrant with embedding + filters
// 3. If results >= minCached, return (queue Getty candidates for background analysis)
// 4. If results < minCached, query Getty, analyze uncached, re-query Qdrant
// 5. Return results sorted by relevance
func (o *Orchestrator) Search(ctx context.Context, params SearchParams) (*SearchResult, error) {
	start := time.Now()
	slog.Info("search.start", "query", params.Query, "count", params.Count, "minCached", params.MinCached)

	// Step 1: Generate embedding from query
	embeddingStart := time.Now()
	queryEmbedding, err := o.embeddings.Generate(ctx, params.Query)
	if err != nil {
		return nil, fmt.Errorf("failed to generate query embedding: %w", err)
	}
	slog.Info("search.embedding.complete", "durationMs", time.Since(embeddingStart).Milliseconds())

	// Validate embedding is not empty
	if len(queryEmbedding) == 0 {
		return nil, errors.New("empty embedding generated for query")
	}

	// Step 2: Search Qdrant with embedding + filters
	qdrantStart := time.Now()
	cachedResults, err := o.qdrant.Search(ctx, queryEmbedding, params.Filters, params.Count, o.minRelevanceScore)
	if err != nil {
		slog.Warn("search.qdrant.error", "error", err)
		cachedResults = nil
	}
	slog.Info("search.qdrant.complete", "cached", len(cachedResults), "durationMs", time.Since(qdrantStart).Milliseconds())

	// Step 3: Check if we have enough cached results
	if len(cachedResults) >= params.MinCached {
		slog.Info("search.sufficient.cached", "cached", len(cachedResults), "minCached", params.MinCached)

		// Queue Getty search + analysis in background for cache warming
		// Use detached context with timeout to prevent goroutine leaks
		bgCtx, bgCancel := context.WithTimeout(context.Background(), 5*time.Minute)
		go func() {
			defer bgCancel()
			o.warmCacheInBackground(bgCtx, params.Query, params.Count*2, cachedResults)
		}()

		results := collectResults(cachedResults, params.Count)
		return &SearchResult{
			Results:         results,
			CachedCount:     len(results),
			AnalyzedCount:   0,
			PendingAnalysis: 0,
			Complete:        true,
		}, nil
	}

	// Step 4: Not enough cached - fetch from Getty, analyze, re-query Qdrant
	slog.Info("search.fetching.getty", "cached", len(cachedResults), "minCached", params.MinCached)

	// Query Getty for candidates
	gettyStart := time.Now()
	gettyResults, err := o.getty.Search(ctx, params.Query, params.Count*2)
	if err != nil {
		// If Getty fails but we have some cached results, return those
		if len(cachedResults) > 0 {
			slog.Warn("search.getty.failed.returning.cached", "error", err, "cachedCount", len(cachedResults))
			results := collectResults(cachedResults, params.Count)
			return &SearchResult{
				Results:         results,
				CachedCount:     len(results),
				AnalyzedCount:   0,
				PendingAnalysis: 0,
				Complete:        false,
			}, nil
		}
		return nil, fmt.Errorf("failed to search Getty: %w", err)
	}
	slog.Info("search.getty.complete", "count", len(gettyResults), "durationMs", time.Since(gettyStart).Milliseconds())

	if len(gettyResults) == 0 {
		// No Getty results, return whatever we have from cache
		results := collectResults(cachedResults, params.Count)
		return &SearchResult{
			Results:         results,
			CachedCount:     len(results),
			AnalyzedCount:   0,
			PendingAnalysis: 0,
			Complete:        true,
		}, nil
	}

	// Build Getty result map and check which are already cached
	gettyIDs := make([]string, len(gettyResults))
	gettyResultMap := make(map[string]getty.SearchResult, len(gettyResults))
	for i, result := range gettyResults {
		gettyIDs[i] = result.GettyID
		gettyResultMap[result.GettyID] = result
	}

	// Check which Getty results are already in Qdrant
	existingAnalyses, err := o.qdrant.GetByIDs(ctx, gettyIDs)
	if err != nil {
		slog.Warn("search.cache.check.error", "error", err)
		existingAnalyses = make(map[string]*models.ImageAnalysis)
	}

	// Identify uncached images
	var uncachedIDs []string
	for _, id := range gettyIDs {
		if _, found := existingAnalyses[id]; !found {
			uncachedIDs = append(uncachedIDs, id)
		}
	}
	slog.Info("search.uncached.count", "uncached", len(uncachedIDs), "alreadyCached", len(existingAnalyses))

	// Analyze uncached with timeout
	var analyzedCount int
	if len(uncachedIDs) > 0 {
		waitCtx, cancel := context.WithTimeout(ctx, time.Duration(params.MaxWaitSeconds)*time.Second)
		defer cancel()

		newlyAnalyzed := o.analyzeWithTimeout(waitCtx, uncachedIDs, gettyResultMap)
		analyzedCount = len(newlyAnalyzed)
		slog.Info("search.analyzed.complete", "analyzed", analyzedCount)
	}

	// Re-query Qdrant with filters to get fresh, sorted results
	finalResults, err := o.qdrant.Search(ctx, queryEmbedding, params.Filters, params.Count, o.minRelevanceScore)
	if err != nil {
		slog.Warn("search.final.qdrant.error", "error", err)
		// Fall back to initial cached results if re-query fails
		finalResults = cachedResults
	}

	results := collectResults(finalResults, params.Count)

	// Calculate pending (uncached that weren't analyzed in time)
	pendingCount := len(uncachedIDs) - analyzedCount
	if pendingCount < 0 {
		pendingCount = 0
	}

	slog.Info("search.complete", "results", len(results), "totalDurationMs", time.Since(start).Milliseconds())

	// CachedCount reflects items that were already in cache before this request
	// (not filtered by current query filters, just raw cache hits from Getty IDs)
	return &SearchResult{
		Results:         results,
		CachedCount:     len(existingAnalyses),
		AnalyzedCount:   analyzedCount,
		PendingAnalysis: pendingCount,
		Complete:        pendingCount == 0,
	}, nil
}

// warmCacheInBackground fetches Getty candidates and analyzes uncached ones to grow the cache.
func (o *Orchestrator) warmCacheInBackground(ctx context.Context, query string, count int, alreadyCached []*models.ImageAnalysis) {
	slog.Info("search.background.start", "query", query, "count", count, "alreadyCachedCount", len(alreadyCached))

	// Build set of already cached IDs
	cachedIDs := make(map[string]bool, len(alreadyCached))
	for _, a := range alreadyCached {
		if a == nil {
			continue
		}
		cachedIDs[a.GettyID] = true
	}

	// Fetch Getty candidates
	gettyResults, err := o.getty.Search(ctx, query, count)
	if err != nil {
		slog.Warn("search.background.getty.failed", "error", err)
		return
	}

	// Analyze uncached
	for _, result := range gettyResults {
		if cachedIDs[result.GettyID] {
			continue
		}

		_, err := o.analyzeAndStore(ctx, result)
		if err != nil {
			slog.Warn("search.background.analysis.failed", "gettyId", result.GettyID, "error", err)
			continue
		}
		slog.Info("search.background.analysis.complete", "gettyId", result.GettyID)
	}
}

// analyzeWithTimeout analyzes images until timeout, returning what completed.
func (o *Orchestrator) analyzeWithTimeout(ctx context.Context, ids []string, gettyResults map[string]getty.SearchResult) map[string]*models.ImageAnalysis {
	results := make(map[string]*models.ImageAnalysis)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, id := range ids {
		result, ok := gettyResults[id]
		if !ok {
			continue
		}

		wg.Add(1)
		go func(result getty.SearchResult) {
			defer wg.Done()

			analyzed, err := o.analyzeAndStore(ctx, result)
			if err != nil {
				if ctx.Err() == nil { // Only log if not cancelled
					slog.Warn("search.analysis.failed", "gettyId", result.GettyID, "error", err)
				}
				return
			}

			mu.Lock()
			results[analyzed.GettyID] = analyzed
			mu.Unlock()
		}(result)
	}

	// Wait for completion or context cancellation
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		// All completed
	case <-ctx.Done():
		// Timeout - return what we have
	}

	return results
}

// analyzeAndStore analyzes a single image, generates embedding, and stores in Qdrant/S3.
func (o *Orchestrator) analyzeAndStore(ctx context.Context, gettyResult getty.SearchResult) (*models.ImageAnalysis, error) {
	// Use preview URL for analysis
	imageURL := gettyResult.Preview
	if imageURL == "" {
		imageURL = gettyResult.Thumbnail
	}

	// Analyze with Haiku
	analysisResult, err := o.analysis.Analyze(ctx, imageURL)
	if err != nil {
		return nil, err
	}

	// Convert to ImageAnalysis
	imgAnalysis := analysis.ToImageAnalysis(analysisResult)

	// Populate metadata from Getty
	imgAnalysis.GettyID = gettyResult.GettyID
	imgAnalysis.Title = gettyResult.Title
	imgAnalysis.Caption = gettyResult.Caption
	imgAnalysis.Dimensions = models.ImageDimensions{
		Width:  gettyResult.Width,
		Height: gettyResult.Height,
	}
	imgAnalysis.URLs = models.ImageURLs{
		Thumbnail: gettyResult.Thumbnail,
		Preview:   gettyResult.Preview,
	}
	imgAnalysis.AnalyzedAt = time.Now()
	imgAnalysis.AnalysisVersion = "1"

	// Calculate aspect ratio category
	imgAnalysis.AspectRatioCategory = calculateAspectRatio(gettyResult.Width, gettyResult.Height)

	// Generate embedding from analysis text
	embedding, err := o.embeddings.Generate(ctx, imgAnalysis.EmbeddingText())
	if err != nil {
		return nil, err
	}
	imgAnalysis.Embedding = embedding

	// Store in Qdrant
	if err := o.qdrant.Upsert(ctx, imgAnalysis); err != nil {
		slog.Warn("search.qdrant.upsert.failed", "gettyId", gettyResult.GettyID, "error", err)
	} else {
		slog.Debug("search.qdrant.upsert.success", "gettyId", gettyResult.GettyID)
	}

	// Store in S3 (if configured)
	if o.s3 != nil {
		if err := o.s3.Store(ctx, imgAnalysis); err != nil {
			slog.Warn("search.s3.store.failed", "gettyId", gettyResult.GettyID, "error", err)
		}
	}

	return imgAnalysis, nil
}

// collectResults sorts analyses by relevance score (descending) and returns up to limit results.
func collectResults(analyses []*models.ImageAnalysis, limit int) []*models.ImageAnalysis {
	sorted := sortByRelevance(analyses)
	if len(sorted) <= limit {
		return sorted
	}
	return sorted[:limit]
}

// calculateAspectRatio determines the aspect ratio category from dimensions.
func calculateAspectRatio(width, height int) models.AspectRatioCategory {
	if width == 0 || height == 0 {
		return models.AspectRatioCategorySquare
	}

	ratio := float64(width) / float64(height)

	switch {
	case ratio > 2.0:
		return models.AspectRatioCategoryPanoramic
	case ratio > 1.2:
		return models.AspectRatioCategoryLandscape
	case ratio < 0.5:
		return models.AspectRatioCategoryVerticalBanner
	case ratio < 0.8:
		return models.AspectRatioCategoryPortrait
	default:
		return models.AspectRatioCategorySquare
	}
}

// sortByRelevance sorts analyses by RelevanceScore in descending order.
func sortByRelevance(analyses []*models.ImageAnalysis) []*models.ImageAnalysis {
	if len(analyses) <= 1 {
		return analyses
	}

	// Make a copy to avoid mutating the input
	result := make([]*models.ImageAnalysis, len(analyses))
	copy(result, analyses)

	slices.SortFunc(result, func(a, b *models.ImageAnalysis) int {
		if a.RelevanceScore > b.RelevanceScore {
			return -1
		}
		if a.RelevanceScore < b.RelevanceScore {
			return 1
		}
		return 0
	})

	return result
}

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
	"github.com/airo-ai-builder/image-search-service/internal/sparse"
	"github.com/airo-ai-builder/image-search-service/internal/storage/qdrant"
	"github.com/airo-ai-builder/image-search-service/internal/storage/s3"
	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

// Orchestrator coordinates the hybrid search flow.
type Orchestrator struct {
	getty              *getty.Client
	analysis           *analysis.Client
	embeddings         *embeddings.Client
	qdrant             *qdrant.Client
	s3                 *s3.Client
	relativeScoreRatio float32
}

// New creates a new search orchestrator.
func New(
	getty *getty.Client,
	analysis *analysis.Client,
	embeddings *embeddings.Client,
	qdrant *qdrant.Client,
	s3 *s3.Client,
	relativeScoreRatio float32,
) *Orchestrator {
	return &Orchestrator{
		getty:              getty,
		analysis:           analysis,
		embeddings:         embeddings,
		qdrant:             qdrant,
		s3:                 s3,
		relativeScoreRatio: relativeScoreRatio,
	}
}

// SearchParams contains the parameters for a search request.
type SearchParams struct {
	Query          string
	Context        string
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
func (o *Orchestrator) Search(ctx context.Context, params SearchParams) (*SearchResult, error) { //nolint:gocyclo // breaking up Search() would hurt readability
	start := time.Now()
	slog.Info("search.start", "query", params.Query, "context", params.Context, "count", params.Count, "minCached", params.MinCached)

	// Step 1: Generate embeddings
	// Raw query embedding + sparse vector for precise retrieval (exact keyword matching).
	// Context embedding (query + context) for re-ranking candidates by purpose/style fit.
	embeddingStart := time.Now()
	queryEmbedding, err := o.embeddings.Generate(ctx, params.Query)
	if err != nil {
		return nil, fmt.Errorf("failed to generate query embedding: %w", err)
	}
	if len(queryEmbedding) == 0 {
		return nil, errors.New("empty embedding generated for query")
	}

	// Generate sparse vector from raw query only (domain-specific keywords)
	sparseIndices, sparseValues := sparse.Vectorize(params.Query)

	// Generate context embedding for re-ranking (if context provided)
	var contextEmbedding []float32
	if params.Context != "" {
		enrichedQuery := params.Query + " " + params.Context
		contextEmbedding, err = o.embeddings.Generate(ctx, enrichedQuery)
		if err != nil {
			slog.Warn("search.context.embedding.failed", "error", err)
			// Non-fatal: fall back to single-stage search without context rescore
		}
	}
	slog.Info("search.embedding.complete", "durationMs", time.Since(embeddingStart).Milliseconds(), "hasContext", len(contextEmbedding) > 0)

	// Step 2: Hybrid search Qdrant with dense + sparse vectors, optionally rescored by context.
	qdrantStart := time.Now()
	cachedResults, err := o.qdrant.HybridSearch(ctx, queryEmbedding, sparseIndices, sparseValues, contextEmbedding, params.Filters, params.Count)
	if err != nil {
		slog.Warn("search.qdrant.error", "error", err)
		cachedResults = nil
	}
	slog.Info("search.qdrant.complete", "cached", len(cachedResults), "durationMs", time.Since(qdrantStart).Milliseconds())

	// Step 3: Check if we have enough cached results
	// MinCached=0 means "always query Getty" (skip early return), used for cache filling.
	if params.MinCached > 0 && len(cachedResults) >= params.MinCached {
		slog.Info("search.sufficient.cached", "cached", len(cachedResults), "minCached", params.MinCached)

		// Queue Getty search + analysis in background for cache warming
		// Use detached context with timeout to prevent goroutine leaks
		bgCtx, bgCancel := context.WithTimeout(context.Background(), 5*time.Minute)
		go func() {
			defer bgCancel()
			o.warmCacheInBackground(bgCtx, params.Query, params.Count*2, cachedResults)
		}()

		results := collectResults(cachedResults, params.Count, 0)
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

	gettyResults, earlyResult, err := o.fetchGettyResults(ctx, params, cachedResults)
	if err != nil {
		return nil, err
	}
	if earlyResult != nil {
		return earlyResult, nil
	}

	// Build Getty result map and check which are already cached
	gettyIDs := make([]string, len(gettyResults))
	gettyResultMap := make(map[string]getty.ImageResult, len(gettyResults))
	for i, result := range gettyResults {
		gettyIDs[i] = result.ID
		gettyResultMap[result.ID] = result
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

	// Re-query Qdrant with hybrid search to get RRF-fused results including newly analyzed images.
	finalResults, err := o.qdrant.HybridSearch(ctx, queryEmbedding, sparseIndices, sparseValues, contextEmbedding, params.Filters, params.Count)
	if err != nil {
		slog.Warn("search.final.qdrant.error", "error", err)
		// Fall back to initial cached results if re-query fails
		finalResults = cachedResults
	}
	slog.Info("search.final.results", "candidates", len(finalResults))

	results := collectResults(finalResults, params.Count, 0)

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

	// Fetch Getty candidates (background warming uses default options)
	gettyOpts := getty.NewSearchOptions(query)
	gettyOpts.PageSize = count
	gettyOpts.Fields = gettyMetadataFields
	gettyResp, err := o.getty.SearchWithOptions(ctx, gettyOpts)
	var gettyResults []getty.ImageResult
	if gettyResp != nil {
		gettyResults = gettyResp.Images
	}
	if err != nil {
		slog.Warn("search.background.getty.failed", "error", err)
		return
	}

	// Analyze uncached
	for _, result := range gettyResults {
		if cachedIDs[result.ID] {
			continue
		}

		_, err := o.analyzeAndStore(ctx, result)
		if err != nil {
			slog.Warn("search.background.analysis.failed", "gettyId", result.ID, "error", err)
			continue
		}
		slog.Info("search.background.analysis.complete", "gettyId", result.ID)
	}
}

// fetchGettyResults queries Getty for candidates and handles error/empty cases.
// Returns (results, earlyReturn, error) - if earlyReturn is non-nil, caller should return it directly.
func (o *Orchestrator) fetchGettyResults(
	ctx context.Context,
	params SearchParams,
	cachedResults []*models.ImageAnalysis,
) ([]getty.ImageResult, *SearchResult, error) {
	gettyStart := time.Now()
	gettyOpts := filtersToGettyOptions(params.Query, params.Count*4, params.Filters)
	gettyResp, err := o.getty.SearchWithOptions(ctx, gettyOpts)
	var gettyResults []getty.ImageResult
	if gettyResp != nil {
		gettyResults = gettyResp.Images
	}
	if err != nil {
		// If Getty fails but we have some cached results, return those
		if len(cachedResults) > 0 {
			slog.Warn("search.getty.failed.returning.cached", "error", err, "cachedCount", len(cachedResults))
			results := collectResults(cachedResults, params.Count, 0)
			return nil, &SearchResult{
				Results:         results,
				CachedCount:     len(results),
				AnalyzedCount:   0,
				PendingAnalysis: 0,
				Complete:        false,
			}, nil
		}
		return nil, nil, fmt.Errorf("failed to search Getty: %w", err)
	}
	slog.Info("search.getty.complete", "count", len(gettyResults), "durationMs", time.Since(gettyStart).Milliseconds())

	if len(gettyResults) == 0 && hasGettyFilters(params.Filters) {
		// Retry without filters — overly specific filters can produce 0 results
		slog.Info("search.getty.retry.no.filters", "query", params.Query)
		unfiltered := getty.NewSearchOptions(params.Query)
		unfiltered.PageSize = params.Count * 4
		unfiltered.Fields = gettyMetadataFields
		retryResp, retryErr := o.getty.SearchWithOptions(ctx, unfiltered)
		if retryErr == nil && retryResp != nil {
			gettyResults = retryResp.Images
			slog.Info("search.getty.retry.complete", "count", len(gettyResults))
		}
	}

	if len(gettyResults) == 0 {
		// No Getty results even after retry, return whatever we have from cache
		results := collectResults(cachedResults, params.Count, 0)
		return nil, &SearchResult{
			Results:         results,
			CachedCount:     len(results),
			AnalyzedCount:   0,
			PendingAnalysis: 0,
			Complete:        true,
		}, nil
	}

	return gettyResults, nil, nil
}

// analyzeWithTimeout analyzes images until timeout, returning what completed.
func (o *Orchestrator) analyzeWithTimeout(ctx context.Context, ids []string, gettyResults map[string]getty.ImageResult) map[string]*models.ImageAnalysis {
	results := make(map[string]*models.ImageAnalysis)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, id := range ids {
		result, ok := gettyResults[id]
		if !ok {
			continue
		}

		wg.Add(1)
		go func(result getty.ImageResult) {
			defer wg.Done()

			analyzed, err := o.analyzeAndStore(ctx, result)
			if err != nil {
				if ctx.Err() == nil { // Only log if not cancelled
					slog.Warn("search.analysis.failed", "gettyId", result.ID, "error", err)
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
func (o *Orchestrator) analyzeAndStore(ctx context.Context, gettyResult getty.ImageResult) (*models.ImageAnalysis, error) {
	// Use preview URL for analysis
	imageURL := gettyResult.Preview()
	if imageURL == "" {
		imageURL = gettyResult.Thumbnail()
	}

	// Analyze with Haiku
	analysisResult, err := o.analysis.Analyze(ctx, imageURL)
	if err != nil {
		return nil, err
	}

	// Convert to ImageAnalysis
	imgAnalysis := analysis.ToImageAnalysis(analysisResult)

	// Populate metadata from Getty
	imgAnalysis.GettyID = gettyResult.ID
	imgAnalysis.Title = gettyResult.Title
	imgAnalysis.Caption = gettyResult.Caption
	imgAnalysis.Dimensions = models.ImageDimensions{
		Width:  gettyResult.Width(),
		Height: gettyResult.Height(),
	}
	imgAnalysis.URLs = models.ImageURLs{
		Thumbnail: gettyResult.Thumbnail(),
		Preview:   gettyResult.Preview(),
	}
	imgAnalysis.AnalyzedAt = time.Now()
	imgAnalysis.AnalysisVersion = "4"

	// Calculate aspect ratio category
	imgAnalysis.AspectRatioCategory = calculateAspectRatio(gettyResult.Width(), gettyResult.Height())

	// Populate Getty metadata from API response
	imgAnalysis.Orientation = gettyResult.Orientation
	imgAnalysis.GraphicalStyle = gettyResult.GraphicalStyle
	imgAnalysis.Artist = gettyResult.Artist
	imgAnalysis.CollectionCode = gettyResult.CollectionCode
	// Only overwrite Haiku-derived values with Getty metadata when Getty actually returns data.
	// numberOfPeople, ethnicity, ageOfPeople, and moods are search-only Getty filters —
	// they work as query parameters but are NOT returned in API responses.
	// The LLM-derived values from Haiku are the authoritative source for these fields.
	if gettyResult.NumberOfPeople != "" {
		imgAnalysis.NumberOfPeople = gettyResult.NumberOfPeople
	}
	if len(gettyResult.Ethnicity) > 0 {
		imgAnalysis.Ethnicity = gettyResult.Ethnicity
	}
	if len(gettyResult.AgeOfPeople) > 0 {
		imgAnalysis.AgeOfPeople = gettyResult.AgeOfPeople
	}
	if len(gettyResult.Keywords) > 0 {
		keywords := make([]string, 0, len(gettyResult.Keywords))
		for _, kw := range gettyResult.Keywords {
			keywords = append(keywords, kw.Text)
		}
		imgAnalysis.GettyKeywords = keywords
	}

	// Generate sparse vector from search text (for keyword matching)
	imgAnalysis.SparseIndices, imgAnalysis.SparseValues = sparse.Vectorize(imgAnalysis.SearchText())

	// Generate dense embedding from analysis text (for semantic similarity)
	embedding, err := o.embeddings.Generate(ctx, imgAnalysis.EmbeddingText())
	if err != nil {
		return nil, err
	}
	imgAnalysis.Embedding = embedding

	// Store in Qdrant
	if err := o.qdrant.Upsert(ctx, imgAnalysis); err != nil {
		slog.Warn("search.qdrant.upsert.failed", "gettyId", gettyResult.ID, "error", err)
	} else {
		slog.Debug("search.qdrant.upsert.success", "gettyId", gettyResult.ID)
	}

	// Store in S3 (if configured)
	if o.s3 != nil {
		if err := o.s3.Store(ctx, imgAnalysis); err != nil {
			slog.Warn("search.s3.store.failed", "gettyId", gettyResult.ID, "error", err)
		}
	}

	return imgAnalysis, nil
}

// collectResults deduplicates by Getty ID, sorts analyses by relevance score
// (descending), applies relative score filtering, and returns up to limit results.
func collectResults(analyses []*models.ImageAnalysis, limit int, relativeScoreRatio float32) []*models.ImageAnalysis {
	deduped := deduplicateByGettyID(analyses)
	sorted := sortByRelevance(deduped)
	filtered := filterByRelativeScore(sorted, relativeScoreRatio)
	if len(filtered) <= limit {
		return filtered
	}
	return filtered[:limit]
}

// deduplicateByGettyID removes duplicate analyses with the same Getty ID,
// keeping the first occurrence (highest relevance when pre-sorted).
func deduplicateByGettyID(analyses []*models.ImageAnalysis) []*models.ImageAnalysis {
	seen := make(map[string]bool, len(analyses))
	result := make([]*models.ImageAnalysis, 0, len(analyses))
	for _, a := range analyses {
		if a == nil || seen[a.GettyID] {
			continue
		}
		seen[a.GettyID] = true
		result = append(result, a)
	}
	return result
}

// filterByRelativeScore drops results that fall below a ratio of the top result's score.
// Results must be sorted by score descending. For example, with ratio=0.65 and a top
// score of 0.80, results below 0.52 are dropped. This adapts to query difficulty —
// specific queries with high scores keep more results, vague queries with lower scores
// still return something.
func filterByRelativeScore(sorted []*models.ImageAnalysis, ratio float32) []*models.ImageAnalysis {
	if len(sorted) == 0 || ratio <= 0 {
		return sorted
	}

	threshold := sorted[0].RelevanceScore * ratio
	for i, a := range sorted {
		if a.RelevanceScore < threshold {
			return sorted[:i]
		}
	}
	return sorted
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

// filtersToGettyOptions maps unified SearchFilters to Getty SearchOptions.
// Only Getty-native filter fields are mapped; analysis-enriched fields are ignored.
// gettyMetadataFields returns the Getty response fields needed for Qdrant storage and filtering.
// gettyMetadataFields lists the response fields to request from the Getty proxy.
// Note: number_of_people, age_of_people, and ethnicity are search-time filters only.
// Requesting them as response fields causes a 400 error from the Getty proxy.
var gettyMetadataFields = []getty.Field{
	getty.FieldDisplaySet,
	getty.FieldMaxDimensions,
	getty.FieldTitle,
	getty.FieldCaption,
	getty.FieldOrientation,
	getty.FieldGraphicalStyle,
	getty.FieldKeywords,
	getty.FieldArtist,
	getty.FieldCollectionCode,
}

func filtersToGettyOptions(query string, count int, filters models.SearchFilters) *getty.SearchOptions {
	opts := getty.NewSearchOptions(query)
	opts.PageSize = count
	opts.Fields = gettyMetadataFields

	for _, v := range filters.Orientations {
		opts.Orientations = append(opts.Orientations, getty.Orientation(v))
	}
	for _, v := range filters.Compositions {
		opts.Compositions = append(opts.Compositions, getty.Composition(v))
	}
	for _, v := range filters.Moods {
		opts.Moods = append(opts.Moods, getty.Mood(v))
	}
	for _, v := range filters.GraphicalStyles {
		opts.GraphicalStyles = append(opts.GraphicalStyles, getty.GraphicalStyle(v))
	}
	for _, v := range filters.NumberOfPeople {
		opts.NumberOfPeople = append(opts.NumberOfPeople, getty.NumberOfPeople(v))
	}
	for _, v := range filters.Ethnicity {
		opts.Ethnicity = append(opts.Ethnicity, getty.Ethnicity(v))
	}
	for _, v := range filters.AgeOfPeople {
		opts.AgeOfPeople = append(opts.AgeOfPeople, getty.AgeOfPeople(v))
	}
	if filters.MinimumSize != "" {
		opts.MinimumSize = getty.MinimumSize(filters.MinimumSize)
	}
	if filters.SortOrder != "" {
		opts.SortOrder = getty.SortOrder(filters.SortOrder)
	}
	if filters.Color != "" {
		opts.Color = filters.Color
	}

	return opts
}

// hasGettyFilters returns true if any Getty search-time filters are set.
func hasGettyFilters(f models.SearchFilters) bool {
	return len(f.Orientations) > 0 || len(f.Compositions) > 0 || len(f.Moods) > 0 ||
		len(f.GraphicalStyles) > 0 || len(f.NumberOfPeople) > 0 || len(f.Ethnicity) > 0 ||
		len(f.AgeOfPeople) > 0 || f.MinimumSize != "" || f.Color != ""
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

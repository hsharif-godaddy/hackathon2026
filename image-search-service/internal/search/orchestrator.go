// Package search provides the hybrid search orchestration logic.
package search

import (
	"context"
	"log/slog"
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
	getty      *getty.Client
	analysis   *analysis.Client
	embeddings *embeddings.Client
	qdrant     *qdrant.Client
	s3         *s3.Client
}

// New creates a new search orchestrator.
func New(
	getty *getty.Client,
	analysis *analysis.Client,
	embeddings *embeddings.Client,
	qdrant *qdrant.Client,
	s3 *s3.Client,
) *Orchestrator {
	return &Orchestrator{
		getty:      getty,
		analysis:   analysis,
		embeddings: embeddings,
		qdrant:     qdrant,
		s3:         s3,
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
// 1. Query Getty API for candidate images
// 2. Check Qdrant cache for existing analyses
// 3. If cached >= minCached, return immediately (queue uncached for background)
// 4. If cached < minCached, analyze uncached and wait up to maxWaitSeconds
// 5. Return whatever is ready
func (o *Orchestrator) Search(ctx context.Context, params SearchParams) (*SearchResult, error) {
	start := time.Now()
	slog.Info("search.start", "query", params.Query, "count", params.Count, "minCached", params.MinCached)

	// Step 1: Query Getty API for candidate images (get 2x requested to have options after filtering)
	gettyStart := time.Now()
	gettyResults, err := o.getty.Search(ctx, params.Query, params.Count*2)
	if err != nil {
		return nil, err
	}
	slog.Info("search.getty.complete", "count", len(gettyResults), "durationMs", time.Since(gettyStart).Milliseconds())

	if len(gettyResults) == 0 {
		return &SearchResult{
			Results:  []*models.ImageAnalysis{},
			Complete: true,
		}, nil
	}

	// Extract Getty IDs and build a map for quick lookup
	gettyIDs := make([]string, len(gettyResults))
	gettyResultMap := make(map[string]getty.SearchResult, len(gettyResults))
	for i, result := range gettyResults {
		gettyIDs[i] = result.GettyID
		gettyResultMap[result.GettyID] = result
	}
	slog.Debug("search.getty.ids", "ids", gettyIDs)

	// Step 2: Check Qdrant cache for existing analyses
	cacheStart := time.Now()
	cachedAnalyses, err := o.qdrant.GetByIDs(ctx, gettyIDs)
	if err != nil {
		slog.Warn("search.cache.error", "error", err)
		cachedAnalyses = make(map[string]*models.ImageAnalysis)
	}
	slog.Info("search.cache.complete", "cached", len(cachedAnalyses), "durationMs", time.Since(cacheStart).Milliseconds())

	// Identify uncached images
	var uncachedIDs []string
	for _, id := range gettyIDs {
		if _, found := cachedAnalyses[id]; !found {
			uncachedIDs = append(uncachedIDs, id)
		}
	}

	// Step 3: Check if we have enough cached results
	if len(cachedAnalyses) >= params.MinCached {
		slog.Info("search.sufficient.cached", "cached", len(cachedAnalyses), "minCached", params.MinCached)

		// Queue uncached for background analysis (fire and forget)
		if len(uncachedIDs) > 0 {
			go o.analyzeInBackground(context.Background(), uncachedIDs, gettyResultMap)
		}

		// Return cached results
		results := o.collectResults(cachedAnalyses, params.Count)
		return &SearchResult{
			Results:         results,
			CachedCount:     len(results),
			AnalyzedCount:   0,
			PendingAnalysis: len(uncachedIDs),
			Complete:        true,
		}, nil
	}

	// Step 4: Not enough cached - analyze uncached with timeout
	slog.Info("search.analyzing", "uncached", len(uncachedIDs), "maxWaitSeconds", params.MaxWaitSeconds)

	waitCtx, cancel := context.WithTimeout(ctx, time.Duration(params.MaxWaitSeconds)*time.Second)
	defer cancel()

	newlyAnalyzed := o.analyzeWithTimeout(waitCtx, uncachedIDs, gettyResultMap)
	slog.Info("search.analyzed.complete", "analyzed", len(newlyAnalyzed), "totalDurationMs", time.Since(start).Milliseconds())

	// Merge cached and newly analyzed
	allAnalyses := make(map[string]*models.ImageAnalysis)
	for id, a := range cachedAnalyses {
		allAnalyses[id] = a
	}
	for id, a := range newlyAnalyzed {
		allAnalyses[id] = a
	}

	// Return results
	results := o.collectResults(allAnalyses, params.Count)

	// Calculate pending (uncached that weren't analyzed in time)
	pendingCount := len(uncachedIDs) - len(newlyAnalyzed)
	if pendingCount < 0 {
		pendingCount = 0
	}

	return &SearchResult{
		Results:         results,
		CachedCount:     len(cachedAnalyses),
		AnalyzedCount:   len(newlyAnalyzed),
		PendingAnalysis: pendingCount,
		Complete:        pendingCount == 0,
	}, nil
}

// analyzeInBackground analyzes images without blocking.
func (o *Orchestrator) analyzeInBackground(ctx context.Context, ids []string, gettyResults map[string]getty.SearchResult) {
	for _, id := range ids {
		result, ok := gettyResults[id]
		if !ok {
			continue
		}

		_, err := o.analyzeAndStore(ctx, result)
		if err != nil {
			slog.Warn("search.background.analysis.failed", "gettyId", id, "error", err)
			continue
		}
		slog.Info("search.background.analysis.complete", "gettyId", id)
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

// collectResults collects analyses into a slice, up to limit.
func (o *Orchestrator) collectResults(analyses map[string]*models.ImageAnalysis, limit int) []*models.ImageAnalysis {
	results := make([]*models.ImageAnalysis, 0, len(analyses))
	for _, a := range analyses {
		results = append(results, a)
		if len(results) >= limit {
			break
		}
	}
	return results
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

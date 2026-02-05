# Qdrant-First Search with Relevance Sorting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Qdrant-first search flow that queries the vector database first with filters, falls back to Getty only when cache is insufficient, and sorts results by semantic relevance score.

**Architecture:** Change the search orchestrator to generate embeddings upfront, query Qdrant with filters first, and only hit Getty when cached results are below threshold. Add relevance scoring from Qdrant similarity scores to sort results by semantic relevance.

**Tech Stack:** Go 1.25, Qdrant vector database, OpenAI embeddings

---

### Task 1: Add RelevanceScore Field to ImageAnalysis

**Files:**

- Modify: `pkg/models/analysis.go`
- Test: `pkg/models/analysis_test.go` (create if needed)

**Step 1: Add the RelevanceScore field**

Add to `pkg/models/analysis.go` in the `ImageAnalysis` struct (after the `Embedding` field around line 45):

```go
// RelevanceScore is the semantic similarity score from Qdrant (0-1, higher = more relevant).
// Only populated when retrieved via vector search, not by ID lookup.
RelevanceScore float32 `json:"relevanceScore,omitempty"`
```

**Step 2: Run tests to verify no breakage**

Run: `cd /home/jeichorn/s/airo-ai-builder/image-search-service && go test ./pkg/models/...`
Expected: PASS (or no tests exist yet)

**Step 3: Commit**

```bash
git add pkg/models/analysis.go
git commit -m "feat(models): add RelevanceScore field to ImageAnalysis

Add field to store Qdrant similarity score for relevance-based sorting."
```

---

### Task 2: Update Qdrant Client to Populate RelevanceScore

**Files:**

- Modify: `internal/storage/qdrant/client.go:349` (payloadToAnalysis function)
- Test: `internal/storage/qdrant/client_test.go`

**Step 1: Write failing test for score population**

Add to `internal/storage/qdrant/client_test.go`:

```go
func TestPayloadToAnalysis_PopulatesRelevanceScore(t *testing.T) {
	payload := map[string]*qdrant.Value{
		"gettyId": {Kind: &qdrant.Value_StringValue{StringValue: "12345"}},
		"title":   {Kind: &qdrant.Value_StringValue{StringValue: "Test Image"}},
	}

	score := float32(0.95)
	analysis := payloadToAnalysis(payload, score)

	if analysis.RelevanceScore != score {
		t.Errorf("RelevanceScore = %v, want %v", analysis.RelevanceScore, score)
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd /home/jeichorn/s/airo-ai-builder/image-search-service && go test ./internal/storage/qdrant/... -run TestPayloadToAnalysis_PopulatesRelevanceScore -v`
Expected: FAIL with `RelevanceScore = 0, want 0.95`

**Step 3: Update payloadToAnalysis to use score**

In `internal/storage/qdrant/client.go`, change line 349 from:

```go
func payloadToAnalysis(payload map[string]*qdrant.Value, _ float32) *models.ImageAnalysis {
```

To:

```go
func payloadToAnalysis(payload map[string]*qdrant.Value, score float32) *models.ImageAnalysis {
```

And add before the return statement (around line 411):

```go
analysis.RelevanceScore = score
```

**Step 4: Run test to verify it passes**

Run: `cd /home/jeichorn/s/airo-ai-builder/image-search-service && go test ./internal/storage/qdrant/... -run TestPayloadToAnalysis_PopulatesRelevanceScore -v`
Expected: PASS

**Step 5: Run all qdrant tests**

Run: `cd /home/jeichorn/s/airo-ai-builder/image-search-service && go test ./internal/storage/qdrant/... -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add internal/storage/qdrant/client.go internal/storage/qdrant/client_test.go
git commit -m "feat(qdrant): populate RelevanceScore from Qdrant similarity score

Use the score parameter in payloadToAnalysis instead of ignoring it."
```

---

### Task 3: Add Sorting Helper Function

**Files:**

- Modify: `internal/search/orchestrator.go`
- Test: `internal/search/orchestrator_test.go` (create)

**Step 1: Create test file with sorting test**

Create `internal/search/orchestrator_test.go`:

```go
package search

import (
	"testing"

	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

func TestSortByRelevance(t *testing.T) {
	analyses := []*models.ImageAnalysis{
		{GettyID: "low", RelevanceScore: 0.3},
		{GettyID: "high", RelevanceScore: 0.9},
		{GettyID: "mid", RelevanceScore: 0.6},
	}

	sorted := sortByRelevance(analyses)

	if len(sorted) != 3 {
		t.Fatalf("expected 3 results, got %d", len(sorted))
	}
	if sorted[0].GettyID != "high" {
		t.Errorf("first result should be 'high', got %s", sorted[0].GettyID)
	}
	if sorted[1].GettyID != "mid" {
		t.Errorf("second result should be 'mid', got %s", sorted[1].GettyID)
	}
	if sorted[2].GettyID != "low" {
		t.Errorf("third result should be 'low', got %s", sorted[2].GettyID)
	}
}

func TestSortByRelevance_EmptySlice(t *testing.T) {
	var analyses []*models.ImageAnalysis
	sorted := sortByRelevance(analyses)
	if len(sorted) != 0 {
		t.Errorf("expected empty slice, got %d items", len(sorted))
	}
}

func TestSortByRelevance_SingleItem(t *testing.T) {
	analyses := []*models.ImageAnalysis{
		{GettyID: "only", RelevanceScore: 0.5},
	}
	sorted := sortByRelevance(analyses)
	if len(sorted) != 1 || sorted[0].GettyID != "only" {
		t.Errorf("single item should be returned unchanged")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd /home/jeichorn/s/airo-ai-builder/image-search-service && go test ./internal/search/... -run TestSortByRelevance -v`
Expected: FAIL with "undefined: sortByRelevance"

**Step 3: Implement sortByRelevance**

Add to `internal/search/orchestrator.go` (at the end of the file):

```go
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
```

Add import at top of file:

```go
import (
	// ... existing imports ...
	"slices"
)
```

**Step 4: Run test to verify it passes**

Run: `cd /home/jeichorn/s/airo-ai-builder/image-search-service && go test ./internal/search/... -run TestSortByRelevance -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add internal/search/orchestrator.go internal/search/orchestrator_test.go
git commit -m "feat(search): add sortByRelevance helper function

Sort ImageAnalysis slice by RelevanceScore descending for relevance-ranked results."
```

---

### Task 4: Refactor collectResults to Accept Slice and Apply Limit

**Files:**

- Modify: `internal/search/orchestrator.go`
- Test: `internal/search/orchestrator_test.go`

**Step 1: Add test for collectResults**

Add to `internal/search/orchestrator_test.go`:

```go
func TestCollectResults_AppliesLimit(t *testing.T) {
	analyses := []*models.ImageAnalysis{
		{GettyID: "1", RelevanceScore: 0.9},
		{GettyID: "2", RelevanceScore: 0.8},
		{GettyID: "3", RelevanceScore: 0.7},
		{GettyID: "4", RelevanceScore: 0.6},
		{GettyID: "5", RelevanceScore: 0.5},
	}

	result := collectResults(analyses, 3)

	if len(result) != 3 {
		t.Errorf("expected 3 results, got %d", len(result))
	}
}

func TestCollectResults_LimitGreaterThanLength(t *testing.T) {
	analyses := []*models.ImageAnalysis{
		{GettyID: "1", RelevanceScore: 0.9},
		{GettyID: "2", RelevanceScore: 0.8},
	}

	result := collectResults(analyses, 10)

	if len(result) != 2 {
		t.Errorf("expected 2 results (all available), got %d", len(result))
	}
}
```

**Step 2: Run test to verify current behavior**

Run: `cd /home/jeichorn/s/airo-ai-builder/image-search-service && go test ./internal/search/... -run TestCollectResults -v`
Expected: FAIL (function signature doesn't match - takes map, not slice)

**Step 3: Refactor collectResults**

Replace the existing `collectResults` method in `internal/search/orchestrator.go` (around line 293):

```go
// collectResults returns up to limit analyses, sorted by relevance.
func collectResults(analyses []*models.ImageAnalysis, limit int) []*models.ImageAnalysis {
	sorted := sortByRelevance(analyses)
	if len(sorted) <= limit {
		return sorted
	}
	return sorted[:limit]
}
```

Note: This changes from a method `(o *Orchestrator)` to a standalone function since it doesn't need orchestrator state.

**Step 4: Run test to verify it passes**

Run: `cd /home/jeichorn/s/airo-ai-builder/image-search-service && go test ./internal/search/... -run TestCollectResults -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add internal/search/orchestrator.go internal/search/orchestrator_test.go
git commit -m "refactor(search): change collectResults to accept slice and sort by relevance

Prepare for Qdrant-first flow where results come as slices, not maps."
```

---

### Task 5: Implement Qdrant-First Search Flow

**Files:**

- Modify: `internal/search/orchestrator.go`

**Step 1: Rewrite the Search method**

Replace the entire `Search` method in `internal/search/orchestrator.go` with:

```go
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

	// Step 2: Search Qdrant with embedding + filters
	qdrantStart := time.Now()
	cachedResults, err := o.qdrant.Search(ctx, queryEmbedding, params.Filters, params.Count)
	if err != nil {
		slog.Warn("search.qdrant.error", "error", err)
		cachedResults = nil
	}
	slog.Info("search.qdrant.complete", "cached", len(cachedResults), "durationMs", time.Since(qdrantStart).Milliseconds())

	// Step 3: Check if we have enough cached results
	if len(cachedResults) >= params.MinCached {
		slog.Info("search.sufficient.cached", "cached", len(cachedResults), "minCached", params.MinCached)

		// Queue Getty search + analysis in background for cache warming
		go o.warmCacheInBackground(context.Background(), params.Query, params.Count*2, cachedResults)

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
	finalResults, err := o.qdrant.Search(ctx, queryEmbedding, params.Filters, params.Count)
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

	return &SearchResult{
		Results:         results,
		CachedCount:     len(existingAnalyses),
		AnalyzedCount:   analyzedCount,
		PendingAnalysis: pendingCount,
		Complete:        pendingCount == 0,
	}, nil
}
```

**Step 2: Add the warmCacheInBackground method**

Add after the Search method:

```go
// warmCacheInBackground fetches Getty candidates and analyzes uncached ones to grow the cache.
func (o *Orchestrator) warmCacheInBackground(ctx context.Context, query string, count int, alreadyCached []*models.ImageAnalysis) {
	// Build set of already cached IDs
	cachedIDs := make(map[string]bool, len(alreadyCached))
	for _, a := range alreadyCached {
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
		slog.Debug("search.background.analysis.complete", "gettyId", result.GettyID)
	}
}
```

**Step 3: Add fmt import**

Add `"fmt"` to the imports if not already present.

**Step 4: Remove old analyzeInBackground method**

Delete the old `analyzeInBackground` method (around line 169-184) as it's replaced by `warmCacheInBackground`.

**Step 5: Run all tests**

Run: `cd /home/jeichorn/s/airo-ai-builder/image-search-service && go test ./... -v`
Expected: All PASS

**Step 6: Run linter**

Run: `cd /home/jeichorn/s/airo-ai-builder/image-search-service && golangci-lint run`
Expected: No issues

**Step 7: Commit**

```bash
git add internal/search/orchestrator.go
git commit -m "feat(search): implement Qdrant-first search with relevance sorting

- Query Qdrant with embedding + filters first
- Fall back to Getty only when cache insufficient
- Re-query Qdrant after analysis to apply filters
- Results sorted by semantic relevance score
- Background cache warming when returning cached results"
```

---

### Task 6: Update TODO.md

**Files:**

- Modify: `TODO.md`

**Step 1: Remove completed items**

Update `TODO.md` to remove the completed items:

```markdown
# TODOs for Image Search Service

## Add direct to getty-proxy auth

Right now we are using our proxy service to make getty requests, this is nice for dev, but doesn't make sense for prod

Low priority

## Generate an alt tag for each image

This could help us create accessible sites without additional costs/time
```

**Step 2: Commit**

```bash
git add TODO.md
git commit -m "docs: remove completed TODOs for Qdrant-first search and relevance sorting"
```

---

### Task 7: Final Verification

**Step 1: Run all tests with race detector**

Run: `cd /home/jeichorn/s/airo-ai-builder/image-search-service && go test -race ./...`
Expected: All PASS

**Step 2: Run linter**

Run: `cd /home/jeichorn/s/airo-ai-builder/image-search-service && golangci-lint run`
Expected: No issues

**Step 3: Build**

Run: `cd /home/jeichorn/s/airo-ai-builder/image-search-service && go build ./cmd/server`
Expected: Builds successfully

---

## Summary

This plan implements:

1. **RelevanceScore field** - Added to ImageAnalysis model
2. **Qdrant score population** - payloadToAnalysis now uses the score
3. **Sorting helper** - sortByRelevance for descending relevance order
4. **Refactored collectResults** - Works with slices, applies sorting
5. **Qdrant-first search flow** - New orchestrator logic
6. **Background cache warming** - Grows cache when returning cached results

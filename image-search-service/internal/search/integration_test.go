// Package search provides integration tests for the search orchestration flow.
// These tests require valid credentials and external service access.
//
// Run with: go test -v -tags=integration ./internal/search/...
// Or set INTEGRATION_TEST=1 to run automatically with go test
package search

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/airo-ai-builder/image-search-service/internal/analysis"
	"github.com/airo-ai-builder/image-search-service/internal/config"
	"github.com/airo-ai-builder/image-search-service/internal/getty"
)

// skipIfNoCredentials skips the test if required credentials are not set.
func skipIfNoCredentials(t *testing.T) *config.Config {
	t.Helper()

	// Check if integration tests are enabled
	if os.Getenv("INTEGRATION_TEST") != "1" {
		t.Skip("Skipping integration test (set INTEGRATION_TEST=1 to run)")
	}

	cfg := config.LoadConfig()

	// Check Getty credentials
	if cfg.GettyToken == "" {
		t.Skip("Skipping: GETTY_TOKEN not set")
	}
	if cfg.GettyUpstream == "" {
		t.Skip("Skipping: GETTY_UPSTREAM not set")
	}

	// Check Anthropic credentials
	if cfg.AnthropicAPIKey == "" {
		t.Skip("Skipping: ANTHROPIC_API_KEY not set")
	}
	if cfg.AnthropicAPIURL == "" {
		t.Skip("Skipping: ANTHROPIC_API_URL not set")
	}

	return cfg
}

// TestIntegration_GettySearch tests that we can search Getty Images API.
func TestIntegration_GettySearch(t *testing.T) {
	cfg := skipIfNoCredentials(t)

	client, err := getty.New(cfg)
	if err != nil {
		t.Fatalf("Failed to create Getty client: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Search for something unique to avoid cache hits
	query := fmt.Sprintf("purple elephant test %d", time.Now().UnixNano())
	t.Logf("Searching Getty for: %s", query)

	results, err := client.Search(ctx, query, 5)
	if err != nil {
		t.Fatalf("Getty search failed: %v", err)
	}

	t.Logf("Getty returned %d results", len(results))

	// We might get 0 results for a nonsense query, that's OK
	// But verify we didn't get an error
	for i, r := range results {
		t.Logf("  Result %d: ID=%s, Title=%s", i+1, r.GettyID, r.Title)
		if r.GettyID == "" {
			t.Errorf("Result %d has empty GettyID", i+1)
		}
	}
}

// TestIntegration_GettySearchWithResults tests searching for something that should return results.
func TestIntegration_GettySearchWithResults(t *testing.T) {
	cfg := skipIfNoCredentials(t)

	client, err := getty.New(cfg)
	if err != nil {
		t.Fatalf("Failed to create Getty client: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Search for something common that should return results
	query := "business meeting"
	t.Logf("Searching Getty for: %s", query)

	results, err := client.Search(ctx, query, 3)
	if err != nil {
		t.Fatalf("Getty search failed: %v", err)
	}

	if len(results) == 0 {
		t.Fatal("Expected at least one result for 'business meeting'")
	}

	t.Logf("Getty returned %d results", len(results))
	for i, r := range results {
		t.Logf("  Result %d: ID=%s, Title=%s", i+1, r.GettyID, r.Title)
		t.Logf("    Preview: %s", r.Preview)
		t.Logf("    Thumbnail: %s", r.Thumbnail)

		if r.Preview == "" && r.Thumbnail == "" {
			t.Errorf("Result %d has no preview or thumbnail URL", i+1)
		}
	}
}

// TestIntegration_HaikuAnalysis tests that we can analyze an image with Haiku.
func TestIntegration_HaikuAnalysis(t *testing.T) {
	cfg := skipIfNoCredentials(t)

	// First, get an image from Getty
	gettyClient, err := getty.New(cfg)
	if err != nil {
		t.Fatalf("Failed to create Getty client: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	results, err := gettyClient.Search(ctx, "office worker laptop", 1)
	if err != nil {
		t.Fatalf("Getty search failed: %v", err)
	}
	if len(results) == 0 {
		t.Fatal("No Getty results to analyze")
	}

	// Get the preview URL
	imageURL := results[0].Preview
	if imageURL == "" {
		imageURL = results[0].Thumbnail
	}
	if imageURL == "" {
		t.Fatal("No image URL available for analysis")
	}

	t.Logf("Analyzing image: %s", imageURL)
	t.Logf("Getty ID: %s, Title: %s", results[0].GettyID, results[0].Title)

	// Analyze the image
	analysisClient := analysis.New(cfg)
	result, err := analysisClient.Analyze(ctx, imageURL)
	if err != nil {
		t.Fatalf("Image analysis failed: %v", err)
	}

	t.Logf("Analysis result:")
	t.Logf("  PrimarySubject: %s", result.PrimarySubject)
	t.Logf("  SubjectCategory: %s", result.SubjectCategory)
	t.Logf("  Activity: %s", result.Activity)
	t.Logf("  SettingType: %s", result.SettingType)
	t.Logf("  Composition: %s", result.Composition)
	t.Logf("  CopySpaceLocation: %s", result.CopySpaceLocation)
	t.Logf("  Tone: %v", result.Tone)
	t.Logf("  SearchTerms: %v", result.SearchTerms)
	t.Logf("  Description: %s", result.Description)

	// Validate required fields are populated
	if result.PrimarySubject == "" {
		t.Error("PrimarySubject should not be empty")
	}
	if result.SubjectCategory == "" {
		t.Error("SubjectCategory should not be empty")
	}
	if result.Description == "" {
		t.Error("Description should not be empty")
	}
	if len(result.SearchTerms) == 0 {
		t.Error("SearchTerms should not be empty")
	}
}

// TestIntegration_FullSearchFlow tests the complete search -> analyze flow.
func TestIntegration_FullSearchFlow(t *testing.T) {
	cfg := skipIfNoCredentials(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	// Create clients
	gettyClient, err := getty.New(cfg)
	if err != nil {
		t.Fatalf("Failed to create Getty client: %v", err)
	}
	analysisClient := analysis.New(cfg)

	// Step 1: Search Getty for images
	query := "modern office interior"
	t.Logf("Step 1: Searching Getty for '%s'", query)

	results, err := gettyClient.Search(ctx, query, 2)
	if err != nil {
		t.Fatalf("Getty search failed: %v", err)
	}
	if len(results) == 0 {
		t.Fatal("No Getty results")
	}
	t.Logf("  Found %d results", len(results))

	// Step 2: Analyze each image
	t.Log("Step 2: Analyzing images with Haiku")
	for i, r := range results {
		imageURL := r.Preview
		if imageURL == "" {
			imageURL = r.Thumbnail
		}
		if imageURL == "" {
			t.Logf("  Skipping result %d: no image URL", i+1)
			continue
		}

		t.Logf("  Analyzing result %d: %s", i+1, r.GettyID)

		analysisResult, err := analysisClient.Analyze(ctx, imageURL)
		if err != nil {
			t.Errorf("  Analysis failed for %s: %v", r.GettyID, err)
			continue
		}

		t.Logf("    Subject: %s", analysisResult.PrimarySubject)
		t.Logf("    Category: %s", analysisResult.SubjectCategory)
		t.Logf("    Terms: %v", analysisResult.SearchTerms[:min(5, len(analysisResult.SearchTerms))])

		// Validate the analysis makes sense for an office image
		if analysisResult.PrimarySubject == "" {
			t.Errorf("    Empty PrimarySubject for %s", r.GettyID)
		}
	}

	t.Log("Integration test completed successfully")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

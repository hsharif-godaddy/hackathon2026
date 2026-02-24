//go:build integration

// Package getty provides integration tests for the Getty Images API client.
// Run with: go test -v -tags=integration ./internal/getty/...
// Or set INTEGRATION_TEST=1 to run automatically with go test
package getty

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/airo-ai-builder/image-search-service/internal/config"
)

func skipIfNoCredentials(t *testing.T) *config.Config {
	t.Helper()

	// Check if integration tests are enabled
	if os.Getenv("INTEGRATION_TEST") != "1" {
		t.Skip("Skipping integration test (set INTEGRATION_TEST=1 to run)")
	}

	cfg := config.LoadConfig()

	if cfg.GettyToken == "" {
		t.Skip("Skipping: GETTY_TOKEN not set")
	}
	if cfg.GettyUpstream == "" {
		t.Skip("Skipping: GETTY_UPSTREAM not set")
	}

	return cfg
}

// TestIntegration_SimpleSearch tests the backward-compatible Search method.
func TestIntegration_SimpleSearch(t *testing.T) {
	cfg := skipIfNoCredentials(t)

	client, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create Getty client: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	results, err := client.Search(ctx, "business meeting", 5)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	if len(results) == 0 {
		t.Fatal("Expected at least one result for 'business meeting'")
	}

	t.Logf("Got %d results", len(results))
	for i, img := range results {
		t.Logf("  Result %d: ID=%s, Title=%s", i+1, img.ID, img.Title)
	}
}

// TestIntegration_SearchWithOptions tests the new full-featured SearchWithOptions method.
func TestIntegration_SearchWithOptions(t *testing.T) {
	cfg := skipIfNoCredentials(t)

	client, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create Getty client: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	opts := NewSearchOptions("office workspace")
	opts.PageSize = 10
	opts.Orientations = []Orientation{OrientationHorizontal}
	opts.Compositions = []Composition{CompositionCopySpace}
	// Note: Fields parameter is not supported by the proxy, so we skip it here.
	// The proxy returns all fields by default.

	resp, err := client.SearchWithOptions(ctx, opts)
	if err != nil {
		t.Fatalf("SearchWithOptions failed: %v", err)
	}

	t.Logf("ResultCount: %d", resp.ResultCount)
	t.Logf("Images returned: %d", len(resp.Images))

	if len(resp.Images) == 0 {
		t.Fatal("Expected at least one result")
	}

	img := resp.Images[0]
	t.Logf("First image:")
	t.Logf("  ID: %s", img.ID)
	t.Logf("  Title: %s", img.Title)
	t.Logf("  GraphicalStyle: %s", img.GraphicalStyle)
	t.Logf("  Artist: %s", img.Artist)
	t.Logf("  Keywords count: %d", len(img.Keywords))
	t.Logf("  Thumbnail: %s", img.Thumbnail())
	t.Logf("  Preview: %s", img.Preview())
	t.Logf("  Width: %d, Height: %d", img.Width(), img.Height())

	// Verify helper methods work
	if img.GettyID() != img.ID {
		t.Errorf("GettyID() = %s, expected %s", img.GettyID(), img.ID)
	}
}

// TestIntegration_SearchWithFilters tests various filter combinations.
func TestIntegration_SearchWithFilters(t *testing.T) {
	cfg := skipIfNoCredentials(t)

	client, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create Getty client: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	testCases := []struct {
		name string
		opts *SearchOptions
	}{
		{
			name: "Vertical orientation",
			opts: func() *SearchOptions {
				o := NewSearchOptions("portrait person")
				o.PageSize = 5
				o.Orientations = []Orientation{OrientationVertical}
				return o
			}(),
		},
		{
			name: "Photography only",
			opts: func() *SearchOptions {
				o := NewSearchOptions("nature landscape")
				o.PageSize = 5
				o.GraphicalStyles = []GraphicalStyle{GraphicalStylePhotography}
				return o
			}(),
		},
		{
			name: "With number of people filter",
			opts: func() *SearchOptions {
				o := NewSearchOptions("team meeting")
				o.PageSize = 5
				o.NumberOfPeople = []NumberOfPeople{NumberOfPeopleGroup}
				return o
			}(),
		},
		{
			name: "Sort by newest",
			opts: func() *SearchOptions {
				o := NewSearchOptions("technology")
				o.PageSize = 5
				o.SortOrder = SortOrderNewest
				return o
			}(),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := client.SearchWithOptions(ctx, tc.opts)
			if err != nil {
				t.Fatalf("SearchWithOptions failed: %v", err)
			}

			t.Logf("ResultCount: %d, Returned: %d", resp.ResultCount, len(resp.Images))

			if len(resp.Images) == 0 {
				t.Log("Warning: No results returned (query may be too restrictive)")
			}
		})
	}
}

// TestIntegration_GetByID tests retrieving a single image.
func TestIntegration_GetByID(t *testing.T) {
	cfg := skipIfNoCredentials(t)

	client, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create Getty client: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// First, search to get a valid ID
	results, err := client.Search(ctx, "business", 1)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}
	if len(results) == 0 {
		t.Skip("No results to test GetByID with")
	}

	gettyID := results[0].ID
	t.Logf("Testing GetByID with ID: %s", gettyID)

	// Now fetch by ID
	result, err := client.GetByID(ctx, gettyID)
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}

	if result == nil {
		t.Fatal("Expected non-nil result")
	}

	t.Logf("GetByID result: ID=%s, Title=%s", result.ID, result.Title)
}

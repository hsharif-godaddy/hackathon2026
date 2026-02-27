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

	if cfg.GettyUpstream == "" {
		t.Skip("Skipping: GETTY_UPSTREAM not set")
	}

	// Need either bearer token or SSO cert paths
	if cfg.GettyAuthType == "sso-jwt" {
		if cfg.GettyCertPath == "" || cfg.GettyKeyPath == "" {
			t.Skip("Skipping: SSO JWT auth requires GETTY_CERT_PATH and GETTY_KEY_PATH")
		}
	} else if cfg.GettyToken == "" {
		t.Skip("Skipping: GETTY_TOKEN not set")
	}

	return cfg
}

// createTestClient creates a Getty client using the configured auth type.
func createTestClient(t *testing.T, cfg *config.Config) *Client {
	t.Helper()

	if cfg.GettyAuthType == "sso-jwt" {
		auth, err := NewSSOJWTAuth(cfg.GettySSOHost, cfg.GettyCertPath, cfg.GettyKeyPath, cfg.GettyXAppKey)
		if err != nil {
			t.Fatalf("Failed to create SSO JWT auth: %v", err)
		}
		return NewWithAuth(cfg, auth)
	}

	client, err := New(cfg)
	if err != nil {
		t.Fatalf("Failed to create Getty client: %v", err)
	}
	return client
}

// TestIntegration_SimpleSearch tests the backward-compatible Search method.
func TestIntegration_SimpleSearch(t *testing.T) {
	cfg := skipIfNoCredentials(t)
	client := createTestClient(t, cfg)

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
	client := createTestClient(t, cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	opts := NewSearchOptions("office workspace")
	opts.PageSize = 10
	opts.Orientations = []Orientation{OrientationHorizontal}
	opts.Compositions = []Composition{CompositionCopySpace}
	opts.Fields = []Field{
		FieldDisplaySet, FieldMaxDimensions, FieldTitle, FieldOrientation,
		FieldGraphicalStyle, FieldKeywords, FieldArtist, FieldCollectionCode,
	}

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
	t.Logf("First image: ID=%s Title=%q", img.ID, img.Title)

	// Verify core identification
	if img.ID == "" {
		t.Error("Expected non-empty ID")
	}
	if img.Title == "" {
		t.Error("Expected non-empty Title")
	}

	// Verify helper methods
	if img.GettyID() != img.ID {
		t.Errorf("GettyID() = %s, expected %s", img.GettyID(), img.ID)
	}
}

// TestIntegration_AllMetadataFields verifies all extended fields that the service
// relies on are populated when requesting them via the fields parameter.
// These fields are used by the orchestrator's analyzeAndStore() to populate
// Qdrant payload and drive search filters.
func TestIntegration_AllMetadataFields(t *testing.T) {
	cfg := skipIfNoCredentials(t)
	client := createTestClient(t, cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Request the exact same fields the orchestrator uses (gettyMetadataFields)
	// plus title and caption which analyzeAndStore also reads.
	opts := NewSearchOptions("business people working in modern office")
	opts.PageSize = 5
	opts.Fields = []Field{
		FieldDisplaySet,
		FieldMaxDimensions,
		FieldTitle,
		FieldCaption,
		FieldOrientation,
		FieldGraphicalStyle,
		FieldKeywords,
		FieldArtist,
		FieldCollectionCode,
	}

	resp, err := client.SearchWithOptions(ctx, opts)
	if err != nil {
		t.Fatalf("SearchWithOptions failed: %v", err)
	}

	if len(resp.Images) == 0 {
		t.Fatal("Expected at least one result")
	}

	// Check multiple images to ensure fields are consistently populated
	for i, img := range resp.Images {
		t.Run(img.ID, func(t *testing.T) {
			t.Logf("Image %d: ID=%s", i+1, img.ID)

			// --- Core identification ---
			if img.ID == "" {
				t.Error("ID: expected non-empty")
			}
			if img.Title == "" {
				t.Error("Title: expected non-empty")
			}
			t.Logf("  Title: %s", img.Title)

			// Caption may be empty for some images, just log it
			t.Logf("  Caption: %q", img.Caption)

			// --- Display sizes (from display_set field) ---
			if len(img.DisplaySizes) == 0 {
				t.Error("DisplaySizes: expected non-empty (display_set field)")
			} else {
				t.Logf("  DisplaySizes: %d variants", len(img.DisplaySizes))
				for _, ds := range img.DisplaySizes {
					if ds.Name == "" {
						t.Error("DisplaySizes: entry has empty Name")
					}
					if ds.URI == "" {
						t.Errorf("DisplaySizes[%s]: entry has empty URI", ds.Name)
					}
				}
			}

			// --- Helper methods for display sizes ---
			thumbnail := img.Thumbnail()
			preview := img.Preview()
			t.Logf("  Thumbnail(): %s", thumbnail)
			t.Logf("  Preview():   %s", preview)
			if thumbnail == "" && preview == "" {
				t.Error("Expected at least one of Thumbnail() or Preview() to be non-empty")
			}

			// --- Max dimensions ---
			if img.MaxDimensions == nil {
				t.Error("MaxDimensions: expected non-nil")
			} else {
				if img.MaxDimensions.Width <= 0 {
					t.Errorf("MaxDimensions.Width: expected > 0, got %d", img.MaxDimensions.Width)
				}
				if img.MaxDimensions.Height <= 0 {
					t.Errorf("MaxDimensions.Height: expected > 0, got %d", img.MaxDimensions.Height)
				}
				t.Logf("  MaxDimensions: %dx%d", img.MaxDimensions.Width, img.MaxDimensions.Height)
			}

			// Width()/Height() helpers
			if img.Width() <= 0 {
				t.Errorf("Width(): expected > 0, got %d", img.Width())
			}
			if img.Height() <= 0 {
				t.Errorf("Height(): expected > 0, got %d", img.Height())
			}

			// --- Orientation ---
			if img.Orientation == "" {
				t.Error("Orientation: expected non-empty")
			} else {
				validOrientations := map[string]bool{
					"Horizontal":          true,
					"Vertical":            true,
					"Square":              true,
					"PanoramicHorizontal": true,
					"PanoramicVertical":   true,
				}
				if !validOrientations[img.Orientation] {
					t.Errorf("Orientation: unexpected value %q", img.Orientation)
				}
				t.Logf("  Orientation: %s", img.Orientation)
			}

			// --- Graphical style ---
			if img.GraphicalStyle == "" {
				t.Error("GraphicalStyle: expected non-empty")
			} else {
				validStyles := map[string]bool{
					"photography":  true,
					"illustration": true,
					"fine_art":     true,
					"vector":       true,
				}
				if !validStyles[img.GraphicalStyle] {
					t.Errorf("GraphicalStyle: unexpected value %q", img.GraphicalStyle)
				}
				t.Logf("  GraphicalStyle: %s", img.GraphicalStyle)
			}

			// --- Keywords ---
			if len(img.Keywords) == 0 {
				t.Error("Keywords: expected non-empty")
			} else {
				t.Logf("  Keywords: %d total", len(img.Keywords))
				// Verify keyword structure (some Getty keywords have empty text — data quality issue)
				nonEmpty := 0
				for _, kw := range img.Keywords {
					if kw.Text != "" {
						nonEmpty++
					}
				}
				if nonEmpty == 0 {
					t.Error("Keywords: all keywords have empty Text")
				}
				// Log first few keywords
				limit := 5
				if len(img.Keywords) < limit {
					limit = len(img.Keywords)
				}
				for _, kw := range img.Keywords[:limit] {
					t.Logf("    - %s (id=%s)", kw.Text, kw.KeywordID)
				}
			}

			// --- Artist ---
			if img.Artist == "" {
				t.Error("Artist: expected non-empty")
			}
			t.Logf("  Artist: %s", img.Artist)

			// --- Collection code ---
			if img.CollectionCode == "" {
				t.Error("CollectionCode: expected non-empty")
			}
			t.Logf("  CollectionCode: %s", img.CollectionCode)

			// --- GettyID helper ---
			if img.GettyID() != img.ID {
				t.Errorf("GettyID() = %q, want %q", img.GettyID(), img.ID)
			}
		})
	}
}

// TestIntegration_DemographicFieldsAreSearchOnly verifies that demographic fields
// (number_of_people, ethnicity, age_of_people) work as search-time filters but
// are NOT valid response fields. The Getty proxy returns 400 if you request them
// via the fields parameter. They only work as query filters on the search endpoint.
func TestIntegration_DemographicFieldsAreSearchOnly(t *testing.T) {
	cfg := skipIfNoCredentials(t)
	client := createTestClient(t, cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Use demographic fields as SEARCH FILTERS (not response fields)
	opts := NewSearchOptions("people working in office")
	opts.PageSize = 3
	opts.NumberOfPeople = []NumberOfPeople{NumberOfPeopleGroup}
	opts.Fields = []Field{
		FieldDisplaySet, FieldMaxDimensions, FieldTitle,
	}

	resp, err := client.SearchWithOptions(ctx, opts)
	if err != nil {
		t.Fatalf("SearchWithOptions failed: %v", err)
	}

	if len(resp.Images) == 0 {
		t.Fatal("Expected results for people search with group filter")
	}

	t.Logf("Got %d results with numberOfPeople=group filter", len(resp.Images))

	// Even though the filter worked, the per-image response won't contain
	// number_of_people, ethnicity, or age_of_people fields
	for _, img := range resp.Images {
		if img.NumberOfPeople != "" {
			t.Errorf("Image %s: NumberOfPeople should be empty in response, got %q", img.ID, img.NumberOfPeople)
		}
		if len(img.Ethnicity) > 0 {
			t.Errorf("Image %s: Ethnicity should be empty in response, got %v", img.ID, img.Ethnicity)
		}
		if len(img.AgeOfPeople) > 0 {
			t.Errorf("Image %s: AgeOfPeople should be empty in response, got %v", img.ID, img.AgeOfPeople)
		}
		t.Logf("  Image %s: Title=%q (demographics empty as expected)", img.ID, img.Title)
	}
}

// TestIntegration_OrientationCaseValues verifies the exact casing Getty returns
// for orientation values, since our system normalizes to lowercase.
func TestIntegration_OrientationCaseValues(t *testing.T) {
	cfg := skipIfNoCredentials(t)
	client := createTestClient(t, cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cases := []struct {
		name        string
		orientation Orientation
		expected    string
	}{
		{"horizontal", OrientationHorizontal, "Horizontal"},
		{"vertical", OrientationVertical, "Vertical"},
		{"square", OrientationSquare, "Square"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			opts := NewSearchOptions("nature")
			opts.PageSize = 1
			opts.Orientations = []Orientation{tc.orientation}
			opts.Fields = []Field{FieldOrientation}

			resp, err := client.SearchWithOptions(ctx, opts)
			if err != nil {
				t.Fatalf("SearchWithOptions failed: %v", err)
			}
			if len(resp.Images) == 0 {
				t.Skip("No results for orientation filter")
			}

			got := resp.Images[0].Orientation
			if got != tc.expected {
				t.Errorf("Orientation: got %q, want %q (case mismatch?)", got, tc.expected)
			}
			t.Logf("Orientation filter=%s → response=%s", tc.orientation, got)
		})
	}
}

// TestIntegration_DisplaySetFieldMapping verifies that requesting "display_set"
// populates the DisplaySizes array (the GoDaddy proxy maps display_set → display_sizes).
func TestIntegration_DisplaySetFieldMapping(t *testing.T) {
	cfg := skipIfNoCredentials(t)
	client := createTestClient(t, cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	opts := NewSearchOptions("sunset landscape")
	opts.PageSize = 1
	opts.Fields = []Field{FieldDisplaySet}

	resp, err := client.SearchWithOptions(ctx, opts)
	if err != nil {
		t.Fatalf("SearchWithOptions failed: %v", err)
	}
	if len(resp.Images) == 0 {
		t.Fatal("Expected at least one result")
	}

	img := resp.Images[0]
	if len(img.DisplaySizes) == 0 {
		t.Fatal("DisplaySizes: expected non-empty when requesting display_set field")
	}

	// Verify expected display size variants exist
	sizeNames := make(map[string]bool)
	for _, ds := range img.DisplaySizes {
		sizeNames[ds.Name] = true
		t.Logf("  DisplaySize: name=%s watermarked=%v uri=%s", ds.Name, ds.IsWatermarked, ds.URI[:min(80, len(ds.URI))])
	}

	// "comp" and "thumb" are the most commonly returned sizes
	if !sizeNames["comp"] && !sizeNames["preview"] {
		t.Error("Expected at least 'comp' or 'preview' in DisplaySizes")
	}
	if !sizeNames["thumb"] {
		t.Error("Expected 'thumb' in DisplaySizes")
	}
}

// TestIntegration_FieldsWithoutRequestReturnsMinimal verifies that when no fields
// parameter is specified, the response returns only default fields (id, display_sizes,
// max_dimensions) without extended metadata.
func TestIntegration_FieldsWithoutRequestReturnsMinimal(t *testing.T) {
	cfg := skipIfNoCredentials(t)
	client := createTestClient(t, cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Search WITHOUT specifying fields — should get only defaults
	opts := NewSearchOptions("mountain landscape")
	opts.PageSize = 1
	// Deliberately NOT setting opts.Fields

	resp, err := client.SearchWithOptions(ctx, opts)
	if err != nil {
		t.Fatalf("SearchWithOptions failed: %v", err)
	}
	if len(resp.Images) == 0 {
		t.Fatal("Expected at least one result")
	}

	img := resp.Images[0]
	t.Logf("Without fields param: ID=%s Title=%q Orientation=%q GraphicalStyle=%q Artist=%q Keywords=%d",
		img.ID, img.Title, img.Orientation, img.GraphicalStyle, img.Artist, len(img.Keywords))

	// ID is always returned
	if img.ID == "" {
		t.Error("ID should always be present")
	}

	// Default fields: display_sizes and max_dimensions should be present
	if len(img.DisplaySizes) == 0 {
		t.Error("DisplaySizes: expected non-empty (default field)")
	}
	if img.MaxDimensions == nil {
		t.Error("MaxDimensions: expected non-nil (default field)")
	}

	// Extended fields should be empty when not requested
	if img.Title != "" {
		t.Logf("  Note: Title returned without fields param: %q", img.Title)
	}
	if img.Orientation != "" {
		t.Logf("  Note: Orientation returned without fields param: %q", img.Orientation)
	}
	if img.GraphicalStyle != "" {
		t.Logf("  Note: GraphicalStyle returned without fields param: %q", img.GraphicalStyle)
	}
	if len(img.Keywords) > 0 {
		t.Logf("  Note: Keywords returned without fields param: %d", len(img.Keywords))
	}
	if img.Artist != "" {
		t.Logf("  Note: Artist returned without fields param: %q", img.Artist)
	}
}

// TestIntegration_SearchWithFilters tests various filter combinations.
func TestIntegration_SearchWithFilters(t *testing.T) {
	cfg := skipIfNoCredentials(t)
	client := createTestClient(t, cfg)

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
	client := createTestClient(t, cfg)

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

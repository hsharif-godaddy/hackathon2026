package qdrant

import (
	"testing"
	"time"

	"github.com/qdrant/go-client/qdrant"

	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

func TestBuildFilters_EmptyFilters(t *testing.T) {
	filters := models.SearchFilters{}
	result := buildFilters(filters)

	if result != nil {
		t.Error("expected nil filters for empty input")
	}
}

func TestBuildFilters_SingleField(t *testing.T) {
	filters := models.SearchFilters{
		SubjectCategory: []string{"people"},
	}
	result := buildFilters(filters)

	if result == nil {
		t.Fatal("expected non-nil filters")
	}

	if len(result.Must) != 1 {
		t.Errorf("expected 1 condition, got %d", len(result.Must))
	}
}

func TestBuildFilters_MultipleValues(t *testing.T) {
	filters := models.SearchFilters{
		Orientations:    []string{"horizontal", "square"},
		SubjectCategory: []string{"people", "workspace"},
	}
	result := buildFilters(filters)

	if result == nil {
		t.Fatal("expected non-nil filters")
	}

	if len(result.Must) != 2 {
		t.Errorf("expected 2 conditions, got %d", len(result.Must))
	}
}

func TestBuildFilters_AllFields(t *testing.T) {
	filters := models.SearchFilters{
		Orientations:      []string{"landscape"},
		SubjectCategory:   []string{"people"},
		PeopleCount:       []string{"1"},
		PeopleFocus:       []string{"primary"},
		Tone:              []string{"professional"},
		CopySpaceAmount:   []string{"high"},
		CopySpaceLocation: []string{"right"},
		ColorMood:         []string{"warm"},
		Composition:       []string{"center"},
		UsageContext:      []string{"hero"},
		BackgroundType:    []string{"blurred"},
		VisualComplexity:  []string{"low"},
	}
	result := buildFilters(filters)

	if result == nil {
		t.Fatal("expected non-nil filters")
	}

	if len(result.Must) != 12 {
		t.Errorf("expected 12 conditions, got %d", len(result.Must))
	}
}

func TestGettyIDToPointID(t *testing.T) {
	tests := []struct {
		gettyID   string
		expected  uint64
		expectErr bool
	}{
		{"12345", 12345, false},
		{"2223853446", 2223853446, false},
		{"0", 0, false},
		{"18446744073709551615", 18446744073709551615, false}, // max uint64
		{"abc-def", 0, true},                                  // non-numeric should fail
		{"", 0, true},                                         // empty should fail
		{"-123", 0, true},                                     // negative should fail
		{"12.34", 0, true},                                    // float should fail
	}

	for _, tt := range tests {
		result, err := gettyIDToPointID(tt.gettyID)
		if tt.expectErr {
			if err == nil {
				t.Errorf("gettyIDToPointID(%q): expected error, got %d", tt.gettyID, result)
			}
		} else {
			if err != nil {
				t.Errorf("gettyIDToPointID(%q): unexpected error: %v", tt.gettyID, err)
			} else if result != tt.expected {
				t.Errorf("gettyIDToPointID(%q) = %d, expected %d", tt.gettyID, result, tt.expected)
			}
		}
	}
}

func TestPayloadToAnalysis_Nil(t *testing.T) {
	result := payloadToAnalysis(nil, 0)
	if result != nil {
		t.Error("expected nil result for nil payload")
	}
}

func TestPayloadToAnalysis_Basic(t *testing.T) {
	payload := qdrant.NewValueMap(map[string]any{
		"gettyId":             "12345",
		"title":               "Test Image",
		"caption":             "A test caption",
		"width":               1920,
		"height":              1080,
		"thumbnailUrl":        "http://example.com/thumb.jpg",
		"previewUrl":          "http://example.com/preview.jpg",
		"highResUrl":          "http://example.com/highres.jpg",
		"primarySubject":      "person",
		"subjectCategory":     "people",
		"activity":            "working",
		"settingType":         "office",
		"dominantColors":      []interface{}{"#FF0000", "#00FF00", "#0000FF"},
		"colorMood":           "warm",
		"textSafeColors":      "light-only",
		"backgroundType":      "blurred",
		"composition":         "center",
		"copySpaceLocation":   "right",
		"copySpaceAmount":     "high",
		"visualComplexity":    "low",
		"peopleCount":         "1",
		"peopleFocus":         "primary",
		"tone":                []interface{}{"professional", "friendly"},
		"usageContext":        []interface{}{"hero", "banner"},
		"authenticityStyle":   "stock",
		"aspectRatioCategory": "landscape",
		"description":         "A test description",
		"searchTerms":         []interface{}{"test", "image"},
		"analyzedAt":          "2024-01-15T10:30:00Z",
		"analysisVersion":     "1.0",
	})

	result := payloadToAnalysis(payload, 0.95)

	if result.GettyID != "12345" {
		t.Errorf("expected GettyID '12345', got %q", result.GettyID)
	}
	if result.Title != "Test Image" {
		t.Errorf("expected Title 'Test Image', got %q", result.Title)
	}
	if result.Dimensions.Width != 1920 {
		t.Errorf("expected Width 1920, got %d", result.Dimensions.Width)
	}
	if result.Dimensions.Height != 1080 {
		t.Errorf("expected Height 1080, got %d", result.Dimensions.Height)
	}
	if len(result.DominantColors) != 3 {
		t.Errorf("expected 3 dominant colors, got %d", len(result.DominantColors))
	}
	if len(result.Tone) != 2 {
		t.Errorf("expected 2 tones, got %d", len(result.Tone))
	}
	if result.SubjectCategory != models.SubjectCategoryPeople {
		t.Errorf("expected SubjectCategory 'people', got %q", result.SubjectCategory)
	}
}

func TestAnalysisToPayload(t *testing.T) {
	analysis := &models.ImageAnalysis{
		GettyID: "12345",
		Title:   "Test Image",
		Caption: "A test caption",
		Dimensions: models.ImageDimensions{
			Width:  1920,
			Height: 1080,
		},
		URLs: models.ImageURLs{
			Thumbnail: "http://example.com/thumb.jpg",
			Preview:   "http://example.com/preview.jpg",
			HighRes:   "http://example.com/highres.jpg",
		},
		PrimarySubject:      "person",
		SubjectCategory:     models.SubjectCategoryPeople,
		Activity:            models.ActivityWorking,
		SettingType:         models.SettingTypeOffice,
		DominantColors:      []string{"#FF0000", "#00FF00", "#0000FF"},
		ColorMood:           models.ColorMoodWarm,
		TextSafeColors:      models.TextSafeColorsLightOnly,
		BackgroundType:      models.BackgroundTypeBlurred,
		Composition:         models.CompositionCenter,
		CopySpaceLocation:   models.CopySpaceLocationRight,
		CopySpaceAmount:     models.CopySpaceAmountHigh,
		VisualComplexity:    models.VisualComplexityLow,
		PeopleCount:         models.PeopleCountOne,
		PeopleFocus:         models.PeopleFocusPrimary,
		Tone:                []string{"professional", "friendly"},
		UsageContext:        []string{"hero", "banner"},
		AuthenticityStyle:   models.AuthenticityStyleStock,
		AspectRatioCategory: models.AspectRatioCategoryLandscape,
		Description:         "A test description",
		SearchTerms:         []string{"test", "image"},
		AnalyzedAt:          time.Date(2024, 1, 15, 10, 30, 0, 0, time.UTC),
		AnalysisVersion:     "1.0",
	}

	payload := analysisToPayload(analysis)

	if payload == nil {
		t.Fatal("expected non-nil payload")
	}

	// Check a few key fields
	if sv, ok := payload["gettyId"].Kind.(*qdrant.Value_StringValue); !ok || sv.StringValue != "12345" {
		t.Error("gettyId not properly converted")
	}
	if iv, ok := payload["width"].Kind.(*qdrant.Value_IntegerValue); !ok || iv.IntegerValue != 1920 {
		t.Error("width not properly converted")
	}
}

func TestToInterfaceSlice(t *testing.T) {
	input := []string{"a", "b", "c"}
	result := toInterfaceSlice(input)

	if len(result) != 3 {
		t.Errorf("expected 3 elements, got %d", len(result))
	}

	for i, v := range result {
		if s, ok := v.(string); !ok || s != input[i] {
			t.Errorf("element %d: expected %q, got %v", i, input[i], v)
		}
	}
}

func TestGetStringValue(t *testing.T) {
	payload := qdrant.NewValueMap(map[string]any{
		"key1": "value1",
		"key2": 123,
	})

	if v := getStringValue(payload, "key1"); v != "value1" {
		t.Errorf("expected 'value1', got %q", v)
	}
	if v := getStringValue(payload, "key2"); v != "" {
		t.Errorf("expected empty string for non-string value, got %q", v)
	}
	if v := getStringValue(payload, "nonexistent"); v != "" {
		t.Errorf("expected empty string for missing key, got %q", v)
	}
}

func TestGetIntValue(t *testing.T) {
	payload := qdrant.NewValueMap(map[string]any{
		"key1": 123,
		"key2": "not an int",
	})

	if v := getIntValue(payload, "key1"); v != 123 {
		t.Errorf("expected 123, got %d", v)
	}
	if v := getIntValue(payload, "key2"); v != 0 {
		t.Errorf("expected 0 for non-int value, got %d", v)
	}
	if v := getIntValue(payload, "nonexistent"); v != 0 {
		t.Errorf("expected 0 for missing key, got %d", v)
	}
}

func TestGetStringSlice(t *testing.T) {
	payload := qdrant.NewValueMap(map[string]any{
		"key1": []interface{}{"a", "b", "c"},
		"key2": "not a list",
	})

	result := getStringSlice(payload, "key1")
	if len(result) != 3 {
		t.Errorf("expected 3 elements, got %d", len(result))
	}
	if result[0] != "a" || result[1] != "b" || result[2] != "c" {
		t.Errorf("unexpected values: %v", result)
	}

	if v := getStringSlice(payload, "key2"); v != nil {
		t.Errorf("expected nil for non-list value, got %v", v)
	}
	if v := getStringSlice(payload, "nonexistent"); v != nil {
		t.Errorf("expected nil for missing key, got %v", v)
	}
}

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

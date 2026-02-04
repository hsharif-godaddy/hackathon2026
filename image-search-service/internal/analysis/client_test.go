package analysis

import (
	"context"
	"errors"
	"testing"

	"github.com/airo-ai-builder/image-search-service/internal/ratelimit"
	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

func TestBuildPrompt(t *testing.T) {
	if SystemPrompt == "" {
		t.Error("SystemPrompt should not be empty")
	}

	if UserMessage == "" {
		t.Error("UserMessage should not be empty")
	}

	// Verify the system prompt contains key instructions
	expectedPhrases := []string{
		"primarySubject",
		"subjectCategory",
		"composition",
		"copySpaceLocation",
		"tone",
		"usageContext",
		"searchTerms",
		"description",
		"ONLY with valid JSON",
	}

	for _, phrase := range expectedPhrases {
		if !contains(SystemPrompt, phrase) {
			t.Errorf("SystemPrompt should contain %q", phrase)
		}
	}
}

func TestParseAnalysisResponse(t *testing.T) {
	jsonResponse := `{
		"primarySubject": "golden retriever puppy sitting on grass",
		"subjectCategory": "animal",
		"activity": "playing",
		"settingType": "outdoor",
		"textSafeColors": "dark-only",
		"backgroundType": "natural",
		"composition": "center",
		"copySpaceLocation": "top",
		"copySpaceAmount": "moderate",
		"visualComplexity": "moderate",
		"peopleCount": "0",
		"peopleFocus": "none",
		"tone": ["playful", "friendly", "energetic"],
		"usageContext": ["hero", "content", "gallery"],
		"authenticityStyle": "candid",
		"description": "A golden retriever puppy sitting on green grass in a park. The dog appears happy and relaxed.",
		"searchTerms": ["dog", "puppy", "golden retriever", "pet", "animal", "outdoor", "grass", "happy", "cute", "playful"]
	}`

	result, err := parseAnalysisResponse([]byte(jsonResponse))
	if err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	// Verify single-value fields
	if result.PrimarySubject != "golden retriever puppy sitting on grass" {
		t.Errorf("PrimarySubject = %q, want %q", result.PrimarySubject, "golden retriever puppy sitting on grass")
	}
	if result.SubjectCategory != "animal" {
		t.Errorf("SubjectCategory = %q, want %q", result.SubjectCategory, "animal")
	}
	if result.Activity != "playing" {
		t.Errorf("Activity = %q, want %q", result.Activity, "playing")
	}
	if result.SettingType != "outdoor" {
		t.Errorf("SettingType = %q, want %q", result.SettingType, "outdoor")
	}
	if result.TextSafeColors != "dark-only" {
		t.Errorf("TextSafeColors = %q, want %q", result.TextSafeColors, "dark-only")
	}
	if result.BackgroundType != "natural" {
		t.Errorf("BackgroundType = %q, want %q", result.BackgroundType, "natural")
	}
	if result.Composition != "center" {
		t.Errorf("Composition = %q, want %q", result.Composition, "center")
	}
	if result.CopySpaceLocation != "top" {
		t.Errorf("CopySpaceLocation = %q, want %q", result.CopySpaceLocation, "top")
	}
	if result.CopySpaceAmount != "moderate" {
		t.Errorf("CopySpaceAmount = %q, want %q", result.CopySpaceAmount, "moderate")
	}
	if result.VisualComplexity != "moderate" {
		t.Errorf("VisualComplexity = %q, want %q", result.VisualComplexity, "moderate")
	}
	if result.PeopleCount != "0" {
		t.Errorf("PeopleCount = %q, want %q", result.PeopleCount, "0")
	}
	if result.PeopleFocus != "none" {
		t.Errorf("PeopleFocus = %q, want %q", result.PeopleFocus, "none")
	}
	if result.AuthenticityStyle != "candid" {
		t.Errorf("AuthenticityStyle = %q, want %q", result.AuthenticityStyle, "candid")
	}
	expectedDesc := "A golden retriever puppy sitting on green grass in a park. " +
		"The dog appears happy and relaxed."
	if result.Description != expectedDesc {
		t.Errorf("Description = %q, want expected value", result.Description)
	}

	// Verify array fields
	if len(result.Tone) != 3 {
		t.Errorf("Tone length = %d, want 3", len(result.Tone))
	}
	if result.Tone[0] != "playful" {
		t.Errorf("Tone[0] = %q, want %q", result.Tone[0], "playful")
	}

	if len(result.UsageContext) != 3 {
		t.Errorf("UsageContext length = %d, want 3", len(result.UsageContext))
	}
	if result.UsageContext[0] != "hero" {
		t.Errorf("UsageContext[0] = %q, want %q", result.UsageContext[0], "hero")
	}

	if len(result.SearchTerms) != 10 {
		t.Errorf("SearchTerms length = %d, want 10", len(result.SearchTerms))
	}
	if result.SearchTerms[0] != "dog" {
		t.Errorf("SearchTerms[0] = %q, want %q", result.SearchTerms[0], "dog")
	}
}

func TestParseAnalysisResponse_WithMarkdown(t *testing.T) {
	// Claude sometimes returns JSON wrapped in markdown code blocks
	jsonWithMarkdown := "```json\n" + `{
		"primarySubject": "business meeting",
		"subjectCategory": "people",
		"activity": "meeting",
		"settingType": "office",
		"textSafeColors": "either",
		"backgroundType": "blurred",
		"composition": "center",
		"copySpaceLocation": "none",
		"copySpaceAmount": "minimal",
		"visualComplexity": "moderate",
		"peopleCount": "2-3",
		"peopleFocus": "primary",
		"tone": ["professional"],
		"usageContext": ["content"],
		"authenticityStyle": "stock",
		"description": "A group of people in a business meeting.",
		"searchTerms": ["meeting", "business", "office"]
	}` + "\n```"

	result, err := parseAnalysisResponse([]byte(jsonWithMarkdown))
	if err != nil {
		t.Fatalf("Failed to parse markdown-wrapped response: %v", err)
	}

	if result.PrimarySubject != "business meeting" {
		t.Errorf("PrimarySubject = %q, want %q", result.PrimarySubject, "business meeting")
	}
	if result.SubjectCategory != "people" {
		t.Errorf("SubjectCategory = %q, want %q", result.SubjectCategory, "people")
	}
}

func TestParseAnalysisResponse_WithBackticks(t *testing.T) {
	// Also handle just backticks without json marker
	jsonWithBackticks := "```\n" + `{
		"primarySubject": "coffee cup",
		"subjectCategory": "product",
		"activity": "static",
		"settingType": "studio",
		"textSafeColors": "light-only",
		"backgroundType": "solid",
		"composition": "center",
		"copySpaceLocation": "right",
		"copySpaceAmount": "high",
		"visualComplexity": "minimal",
		"peopleCount": "0",
		"peopleFocus": "none",
		"tone": ["calm", "neutral"],
		"usageContext": ["product", "thumbnail"],
		"authenticityStyle": "stock",
		"description": "A white coffee cup on a dark background.",
		"searchTerms": ["coffee", "cup", "beverage"]
	}` + "\n```"

	result, err := parseAnalysisResponse([]byte(jsonWithBackticks))
	if err != nil {
		t.Fatalf("Failed to parse backtick-wrapped response: %v", err)
	}

	if result.PrimarySubject != "coffee cup" {
		t.Errorf("PrimarySubject = %q, want %q", result.PrimarySubject, "coffee cup")
	}
}

func TestClient_ContextCancellation(t *testing.T) {
	// Create a client with rate limiting
	client := &Client{
		limiter: ratelimit.New(1, 100), // 1 concurrent, high RPS so we only test concurrency
	}

	// First acquire should succeed
	ctx1 := context.Background()
	if err := client.limiter.Acquire(ctx1); err != nil {
		t.Fatalf("First acquire failed: %v", err)
	}
	// Don't release - keep it held

	// Second acquire with cancelled context should fail
	ctx2, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	err := client.limiter.Acquire(ctx2)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("Expected context.Canceled, got %v", err)
	}

	// Clean up
	client.limiter.Release()
}

func TestResult_ToImageAnalysis(t *testing.T) {
	result := &Result{
		PrimarySubject:    "woman in blue blazer presenting at whiteboard",
		SubjectCategory:   "person",
		Activity:          "presenting",
		SettingType:       "office",
		TextSafeColors:    "dark-only",
		BackgroundType:    "blurred",
		Composition:       "left",
		CopySpaceLocation: "right",
		CopySpaceAmount:   "high",
		VisualComplexity:  "low",
		PeopleCount:       "1",
		PeopleFocus:       "primary",
		Tone:              []string{"professional", "energetic"},
		UsageContext:      []string{"hero", "content"},
		AuthenticityStyle: "stock",
		Description:       "A woman in professional attire presenting at a whiteboard.",
		SearchTerms:       []string{"business", "presentation", "woman", "office"},
	}

	analysis := ToImageAnalysis(result)

	if analysis.PrimarySubject != result.PrimarySubject {
		t.Errorf("PrimarySubject = %q, want %q", analysis.PrimarySubject, result.PrimarySubject)
	}
	if analysis.SubjectCategory != models.SubjectCategory(result.SubjectCategory) {
		t.Errorf("SubjectCategory = %q, want %q", analysis.SubjectCategory, result.SubjectCategory)
	}
	if analysis.Activity != models.Activity(result.Activity) {
		t.Errorf("Activity = %q, want %q", analysis.Activity, result.Activity)
	}
	if analysis.SettingType != models.SettingType(result.SettingType) {
		t.Errorf("SettingType = %q, want %q", analysis.SettingType, result.SettingType)
	}
	if analysis.TextSafeColors != models.TextSafeColors(result.TextSafeColors) {
		t.Errorf("TextSafeColors = %q, want %q", analysis.TextSafeColors, result.TextSafeColors)
	}
	if analysis.BackgroundType != models.BackgroundType(result.BackgroundType) {
		t.Errorf("BackgroundType = %q, want %q", analysis.BackgroundType, result.BackgroundType)
	}
	if analysis.Composition != models.Composition(result.Composition) {
		t.Errorf("Composition = %q, want %q", analysis.Composition, result.Composition)
	}
	if analysis.CopySpaceLocation != models.CopySpaceLocation(result.CopySpaceLocation) {
		t.Errorf("CopySpaceLocation = %q, want %q", analysis.CopySpaceLocation, result.CopySpaceLocation)
	}
	if analysis.CopySpaceAmount != models.CopySpaceAmount(result.CopySpaceAmount) {
		t.Errorf("CopySpaceAmount = %q, want %q", analysis.CopySpaceAmount, result.CopySpaceAmount)
	}
	if analysis.VisualComplexity != models.VisualComplexity(result.VisualComplexity) {
		t.Errorf("VisualComplexity = %q, want %q", analysis.VisualComplexity, result.VisualComplexity)
	}
	if analysis.PeopleCount != models.PeopleCount(result.PeopleCount) {
		t.Errorf("PeopleCount = %q, want %q", analysis.PeopleCount, result.PeopleCount)
	}
	if analysis.PeopleFocus != models.PeopleFocus(result.PeopleFocus) {
		t.Errorf("PeopleFocus = %q, want %q", analysis.PeopleFocus, result.PeopleFocus)
	}
	if analysis.AuthenticityStyle != models.AuthenticityStyle(result.AuthenticityStyle) {
		t.Errorf("AuthenticityStyle = %q, want %q", analysis.AuthenticityStyle, result.AuthenticityStyle)
	}
	if analysis.Description != result.Description {
		t.Errorf("Description = %q, want %q", analysis.Description, result.Description)
	}

	// Verify arrays
	if len(analysis.Tone) != 2 {
		t.Errorf("Tone length = %d, want 2", len(analysis.Tone))
	}
	if len(analysis.UsageContext) != 2 {
		t.Errorf("UsageContext length = %d, want 2", len(analysis.UsageContext))
	}
	if len(analysis.SearchTerms) != 4 {
		t.Errorf("SearchTerms length = %d, want 4", len(analysis.SearchTerms))
	}
}

func TestClientStats(t *testing.T) {
	client := &Client{
		limiter: ratelimit.New(5, 100), // 5 concurrent, high RPS
	}

	busy, available := client.Stats()
	if busy != 0 {
		t.Errorf("Initial busy = %d, want 0", busy)
	}
	if available != 5 {
		t.Errorf("Initial available = %d, want 5", available)
	}

	// Acquire one slot
	ctx := context.Background()
	_ = client.limiter.Acquire(ctx)

	busy, available = client.Stats()
	if busy != 1 {
		t.Errorf("After acquire busy = %d, want 1", busy)
	}
	if available != 4 {
		t.Errorf("After acquire available = %d, want 4", available)
	}

	client.limiter.Release()
}

func TestDetectMediaType(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		data        []byte
		expected    string
	}{
		{
			name:        "JPEG from Content-Type",
			contentType: "image/jpeg",
			data:        []byte{},
			expected:    "image/jpeg",
		},
		{
			name:        "PNG from Content-Type",
			contentType: "image/png",
			data:        []byte{},
			expected:    "image/png",
		},
		{
			name:        "JPEG from magic bytes",
			contentType: "",
			data:        []byte{0xFF, 0xD8, 0xFF, 0xE0},
			expected:    "image/jpeg",
		},
		{
			name:        "PNG from magic bytes",
			contentType: "",
			data:        []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A},
			expected:    "image/png",
		},
		{
			name:        "GIF from magic bytes",
			contentType: "",
			data:        []byte{0x47, 0x49, 0x46, 0x38, 0x39, 0x61},
			expected:    "image/gif",
		},
		{
			name:        "WebP from magic bytes",
			contentType: "",
			data:        []byte{'R', 'I', 'F', 'F', 0x00, 0x00, 0x00, 0x00, 'W', 'E', 'B', 'P'},
			expected:    "image/webp",
		},
		{
			name:        "Content-Type with charset",
			contentType: "image/jpeg; charset=utf-8",
			data:        []byte{},
			expected:    "image/jpeg",
		},
		{
			name:        "Default to JPEG for unknown",
			contentType: "",
			data:        []byte{0x00, 0x00, 0x00},
			expected:    "image/jpeg",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectMediaType(tt.contentType, tt.data)
			if result != tt.expected {
				t.Errorf("detectMediaType() = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestBuildAnalysisRequest(t *testing.T) {
	imageData := "base64encodeddata"
	mediaType := "image/jpeg"

	req := buildAnalysisRequest(imageData, mediaType)

	if req.Model != Model {
		t.Errorf("Model = %q, want %q", req.Model, Model)
	}
	if req.MaxTokens != 1024 {
		t.Errorf("MaxTokens = %d, want 1024", req.MaxTokens)
	}
	if len(req.Messages) != 1 {
		t.Fatalf("Messages length = %d, want 1", len(req.Messages))
	}
	if len(req.Messages[0].Content) != 2 {
		t.Fatalf("Content length = %d, want 2", len(req.Messages[0].Content))
	}

	// Check image block
	imgBlock := req.Messages[0].Content[0]
	if imgBlock.Type != "image" {
		t.Errorf("First block type = %q, want %q", imgBlock.Type, "image")
	}
	if imgBlock.Source == nil {
		t.Fatal("Image source is nil")
	}
	if imgBlock.Source.Type != "base64" {
		t.Errorf("Source type = %q, want %q", imgBlock.Source.Type, "base64")
	}
	if imgBlock.Source.MediaType != mediaType {
		t.Errorf("MediaType = %q, want %q", imgBlock.Source.MediaType, mediaType)
	}
	if imgBlock.Source.Data != imageData {
		t.Errorf("Data = %q, want %q", imgBlock.Source.Data, imageData)
	}

	// Check text block
	textBlock := req.Messages[0].Content[1]
	if textBlock.Type != "text" {
		t.Errorf("Second block type = %q, want %q", textBlock.Type, "text")
	}
	if textBlock.Text != UserMessage {
		t.Errorf("Text = %q, want %q", textBlock.Text, UserMessage)
	}
}

// Helper functions

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

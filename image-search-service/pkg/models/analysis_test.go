package models

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestImageAnalysis_JSONRoundTrip(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	original := &ImageAnalysis{
		GettyID: "123456789",
		Title:   "Business team meeting",
		Caption: "Four colleagues discussing project",
		Dimensions: ImageDimensions{
			Width:  5000,
			Height: 3333,
		},
		URLs: ImageURLs{
			Thumbnail: "https://example.com/thumb.jpg",
			Preview:   "https://example.com/preview.jpg",
			HighRes:   "https://example.com/highres.jpg",
		},
		PrimarySubject:      "four colleagues around conference table",
		SubjectCategory:     SubjectCategoryPeople,
		Activity:            ActivityMeeting,
		SettingType:         SettingTypeOffice,
		DominantColors:      []string{"#2C3E50", "#ECF0F1", "#3498DB"},
		TextSafeColors:      TextSafeColorsEither,
		BackgroundType:      BackgroundTypeComplex,
		Composition:         CompositionCenter,
		CopySpaceLocation:   CopySpaceLocationNone,
		CopySpaceAmount:     CopySpaceAmountMinimal,
		VisualComplexity:    VisualComplexityModerate,
		PeopleCount:         PeopleCountFourPlus,
		PeopleFocus:         PeopleFocusPrimary,
		Tone:                []string{ToneProfessional, ToneFriendly},
		UsageContext:        []string{UsageContextHero, UsageContextContent},
		AuthenticityStyle:   AuthenticityStyleStock,
		AspectRatioCategory: AspectRatioCategoryLandscape,
		Description:         "Four diverse business professionals discussing around a modern conference table.",
		SearchTerms: []string{
			"business meeting", "team collaboration", "corporate", "office",
			"professionals", "diverse team", "conference room", "teamwork",
			"discussion", "workplace",
		},
		AnalyzedAt:      now,
		AnalysisVersion: "1",
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded ImageAnalysis
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	// Verify core fields
	if decoded.GettyID != original.GettyID {
		t.Errorf("GettyID mismatch: got %s, want %s", decoded.GettyID, original.GettyID)
	}
	if decoded.Title != original.Title {
		t.Errorf("Title mismatch: got %s, want %s", decoded.Title, original.Title)
	}
	if decoded.Caption != original.Caption {
		t.Errorf("Caption mismatch: got %s, want %s", decoded.Caption, original.Caption)
	}

	// Verify dimensions
	if decoded.Dimensions.Width != original.Dimensions.Width {
		t.Errorf("Dimensions.Width mismatch: got %d, want %d", decoded.Dimensions.Width, original.Dimensions.Width)
	}
	if decoded.Dimensions.Height != original.Dimensions.Height {
		t.Errorf("Dimensions.Height mismatch: got %d, want %d", decoded.Dimensions.Height, original.Dimensions.Height)
	}

	// Verify URLs
	if decoded.URLs.Thumbnail != original.URLs.Thumbnail {
		t.Errorf("URLs.Thumbnail mismatch: got %s, want %s", decoded.URLs.Thumbnail, original.URLs.Thumbnail)
	}

	// Verify subject fields
	if decoded.SubjectCategory != original.SubjectCategory {
		t.Errorf("SubjectCategory mismatch: got %s, want %s", decoded.SubjectCategory, original.SubjectCategory)
	}
	if decoded.Activity != original.Activity {
		t.Errorf("Activity mismatch: got %s, want %s", decoded.Activity, original.Activity)
	}
	if decoded.SettingType != original.SettingType {
		t.Errorf("SettingType mismatch: got %s, want %s", decoded.SettingType, original.SettingType)
	}

	// Verify array fields
	if len(decoded.Tone) != len(original.Tone) {
		t.Errorf("Tone length mismatch: got %d, want %d", len(decoded.Tone), len(original.Tone))
	}
	for i, v := range decoded.Tone {
		if v != original.Tone[i] {
			t.Errorf("Tone[%d] mismatch: got %s, want %s", i, v, original.Tone[i])
		}
	}

	if len(decoded.UsageContext) != len(original.UsageContext) {
		t.Errorf("UsageContext length mismatch: got %d, want %d", len(decoded.UsageContext), len(original.UsageContext))
	}

	if len(decoded.DominantColors) != len(original.DominantColors) {
		t.Errorf("DominantColors length mismatch: got %d, want %d", len(decoded.DominantColors), len(original.DominantColors))
	}

	if len(decoded.SearchTerms) != len(original.SearchTerms) {
		t.Errorf("SearchTerms length mismatch: got %d, want %d", len(decoded.SearchTerms), len(original.SearchTerms))
	}

	// Verify time (truncated to seconds for comparison)
	if !decoded.AnalyzedAt.Equal(original.AnalyzedAt) {
		t.Errorf("AnalyzedAt mismatch: got %v, want %v", decoded.AnalyzedAt, original.AnalyzedAt)
	}
}

func TestImageAnalysis_EmbeddingText(t *testing.T) {
	analysis := &ImageAnalysis{
		PrimarySubject: "golden retriever puppy",
		Description:    "A playful golden retriever puppy sitting on grass.",
		Activity:       ActivityPlaying,
		SettingType:    SettingTypeOutdoor,
		SearchTerms:    []string{"dog", "puppy", "pet", "golden retriever", "playful"},
	}

	text := analysis.EmbeddingText()

	// Verify all components are present
	if !strings.Contains(text, "golden retriever puppy") {
		t.Error("EmbeddingText should contain primarySubject")
	}
	if !strings.Contains(text, "A playful golden retriever puppy") {
		t.Error("EmbeddingText should contain description")
	}
	if !strings.Contains(text, string(ActivityPlaying)) {
		t.Error("EmbeddingText should contain activity")
	}
	if !strings.Contains(text, string(SettingTypeOutdoor)) {
		t.Error("EmbeddingText should contain settingType")
	}
	if !strings.Contains(text, "dog puppy pet golden retriever playful") {
		t.Error("EmbeddingText should contain joined searchTerms")
	}
}

func TestImageAnalysis_EmptyOptionalFields(t *testing.T) {
	// Test that optional fields are handled correctly
	analysis := &ImageAnalysis{
		GettyID:         "minimal",
		Title:           "Minimal test",
		SubjectCategory: SubjectCategoryOther,
	}

	data, err := json.Marshal(analysis)
	if err != nil {
		t.Fatalf("failed to marshal minimal analysis: %v", err)
	}

	// Caption should be omitted when empty
	if strings.Contains(string(data), `"caption":""`) {
		t.Error("Empty caption should be omitted from JSON")
	}

	var decoded ImageAnalysis
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal minimal analysis: %v", err)
	}

	if decoded.GettyID != "minimal" {
		t.Errorf("GettyID mismatch: got %s, want minimal", decoded.GettyID)
	}
}

func TestImageDimensions_JSON(t *testing.T) {
	dims := ImageDimensions{
		Width:  1920,
		Height: 1080,
	}

	data, err := json.Marshal(dims)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded ImageDimensions
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.Width != dims.Width || decoded.Height != dims.Height {
		t.Errorf("Dimensions mismatch: got %+v, want %+v", decoded, dims)
	}
}

func TestImageURLs_JSON(t *testing.T) {
	urls := ImageURLs{
		Thumbnail: "https://example.com/thumb.jpg",
		Preview:   "https://example.com/preview.jpg",
		HighRes:   "https://example.com/highres.jpg",
	}

	data, err := json.Marshal(urls)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded ImageURLs
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded != urls {
		t.Errorf("URLs mismatch: got %+v, want %+v", decoded, urls)
	}
}

// Test all enum constants are valid strings
func TestEnumConstants(t *testing.T) {
	// Subject Category
	subjectCategories := []SubjectCategory{
		SubjectCategoryPerson, SubjectCategoryPeople, SubjectCategoryAnimal,
		SubjectCategoryNature, SubjectCategoryTechnology, SubjectCategoryFood,
		SubjectCategoryArchitecture, SubjectCategoryVehicle, SubjectCategoryProduct,
		SubjectCategoryAbstract, SubjectCategoryWorkspace, SubjectCategoryLifestyle,
		SubjectCategoryOther,
	}
	for _, v := range subjectCategories {
		if v == "" {
			t.Error("SubjectCategory should not be empty")
		}
	}

	// Activity
	activities := []Activity{
		ActivityWorking, ActivityMeeting, ActivityPresenting, ActivityRelaxing,
		ActivityExercising, ActivityEating, ActivityTraveling, ActivityCelebrating,
		ActivityCreating, ActivityCommunicating, ActivityShopping, ActivityLearning,
		ActivityPlaying, ActivityStatic, ActivityNone,
	}
	for _, v := range activities {
		if v == "" {
			t.Error("Activity should not be empty")
		}
	}

	// Composition
	compositions := []Composition{
		CompositionLeft, CompositionRight, CompositionCenter, CompositionTop,
		CompositionBottom, CompositionTopLeft, CompositionTopRight,
		CompositionBottomLeft, CompositionBottomRight, CompositionFullFrame,
		CompositionScattered,
	}
	for _, v := range compositions {
		if v == "" {
			t.Error("Composition should not be empty")
		}
	}

	// CopySpaceLocation
	copySpaceLocations := []CopySpaceLocation{
		CopySpaceLocationLeft, CopySpaceLocationRight, CopySpaceLocationTop,
		CopySpaceLocationBottom, CopySpaceLocationCenter, CopySpaceLocationTopLeft,
		CopySpaceLocationTopRight, CopySpaceLocationBottomLeft, CopySpaceLocationBottomRight,
		CopySpaceLocationNone, CopySpaceLocationMultiple,
	}
	for _, v := range copySpaceLocations {
		if v == "" {
			t.Error("CopySpaceLocation should not be empty")
		}
	}

	// CopySpaceAmount
	copySpaceAmounts := []CopySpaceAmount{
		CopySpaceAmountNone, CopySpaceAmountMinimal, CopySpaceAmountModerate, CopySpaceAmountHigh,
	}
	for _, v := range copySpaceAmounts {
		if v == "" {
			t.Error("CopySpaceAmount should not be empty")
		}
	}

	// PeopleCount
	peopleCounts := []PeopleCount{
		PeopleCountZero, PeopleCountOne, PeopleCountTwoThree, PeopleCountFourPlus,
	}
	for _, v := range peopleCounts {
		if v == "" {
			t.Error("PeopleCount should not be empty")
		}
	}

	// PeopleFocus
	peopleFocuses := []PeopleFocus{
		PeopleFocusNone, PeopleFocusBackground, PeopleFocusSecondary, PeopleFocusPrimary,
	}
	for _, v := range peopleFocuses {
		if v == "" {
			t.Error("PeopleFocus should not be empty")
		}
	}

	// Tone
	tones := []string{
		ToneProfessional, ToneCasual, ToneSerious, TonePlayful, ToneEnergetic,
		ToneCalm, ToneDramatic, ToneInspiring, ToneLuxurious, ToneFriendly, ToneNeutral,
	}
	for _, v := range tones {
		if v == "" {
			t.Error("Tone should not be empty")
		}
	}

	// UsageContext
	usageContexts := []string{
		UsageContextHero, UsageContextBanner, UsageContextBackground, UsageContextProduct,
		UsageContextProfile, UsageContextThumbnail, UsageContextIcon, UsageContextContent,
		UsageContextTestimonial, UsageContextGallery, UsageContextGeneral,
	}
	for _, v := range usageContexts {
		if v == "" {
			t.Error("UsageContext should not be empty")
		}
	}

	// BackgroundType
	backgroundTypes := []BackgroundType{
		BackgroundTypeSolid, BackgroundTypeGradient, BackgroundTypeBlurred,
		BackgroundTypeDetailed, BackgroundTypeTransparent, BackgroundTypePattern,
		BackgroundTypeNatural, BackgroundTypeComplex,
	}
	for _, v := range backgroundTypes {
		if v == "" {
			t.Error("BackgroundType should not be empty")
		}
	}

	// TextSafeColors
	textSafeColors := []TextSafeColors{
		TextSafeColorsLightOnly, TextSafeColorsDarkOnly, TextSafeColorsEither, TextSafeColorsNeither,
	}
	for _, v := range textSafeColors {
		if v == "" {
			t.Error("TextSafeColors should not be empty")
		}
	}

	// VisualComplexity
	visualComplexities := []VisualComplexity{
		VisualComplexityMinimal, VisualComplexityLow, VisualComplexityModerate,
		VisualComplexityHigh, VisualComplexityVeryHigh,
	}
	for _, v := range visualComplexities {
		if v == "" {
			t.Error("VisualComplexity should not be empty")
		}
	}

	// AuthenticityStyle
	authenticityStyles := []AuthenticityStyle{
		AuthenticityStyleStock, AuthenticityStyleEditorial, AuthenticityStyleCandid,
		AuthenticityStyleArtistic, AuthenticityStyleDocumentary,
	}
	for _, v := range authenticityStyles {
		if v == "" {
			t.Error("AuthenticityStyle should not be empty")
		}
	}

	// AspectRatioCategory
	aspectRatioCategories := []AspectRatioCategory{
		AspectRatioCategorySquare, AspectRatioCategoryLandscape, AspectRatioCategoryPortrait,
		AspectRatioCategoryPanoramic, AspectRatioCategoryVerticalBanner,
	}
	for _, v := range aspectRatioCategories {
		if v == "" {
			t.Error("AspectRatioCategory should not be empty")
		}
	}

	// SettingType
	settingTypes := []SettingType{
		SettingTypeOffice, SettingTypeHome, SettingTypeOutdoor, SettingTypeStudio,
		SettingTypeRestaurant, SettingTypeRetail, SettingTypeUrban, SettingTypeNature,
		SettingTypeIndustrial, SettingTypeMedical, SettingTypeEducational,
		SettingTypeAbstract, SettingTypeOther,
	}
	for _, v := range settingTypes {
		if v == "" {
			t.Error("SettingType should not be empty")
		}
	}
}

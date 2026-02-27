// Package models defines the data structures for image analysis.
package models

import (
	"strings"
	"time"
)

// SubjectCategory represents the broad category of the image subject.
type SubjectCategory string

// SubjectCategory enum values.
const (
	SubjectCategoryPerson       SubjectCategory = "person"
	SubjectCategoryPeople       SubjectCategory = "people"
	SubjectCategoryAnimal       SubjectCategory = "animal"
	SubjectCategoryNature       SubjectCategory = "nature"
	SubjectCategoryTechnology   SubjectCategory = "technology"
	SubjectCategoryFood         SubjectCategory = "food"
	SubjectCategoryArchitecture SubjectCategory = "architecture"
	SubjectCategoryVehicle      SubjectCategory = "vehicle"
	SubjectCategoryProduct      SubjectCategory = "product"
	SubjectCategoryAbstract     SubjectCategory = "abstract"
	SubjectCategoryWorkspace    SubjectCategory = "workspace"
	SubjectCategoryLifestyle    SubjectCategory = "lifestyle"
	SubjectCategoryOther        SubjectCategory = "other"
)

// Activity represents the action depicted in the image.
type Activity string

// Activity enum values.
const (
	ActivityWorking       Activity = "working"
	ActivityMeeting       Activity = "meeting"
	ActivityPresenting    Activity = "presenting"
	ActivityRelaxing      Activity = "relaxing"
	ActivityExercising    Activity = "exercising"
	ActivityEating        Activity = "eating"
	ActivityTraveling     Activity = "traveling"
	ActivityCelebrating   Activity = "celebrating"
	ActivityCreating      Activity = "creating"
	ActivityCommunicating Activity = "communicating"
	ActivityShopping      Activity = "shopping"
	ActivityLearning      Activity = "learning"
	ActivityPlaying       Activity = "playing"
	ActivityStatic        Activity = "static"
	ActivityNone          Activity = "none"
)

// SettingType represents the environment type of the image.
type SettingType string

// SettingType enum values.
const (
	SettingTypeOffice      SettingType = "office"
	SettingTypeHome        SettingType = "home"
	SettingTypeOutdoor     SettingType = "outdoor"
	SettingTypeStudio      SettingType = "studio"
	SettingTypeRestaurant  SettingType = "restaurant"
	SettingTypeRetail      SettingType = "retail"
	SettingTypeUrban       SettingType = "urban"
	SettingTypeNature      SettingType = "nature"
	SettingTypeIndustrial  SettingType = "industrial"
	SettingTypeMedical     SettingType = "medical"
	SettingTypeEducational SettingType = "educational"
	SettingTypeAbstract    SettingType = "abstract"
	SettingTypeOther       SettingType = "other"
)

// ColorMood represents the overall color mood of the image.
type ColorMood string

// ColorMood enum values.
const (
	ColorMoodWarm    ColorMood = "warm"
	ColorMoodCool    ColorMood = "cool"
	ColorMoodNeutral ColorMood = "neutral"
	ColorMoodVibrant ColorMood = "vibrant"
	ColorMoodMuted   ColorMood = "muted"
)

// Composition represents where the visual interest is positioned.
type Composition string

// Composition enum values.
const (
	CompositionLeft        Composition = "left"
	CompositionRight       Composition = "right"
	CompositionCenter      Composition = "center"
	CompositionTop         Composition = "top"
	CompositionBottom      Composition = "bottom"
	CompositionTopLeft     Composition = "top-left"
	CompositionTopRight    Composition = "top-right"
	CompositionBottomLeft  Composition = "bottom-left"
	CompositionBottomRight Composition = "bottom-right"
	CompositionFullFrame   Composition = "full-frame"
	CompositionScattered   Composition = "scattered"
)

// CopySpaceLocation represents the best location for text overlay.
type CopySpaceLocation string

// CopySpaceLocation enum values.
const (
	CopySpaceLocationLeft        CopySpaceLocation = "left"
	CopySpaceLocationRight       CopySpaceLocation = "right"
	CopySpaceLocationTop         CopySpaceLocation = "top"
	CopySpaceLocationBottom      CopySpaceLocation = "bottom"
	CopySpaceLocationCenter      CopySpaceLocation = "center"
	CopySpaceLocationTopLeft     CopySpaceLocation = "top-left"
	CopySpaceLocationTopRight    CopySpaceLocation = "top-right"
	CopySpaceLocationBottomLeft  CopySpaceLocation = "bottom-left"
	CopySpaceLocationBottomRight CopySpaceLocation = "bottom-right"
	CopySpaceLocationNone        CopySpaceLocation = "none"
	CopySpaceLocationMultiple    CopySpaceLocation = "multiple"
)

// CopySpaceAmount represents the amount of empty space available for text.
type CopySpaceAmount string

// CopySpaceAmount enum values.
const (
	CopySpaceAmountNone     CopySpaceAmount = "none"
	CopySpaceAmountMinimal  CopySpaceAmount = "minimal"
	CopySpaceAmountModerate CopySpaceAmount = "moderate"
	CopySpaceAmountHigh     CopySpaceAmount = "high"
)

// PeopleCount represents the number of people visible in the image.
type PeopleCount string

// PeopleCount enum values.
const (
	PeopleCountZero     PeopleCount = "0"
	PeopleCountOne      PeopleCount = "1"
	PeopleCountTwoThree PeopleCount = "2-3"
	PeopleCountFourPlus PeopleCount = "4+"
)

// PeopleFocus represents how prominently people feature in the image.
type PeopleFocus string

// PeopleFocus enum values.
const (
	PeopleFocusNone       PeopleFocus = "none"
	PeopleFocusBackground PeopleFocus = "background"
	PeopleFocusSecondary  PeopleFocus = "secondary"
	PeopleFocusPrimary    PeopleFocus = "primary"
)

// Tone constants for emotional tones (used in array of 1-3 values).
const (
	ToneProfessional = "professional"
	ToneCasual       = "casual"
	ToneSerious      = "serious"
	TonePlayful      = "playful"
	ToneEnergetic    = "energetic"
	ToneCalm         = "calm"
	ToneDramatic     = "dramatic"
	ToneInspiring    = "inspiring"
	ToneLuxurious    = "luxurious"
	ToneFriendly     = "friendly"
	ToneNeutral      = "neutral"
)

// UsageContext constants for suitable content types (used in array of 1-3 values).
const (
	UsageContextHero        = "hero"
	UsageContextBanner      = "banner"
	UsageContextBackground  = "background"
	UsageContextProduct     = "product"
	UsageContextProfile     = "profile"
	UsageContextThumbnail   = "thumbnail"
	UsageContextIcon        = "icon"
	UsageContextContent     = "content"
	UsageContextTestimonial = "testimonial"
	UsageContextGallery     = "gallery"
	UsageContextGeneral     = "general"
)

// BackgroundType represents the background characteristics.
type BackgroundType string

// BackgroundType enum values.
const (
	BackgroundTypeSolid       BackgroundType = "solid"
	BackgroundTypeGradient    BackgroundType = "gradient"
	BackgroundTypeBlurred     BackgroundType = "blurred"
	BackgroundTypeDetailed    BackgroundType = "detailed"
	BackgroundTypeTransparent BackgroundType = "transparent"
	BackgroundTypePattern     BackgroundType = "pattern"
	BackgroundTypeNatural     BackgroundType = "natural"
	BackgroundTypeComplex     BackgroundType = "complex"
)

// TextSafeColors represents what text colors would be readable on the image.
type TextSafeColors string

// TextSafeColors enum values.
const (
	TextSafeColorsLightOnly TextSafeColors = "light-only"
	TextSafeColorsDarkOnly  TextSafeColors = "dark-only"
	TextSafeColorsEither    TextSafeColors = "either"
	TextSafeColorsNeither   TextSafeColors = "neither"
)

// VisualComplexity represents the overall visual busyness.
type VisualComplexity string

// VisualComplexity enum values.
const (
	VisualComplexityMinimal  VisualComplexity = "minimal"
	VisualComplexityLow      VisualComplexity = "low"
	VisualComplexityModerate VisualComplexity = "moderate"
	VisualComplexityHigh     VisualComplexity = "high"
	VisualComplexityVeryHigh VisualComplexity = "very-high"
)

// AuthenticityStyle represents the visual style/authenticity feel.
type AuthenticityStyle string

// AuthenticityStyle enum values.
const (
	AuthenticityStyleStock       AuthenticityStyle = "stock"
	AuthenticityStyleEditorial   AuthenticityStyle = "editorial"
	AuthenticityStyleCandid      AuthenticityStyle = "candid"
	AuthenticityStyleArtistic    AuthenticityStyle = "artistic"
	AuthenticityStyleDocumentary AuthenticityStyle = "documentary"
)

// AspectRatioCategory represents the calculated aspect ratio category.
type AspectRatioCategory string

// AspectRatioCategory enum values.
const (
	AspectRatioCategorySquare         AspectRatioCategory = "square"
	AspectRatioCategoryLandscape      AspectRatioCategory = "landscape"
	AspectRatioCategoryPortrait       AspectRatioCategory = "portrait"
	AspectRatioCategoryPanoramic      AspectRatioCategory = "panoramic"
	AspectRatioCategoryVerticalBanner AspectRatioCategory = "vertical-banner"
)

// ImageDimensions holds the width and height of an image.
type ImageDimensions struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// ImageURLs holds URLs for different image sizes.
type ImageURLs struct {
	Thumbnail string `json:"thumbnail"`
	Preview   string `json:"preview"`
	HighRes   string `json:"highRes"`
}

// ImageAnalysis is the complete analysis for an image.
type ImageAnalysis struct {
	// Core identification
	GettyID    string          `json:"gettyId"`
	Title      string          `json:"title"`
	Caption    string          `json:"caption,omitempty"`
	Dimensions ImageDimensions `json:"dimensions"`
	URLs       ImageURLs       `json:"urls"`

	// Subject Focus (Haiku)
	PrimarySubject  string          `json:"primarySubject"`
	SubjectCategory SubjectCategory `json:"subjectCategory"`
	Activity        Activity        `json:"activity"`
	SettingType     SettingType     `json:"settingType"`

	// Color (Mixed - programmatic + Haiku)
	DominantColors []string       `json:"dominantColors"` // Programmatic: 3 hex codes
	ColorMood      ColorMood      `json:"colorMood"`      // Derived from colors
	TextSafeColors TextSafeColors `json:"textSafeColors"` // Haiku
	BackgroundType BackgroundType `json:"backgroundType"` // Haiku

	// Composition (Haiku)
	Composition       Composition       `json:"composition"`
	CopySpaceLocation CopySpaceLocation `json:"copySpaceLocation"`
	CopySpaceAmount   CopySpaceAmount   `json:"copySpaceAmount"`
	VisualComplexity  VisualComplexity  `json:"visualComplexity"`

	// People (Haiku)
	PeopleCount PeopleCount `json:"peopleCount"`
	PeopleFocus PeopleFocus `json:"peopleFocus"`

	// Mood & Style (Haiku)
	Tone              []string          `json:"tone"`         // Array of 1-3
	UsageContext      []string          `json:"usageContext"` // Array of 1-3
	AuthenticityStyle AuthenticityStyle `json:"authenticityStyle"`

	// Getty metadata (populated from Getty API response)
	Orientation    string   `json:"orientation,omitempty"`    // e.g. "horizontal", "vertical"
	GraphicalStyle string   `json:"graphicalStyle,omitempty"` // e.g. "photography", "illustration"
	Moods          []string `json:"moods,omitempty"`          // e.g. ["warm", "natural"]
	NumberOfPeople string   `json:"numberOfPeople,omitempty"` // e.g. "none", "one", "two", "group"
	Ethnicity      []string `json:"ethnicity,omitempty"`
	AgeOfPeople    []string `json:"ageOfPeople,omitempty"`
	CollectionCode string   `json:"collectionCode,omitempty"`
	Artist         string   `json:"artist,omitempty"`
	GettyKeywords  []string `json:"gettyKeywords,omitempty"` // From Getty keywords[].text

	// Programmatic
	AspectRatioCategory AspectRatioCategory `json:"aspectRatioCategory"`

	// Content (Haiku)
	Description string   `json:"description"`
	SearchTerms []string `json:"searchTerms"` // 10-15 keywords

	// Metadata
	AnalyzedAt      time.Time `json:"analyzedAt"`
	AnalysisVersion string    `json:"analysisVersion"`

	// Vector embedding (for Qdrant, not JSON serialized)
	Embedding []float32 `json:"-"`

	// RelevanceScore is the semantic similarity score from Qdrant (0-1, higher = more relevant).
	// Only populated when retrieved via vector search, not by ID lookup.
	RelevanceScore float32 `json:"relevanceScore,omitempty"`
}

// EmbeddingText returns the concatenated text used for generating embeddings.
// The text combines primarySubject, description, activity, settingType, and searchTerms.
func (a *ImageAnalysis) EmbeddingText() string {
	parts := []string{
		a.PrimarySubject,
		a.Description,
		string(a.Activity),
		string(a.SettingType),
		strings.Join(a.SearchTerms, " "),
	}
	return strings.Join(parts, " ")
}

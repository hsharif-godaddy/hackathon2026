// Package getty provides typed enums for Getty Images API parameters.
package getty

import (
	"testing"
)

func TestOrientationValues(t *testing.T) {
	tests := []struct {
		orientation Orientation
		expected    string
	}{
		{OrientationHorizontal, "horizontal"},
		{OrientationVertical, "vertical"},
		{OrientationSquare, "square"},
		{OrientationPanoramicHorizontal, "panoramic_horizontal"},
		{OrientationPanoramicVertical, "panoramic_vertical"},
	}

	for _, tt := range tests {
		if string(tt.orientation) != tt.expected {
			t.Errorf("Orientation %v = %q, want %q", tt.orientation, string(tt.orientation), tt.expected)
		}
	}
}

func TestOrientationAcceptsUnknownValues(t *testing.T) {
	unknown := Orientation("future_circular")
	if string(unknown) != "future_circular" {
		t.Errorf("Unknown orientation should be accepted, got %q", string(unknown))
	}
}

func TestCompositionValues(t *testing.T) {
	tests := []struct {
		composition Composition
		expected    string
	}{
		{CompositionAbstract, "abstract"},
		{CompositionCopySpace, "copy_space"},
		{CompositionHeadshot, "headshot"},
		{CompositionWideShot, "wide_shot"},
	}

	for _, tt := range tests {
		if string(tt.composition) != tt.expected {
			t.Errorf("Composition %v = %q, want %q", tt.composition, string(tt.composition), tt.expected)
		}
	}
}

func TestNumberOfPeopleValues(t *testing.T) {
	tests := []struct {
		num      NumberOfPeople
		expected string
	}{
		{NumberOfPeopleNone, "none"},
		{NumberOfPeopleOne, "one"},
		{NumberOfPeopleTwo, "two"},
		{NumberOfPeopleGroup, "group"},
	}

	for _, tt := range tests {
		if string(tt.num) != tt.expected {
			t.Errorf("NumberOfPeople %v = %q, want %q", tt.num, string(tt.num), tt.expected)
		}
	}
}

func TestSortOrderValues(t *testing.T) {
	tests := []struct {
		order    SortOrder
		expected string
	}{
		{SortOrderBestMatch, "best_match"},
		{SortOrderMostPopular, "most_popular"},
		{SortOrderNewest, "newest"},
		{SortOrderRandom, "random"},
	}

	for _, tt := range tests {
		if string(tt.order) != tt.expected {
			t.Errorf("SortOrder %v = %q, want %q", tt.order, string(tt.order), tt.expected)
		}
	}
}

func TestGraphicalStyleValues(t *testing.T) {
	tests := []struct {
		style    GraphicalStyle
		expected string
	}{
		{GraphicalStylePhotography, "photography"},
		{GraphicalStyleIllustration, "illustration"},
		{GraphicalStyleFineArt, "fine_art"},
		{GraphicalStyleVector, "vector"},
	}

	for _, tt := range tests {
		if string(tt.style) != tt.expected {
			t.Errorf("GraphicalStyle %v = %q, want %q", tt.style, string(tt.style), tt.expected)
		}
	}
}

func TestMoodValues(t *testing.T) {
	tests := []struct {
		mood     Mood
		expected string
	}{
		{MoodBlackAndWhite, "black_and_white"},
		{MoodBold, "bold"},
		{MoodCool, "cool"},
		{MoodDramatic, "dramatic"},
		{MoodNatural, "natural"},
		{MoodVivid, "vivid"},
		{MoodWarm, "warm"},
	}

	for _, tt := range tests {
		if string(tt.mood) != tt.expected {
			t.Errorf("Mood %v = %q, want %q", tt.mood, string(tt.mood), tt.expected)
		}
	}
}

func TestEthnicityValues(t *testing.T) {
	tests := []struct {
		ethnicity Ethnicity
		expected  string
	}{
		{EthnicityBlack, "black"},
		{EthnicityWhite, "white"},
		{EthnicityEastAsian, "east_asian"},
		{EthnicityHispanicLatinx, "hispanic_latinx"},
		{EthnicityJapanese, "japanese"},
		{EthnicityMiddleEastern, "middle_eastern"},
		{EthnicityMultiracialPerson, "multiracial_person"},
		{EthnicityMultiethnicGroup, "multiethnic_group"},
		{EthnicityNativeAmericanFirstNations, "native_american_first_nations"},
		{EthnicityPacificIslander, "pacific_islander"},
		{EthnicitySouthAsian, "south_asian"},
		{EthnicitySoutheastAsian, "southeast_asian"},
	}

	for _, tt := range tests {
		if string(tt.ethnicity) != tt.expected {
			t.Errorf("Ethnicity %v = %q, want %q", tt.ethnicity, string(tt.ethnicity), tt.expected)
		}
	}
}

func TestAgeOfPeopleValues(t *testing.T) {
	// Test categorical values
	categoricalTests := []struct {
		age      AgeOfPeople
		expected string
	}{
		{AgeOfPeopleNewborn, "newborn"},
		{AgeOfPeopleBaby, "baby"},
		{AgeOfPeopleChild, "child"},
		{AgeOfPeopleTeenager, "teenager"},
		{AgeOfPeopleYoungAdult, "young_adult"},
		{AgeOfPeopleAdult, "adult"},
		{AgeOfPeopleAdultsOnly, "adults_only"},
		{AgeOfPeopleMatureAdult, "mature_adult"},
		{AgeOfPeopleSeniorAdult, "senior_adult"},
	}

	for _, tt := range categoricalTests {
		if string(tt.age) != tt.expected {
			t.Errorf("AgeOfPeople %v = %q, want %q", tt.age, string(tt.age), tt.expected)
		}
	}

	// Test some specific age ranges
	ageRangeTests := []struct {
		age      AgeOfPeople
		expected string
	}{
		{AgeOfPeople0To1Months, "0-1_months"},
		{AgeOfPeople2To5Months, "2-5_months"},
		{AgeOfPeople6To11Months, "6-11_months"},
		{AgeOfPeople12To17Months, "12-17_months"},
		{AgeOfPeople18To23Months, "18-23_months"},
		{AgeOfPeople2To3Years, "2-3_years"},
		{AgeOfPeople20To24Years, "20-24_years"},
		{AgeOfPeople100YearsAndOver, "100_years_and_over"},
	}

	for _, tt := range ageRangeTests {
		if string(tt.age) != tt.expected {
			t.Errorf("AgeOfPeople %v = %q, want %q", tt.age, string(tt.age), tt.expected)
		}
	}
}

func TestMinimumSizeValues(t *testing.T) {
	tests := []struct {
		size     MinimumSize
		expected string
	}{
		{MinimumSizeXSmall, "x_small"},
		{MinimumSizeSmall, "small"},
		{MinimumSizeMedium, "medium"},
		{MinimumSizeLarge, "large"},
		{MinimumSizeXLarge, "x_large"},
		{MinimumSizeXXLarge, "xx_large"},
		{MinimumSizeVector, "vector"},
	}

	for _, tt := range tests {
		if string(tt.size) != tt.expected {
			t.Errorf("MinimumSize %v = %q, want %q", tt.size, string(tt.size), tt.expected)
		}
	}
}

func TestFileTypeValues(t *testing.T) {
	tests := []struct {
		fileType FileType
		expected string
	}{
		{FileTypeJPG, "jpg"},
		{FileTypeEPS, "eps"},
	}

	for _, tt := range tests {
		if string(tt.fileType) != tt.expected {
			t.Errorf("FileType %v = %q, want %q", tt.fileType, string(tt.fileType), tt.expected)
		}
	}
}

func TestFilterTypeValues(t *testing.T) {
	tests := []struct {
		filterType FilterType
		expected   string
	}{
		{FilterTypeInclude, "include"},
		{FilterTypeExclude, "exclude"},
	}

	for _, tt := range tests {
		if string(tt.filterType) != tt.expected {
			t.Errorf("FilterType %v = %q, want %q", tt.filterType, string(tt.filterType), tt.expected)
		}
	}
}

func TestFacetFieldValues(t *testing.T) {
	tests := []struct {
		field    FacetField
		expected string
	}{
		{FacetFieldArtists, "artists"},
		{FacetFieldLocations, "locations"},
	}

	for _, tt := range tests {
		if string(tt.field) != tt.expected {
			t.Errorf("FacetField %v = %q, want %q", tt.field, string(tt.field), tt.expected)
		}
	}
}

func TestFieldValues(t *testing.T) {
	tests := []struct {
		field    Field
		expected string
	}{
		{FieldID, "id"},
		{FieldTitle, "title"},
		{FieldCaption, "caption"},
		{FieldDisplaySizes, "display_sizes"},
		{FieldMaxDimensions, "max_dimensions"},
		{FieldArtist, "artist"},
		{FieldKeywords, "keywords"},
		{FieldDownloadSizes, "download_sizes"},
	}

	for _, tt := range tests {
		if string(tt.field) != tt.expected {
			t.Errorf("Field %v = %q, want %q", tt.field, string(tt.field), tt.expected)
		}
	}
}

func TestMarketValues(t *testing.T) {
	tests := []struct {
		market   Market
		expected string
	}{
		{MarketEnUS, "en-US"},
		{MarketEnGB, "en-GB"},
		{MarketDeDE, "de-DE"},
		{MarketFrFR, "fr-FR"},
		{MarketJaJP, "ja-JP"},
		{MarketZhCN, "zh-CN"},
	}

	for _, tt := range tests {
		if string(tt.market) != tt.expected {
			t.Errorf("Market %v = %q, want %q", tt.market, string(tt.market), tt.expected)
		}
	}
}

// TestOpenEnumPattern verifies that all enum types follow the open enum pattern
// (accepting any string value, not just predefined constants).
func TestOpenEnumPattern(t *testing.T) {
	// Each enum should accept arbitrary string values for forward compatibility
	tests := []struct {
		name  string
		value string
	}{
		{"Orientation", string(Orientation("future_value"))},
		{"Composition", string(Composition("future_value"))},
		{"GraphicalStyle", string(GraphicalStyle("future_value"))},
		{"Mood", string(Mood("future_value"))},
		{"NumberOfPeople", string(NumberOfPeople("future_value"))},
		{"Ethnicity", string(Ethnicity("future_value"))},
		{"AgeOfPeople", string(AgeOfPeople("future_value"))},
		{"SortOrder", string(SortOrder("future_value"))},
		{"MinimumSize", string(MinimumSize("future_value"))},
		{"FileType", string(FileType("future_value"))},
		{"FilterType", string(FilterType("future_value"))},
		{"FacetField", string(FacetField("future_value"))},
		{"Field", string(Field("future_value"))},
		{"Market", string(Market("future_value"))},
	}

	for _, tt := range tests {
		if tt.value != "future_value" {
			t.Errorf("%s should accept arbitrary values, got %q", tt.name, tt.value)
		}
	}
}

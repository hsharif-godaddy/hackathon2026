// Package getty provides typed enums for Getty Images API parameters.
// These types use the "open enum" pattern - they are typed strings that accept
// any value for forward compatibility with Getty API changes, while providing
// constants for known values to enable IDE autocomplete.
package getty

// Orientation specifies image orientation for search filtering.
// Values: horizontal, vertical, square, panoramic_horizontal, panoramic_vertical
type Orientation string

const (
	OrientationHorizontal          Orientation = "horizontal"
	OrientationVertical            Orientation = "vertical"
	OrientationSquare              Orientation = "square"
	OrientationPanoramicHorizontal Orientation = "panoramic_horizontal"
	OrientationPanoramicVertical   Orientation = "panoramic_vertical"
)

// Composition specifies image composition style for search filtering.
// Values: abstract, candid, close_up, copy_space, cut_out, full_frame, full_length,
// headshot, looking_at_camera, macro, medium_shot, part_of_a_series, portrait,
// sparse, still_life, three_quarter_length, waist_up, wide_shot
type Composition string

const (
	CompositionAbstract           Composition = "abstract"
	CompositionCandid             Composition = "candid"
	CompositionCloseUp            Composition = "close_up"
	CompositionCopySpace          Composition = "copy_space"
	CompositionCutOut             Composition = "cut_out"
	CompositionFullFrame          Composition = "full_frame"
	CompositionFullLength         Composition = "full_length"
	CompositionHeadshot           Composition = "headshot"
	CompositionLookingAtCamera    Composition = "looking_at_camera"
	CompositionMacro              Composition = "macro"
	CompositionMediumShot         Composition = "medium_shot"
	CompositionPartOfASeries      Composition = "part_of_a_series"
	CompositionPortrait           Composition = "portrait"
	CompositionSparse             Composition = "sparse"
	CompositionStillLife          Composition = "still_life"
	CompositionThreeQuarterLength Composition = "three_quarter_length"
	CompositionWaistUp            Composition = "waist_up"
	CompositionWideShot           Composition = "wide_shot"
)

// GraphicalStyle specifies the graphical style for search filtering.
// Values: photography, illustration, fine_art, vector
type GraphicalStyle string

const (
	GraphicalStylePhotography  GraphicalStyle = "photography"
	GraphicalStyleIllustration GraphicalStyle = "illustration"
	GraphicalStyleFineArt      GraphicalStyle = "fine_art"
	GraphicalStyleVector       GraphicalStyle = "vector"
)

// Mood specifies the mood/tone for search filtering.
// Values: black_and_white, bold, cool, dramatic, natural, vivid, warm
type Mood string

const (
	MoodBlackAndWhite Mood = "black_and_white"
	MoodBold          Mood = "bold"
	MoodCool          Mood = "cool"
	MoodDramatic      Mood = "dramatic"
	MoodNatural       Mood = "natural"
	MoodVivid         Mood = "vivid"
	MoodWarm          Mood = "warm"
)

// NumberOfPeople specifies the number of people in images for search filtering.
// Values: none, one, two, group
type NumberOfPeople string

const (
	NumberOfPeopleNone  NumberOfPeople = "none"
	NumberOfPeopleOne   NumberOfPeople = "one"
	NumberOfPeopleTwo   NumberOfPeople = "two"
	NumberOfPeopleGroup NumberOfPeople = "group"
)

// Ethnicity specifies ethnicity for search filtering.
// Values: black, white, east_asian, hispanic_latinx, japanese, middle_eastern,
// multiracial_person, multiethnic_group, native_american_first_nations,
// pacific_islander, south_asian, southeast_asian
type Ethnicity string

const (
	EthnicityBlack                      Ethnicity = "black"
	EthnicityWhite                      Ethnicity = "white"
	EthnicityEastAsian                  Ethnicity = "east_asian"
	EthnicityHispanicLatinx             Ethnicity = "hispanic_latinx"
	EthnicityJapanese                   Ethnicity = "japanese"
	EthnicityMiddleEastern              Ethnicity = "middle_eastern"
	EthnicityMultiracialPerson          Ethnicity = "multiracial_person"
	EthnicityMultiethnicGroup           Ethnicity = "multiethnic_group"
	EthnicityNativeAmericanFirstNations Ethnicity = "native_american_first_nations"
	EthnicityPacificIslander            Ethnicity = "pacific_islander"
	EthnicitySouthAsian                 Ethnicity = "south_asian"
	EthnicitySoutheastAsian             Ethnicity = "southeast_asian"
)

// AgeOfPeople specifies age categories and ranges for search filtering.
// Includes both categorical values (newborn, baby, child, teenager, etc.)
// and specific age ranges (0-1_months, 2-5_months, 2-3_years, 20-24_years, etc.)
type AgeOfPeople string

// AgeOfPeople categorical values.
const (
	AgeOfPeopleNewborn     AgeOfPeople = "newborn"
	AgeOfPeopleBaby        AgeOfPeople = "baby"
	AgeOfPeopleChild       AgeOfPeople = "child"
	AgeOfPeopleTeenager    AgeOfPeople = "teenager"
	AgeOfPeopleYoungAdult  AgeOfPeople = "young_adult"
	AgeOfPeopleAdult       AgeOfPeople = "adult"
	AgeOfPeopleAdultsOnly  AgeOfPeople = "adults_only"
	AgeOfPeopleMatureAdult AgeOfPeople = "mature_adult"
	AgeOfPeopleSeniorAdult AgeOfPeople = "senior_adult"
)

// AgeOfPeople range values (months for infants).
const (
	AgeOfPeople0To1Months   AgeOfPeople = "0-1_months"
	AgeOfPeople2To5Months   AgeOfPeople = "2-5_months"
	AgeOfPeople6To11Months  AgeOfPeople = "6-11_months"
	AgeOfPeople12To17Months AgeOfPeople = "12-17_months"
	AgeOfPeople18To23Months AgeOfPeople = "18-23_months"
)

// AgeOfPeople range values (years for children and adults).
const (
	AgeOfPeople2To3Years       AgeOfPeople = "2-3_years"
	AgeOfPeople4To5Years       AgeOfPeople = "4-5_years"
	AgeOfPeople6To7Years       AgeOfPeople = "6-7_years"
	AgeOfPeople8To9Years       AgeOfPeople = "8-9_years"
	AgeOfPeople10To11Years     AgeOfPeople = "10-11_years"
	AgeOfPeople12To13Years     AgeOfPeople = "12-13_years"
	AgeOfPeople14To15Years     AgeOfPeople = "14-15_years"
	AgeOfPeople16To17Years     AgeOfPeople = "16-17_years"
	AgeOfPeople18To19Years     AgeOfPeople = "18-19_years"
	AgeOfPeople20To24Years     AgeOfPeople = "20-24_years"
	AgeOfPeople25To29Years     AgeOfPeople = "25-29_years"
	AgeOfPeople30To34Years     AgeOfPeople = "30-34_years"
	AgeOfPeople35To39Years     AgeOfPeople = "35-39_years"
	AgeOfPeople40To44Years     AgeOfPeople = "40-44_years"
	AgeOfPeople45To49Years     AgeOfPeople = "45-49_years"
	AgeOfPeople50To54Years     AgeOfPeople = "50-54_years"
	AgeOfPeople55To59Years     AgeOfPeople = "55-59_years"
	AgeOfPeople60To64Years     AgeOfPeople = "60-64_years"
	AgeOfPeople65To69Years     AgeOfPeople = "65-69_years"
	AgeOfPeople70To74Years     AgeOfPeople = "70-74_years"
	AgeOfPeople75To79Years     AgeOfPeople = "75-79_years"
	AgeOfPeople80To84Years     AgeOfPeople = "80-84_years"
	AgeOfPeople85To89Years     AgeOfPeople = "85-89_years"
	AgeOfPeople90To94Years     AgeOfPeople = "90-94_years"
	AgeOfPeople95To99Years     AgeOfPeople = "95-99_years"
	AgeOfPeople100YearsAndOver AgeOfPeople = "100_years_and_over"
)

// SortOrder specifies the sort order for search results.
// Values: best_match, most_popular, newest, random
type SortOrder string

const (
	SortOrderBestMatch   SortOrder = "best_match"
	SortOrderMostPopular SortOrder = "most_popular"
	SortOrderNewest      SortOrder = "newest"
	SortOrderRandom      SortOrder = "random"
)

// MinimumSize specifies the minimum image size for search filtering.
// Values: x_small, small, medium, large, x_large, xx_large, vector
type MinimumSize string

const (
	MinimumSizeXSmall  MinimumSize = "x_small"
	MinimumSizeSmall   MinimumSize = "small"
	MinimumSizeMedium  MinimumSize = "medium"
	MinimumSizeLarge   MinimumSize = "large"
	MinimumSizeXLarge  MinimumSize = "x_large"
	MinimumSizeXXLarge MinimumSize = "xx_large"
	MinimumSizeVector  MinimumSize = "vector"
)

// FileType specifies the file type for search filtering.
// Values: jpg, eps
type FileType string

const (
	FileTypeJPG FileType = "jpg"
	FileTypeEPS FileType = "eps"
)

// FilterType specifies whether to include or exclude values in a filter.
// Values: include, exclude
type FilterType string

const (
	FilterTypeInclude FilterType = "include"
	FilterTypeExclude FilterType = "exclude"
)

// FacetField specifies fields available for faceted search.
// Values: artists, locations
type FacetField string

const (
	FacetFieldArtists   FacetField = "artists"
	FacetFieldLocations FacetField = "locations"
)

// Field specifies response fields that can be requested.
// These control which fields are included in the API response.
type Field string

// Field constants for core identification fields.
const (
	FieldID             Field = "id"
	FieldTitle          Field = "title"
	FieldCaption        Field = "caption"
	FieldAssetFamily    Field = "asset_family"
	FieldAssetType      Field = "asset_type"
	FieldCollectionCode Field = "collection_code"
	FieldCollectionID   Field = "collection_id"
	FieldCollectionName Field = "collection_name"
	FieldLicenseModel   Field = "license_model"
)

// Field constants for media information.
const (
	FieldDisplaySet     Field = "display_set"
	FieldDisplaySizes   Field = "display_sizes"
	FieldDownloadSizes  Field = "download_sizes"
	FieldMaxDimensions  Field = "max_dimensions"
	FieldOrientation    Field = "orientation"
	FieldGraphicalStyle Field = "graphical_style"
	FieldComposition    Field = "composition"
)

// Field constants for creator and rights.
const (
	FieldArtist      Field = "artist"
	FieldArtistTitle Field = "artist_title"
	FieldCopyright   Field = "copyright"
	FieldCreditLine  Field = "credit_line"
)

// Field constants for content metadata.
const (
	FieldKeywords       Field = "keywords"
	FieldDateCreated    Field = "date_created"
	FieldDateSubmitted  Field = "date_submitted"
	FieldDateCameraShot Field = "date_camera_shot"
)

// Field constants for location and context.
const (
	FieldCity          Field = "city"
	FieldCountry       Field = "country"
	FieldStateProvince Field = "state_province"
	FieldLocation      Field = "location"
)

// Field constants for people metadata.
const (
	FieldPeopleCategories Field = "people_categories"
	FieldNumberOfPeople   Field = "number_of_people"
	FieldAgeOfPeople      Field = "age_of_people"
	FieldEthnicity        Field = "ethnicity"
)

// Field constants for usage and availability.
const (
	FieldEditorialSource      Field = "editorial_source"
	FieldQualityRank          Field = "quality_rank"
	FieldReferralDestinations Field = "referral_destinations"
	FieldIsTrunkImage         Field = "is_trunk_image"
	FieldProductTypes         Field = "product_types"
	FieldURIBing              Field = "uri_bing"
)

// Market specifies the locale/market for search requests.
// This affects language of results and regional availability.
type Market string

// Market constants for Americas.
const (
	MarketEnUS Market = "en-US"
	MarketEnCA Market = "en-CA"
	MarketFrCA Market = "fr-CA"
	MarketEsMX Market = "es-MX"
	MarketEsAR Market = "es-AR"
	MarketPtBR Market = "pt-BR"
	MarketEsCL Market = "es-CL"
	MarketEsCO Market = "es-CO"
)

// Market constants for Europe - Western.
const (
	MarketEnGB Market = "en-GB"
	MarketEnIE Market = "en-IE"
	MarketDeDE Market = "de-DE"
	MarketDeAT Market = "de-AT"
	MarketDeCH Market = "de-CH"
	MarketFrFR Market = "fr-FR"
	MarketFrBE Market = "fr-BE"
	MarketFrCH Market = "fr-CH"
	MarketNlNL Market = "nl-NL"
	MarketNlBE Market = "nl-BE"
)

// Market constants for Europe - Southern.
const (
	MarketItIT Market = "it-IT"
	MarketItCH Market = "it-CH"
	MarketEsES Market = "es-ES"
	MarketPtPT Market = "pt-PT"
	MarketElGR Market = "el-GR"
)

// Market constants for Europe - Northern.
const (
	MarketSvSE Market = "sv-SE"
	MarketNbNO Market = "nb-NO"
	MarketDaDK Market = "da-DK"
	MarketFiFI Market = "fi-FI"
)

// Market constants for Europe - Eastern.
const (
	MarketPlPL Market = "pl-PL"
	MarketCsCZ Market = "cs-CZ"
	MarketHuHU Market = "hu-HU"
	MarketRoRO Market = "ro-RO"
	MarketRuRU Market = "ru-RU"
	MarketUkUA Market = "uk-UA"
	MarketTrTR Market = "tr-TR"
)

// Market constants for Asia Pacific.
const (
	MarketJaJP Market = "ja-JP"
	MarketKoKR Market = "ko-KR"
	MarketZhCN Market = "zh-CN"
	MarketZhTW Market = "zh-TW"
	MarketZhHK Market = "zh-HK"
	MarketEnAU Market = "en-AU"
	MarketEnNZ Market = "en-NZ"
	MarketEnSG Market = "en-SG"
	MarketEnHK Market = "en-HK"
	MarketEnIN Market = "en-IN"
	MarketThTH Market = "th-TH"
	MarketIDID Market = "id-ID"
	MarketViVN Market = "vi-VN"
	MarketMsMY Market = "ms-MY"
)

// Market constants for Middle East and Africa.
const (
	MarketArAE Market = "ar-AE"
	MarketHeIL Market = "he-IL"
	MarketEnZA Market = "en-ZA"
)

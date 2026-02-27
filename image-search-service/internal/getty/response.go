// Package getty provides types and client for interacting with Getty Images API.
package getty

// Dimensions represents image dimensions.
type Dimensions struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// DisplaySize represents a display size variant of an image.
type DisplaySize struct {
	Name          string `json:"name"`
	URI           string `json:"uri"`
	IsWatermarked bool   `json:"is_watermarked"`
}

// Keyword represents a keyword associated with an image.
type Keyword struct {
	KeywordID string `json:"keyword_id"`
	Text      string `json:"text"`
	Type      string `json:"type,omitempty"`
	Relevance int    `json:"relevance,omitempty"`
}

// AllowedUse represents usage permissions for an image.
type AllowedUse struct {
	HowCanIUseIt      string   `json:"how_can_i_use_it,omitempty"`
	ReleaseInfo       string   `json:"release_info,omitempty"`
	UsageRestrictions []string `json:"usage_restrictions,omitempty"`
}

// ProductType represents a product type for an image.
type ProductType struct {
	Name string `json:"name"`
	ID   string `json:"id"`
}

// DownloadSize represents available download size information.
type DownloadSize struct {
	Bytes     int    `json:"bytes,omitempty"`
	Height    int    `json:"height,omitempty"`
	Width     int    `json:"width,omitempty"`
	DPI       int    `json:"dpi,omitempty"`
	MediaType string `json:"media_type,omitempty"`
	Name      string `json:"name,omitempty"`
}

// AltID represents an alternative identifier for an image.
type AltID struct {
	Source string `json:"source"`
	ID     string `json:"id"`
}

// RefDest represents a referral destination.
type RefDest struct {
	SiteName string `json:"site_name"`
	URI      string `json:"uri"`
}

// Download represents download information.
type Download struct {
	ProductID   string `json:"product_id,omitempty"`
	ProductType string `json:"product_type,omitempty"`
	URI         string `json:"uri,omitempty"`
}

// ImageResult represents a single image result from Getty Images API.
// Contains all 36 fields that may be returned by the search endpoint.
type ImageResult struct {
	// Core fields
	ID        string `json:"id"`
	Title     string `json:"title,omitempty"`
	URI       string `json:"uri,omitempty"`
	Caption   string `json:"caption,omitempty"`
	Copyright string `json:"copyright,omitempty"`

	// Dimensions
	MaxDimensions *Dimensions   `json:"max_dimensions,omitempty"`
	DisplaySizes  []DisplaySize `json:"display_sizes,omitempty"`
	Orientation   string        `json:"orientation,omitempty"`

	// Classification
	AssetFamily    string `json:"asset_family,omitempty"`
	GraphicalStyle string `json:"graphical_style,omitempty"`
	ColorType      string `json:"color_type,omitempty"`

	// Licensing
	LicenseModel    string         `json:"license_model,omitempty"`
	AllowedUse      *AllowedUse    `json:"allowed_use,omitempty"`
	ProductTypes    []ProductType  `json:"product_types,omitempty"`
	DownloadSizes   []DownloadSize `json:"download_sizes,omitempty"`
	DownloadProduct string         `json:"download_product,omitempty"`

	// Collection
	CollectionID     int    `json:"collection_id,omitempty"`
	CollectionCode   string `json:"collection_code,omitempty"`
	CollectionName   string `json:"collection_name,omitempty"`
	IStockCollection string `json:"istock_collection,omitempty"`

	// Creator and dates
	Artist         string `json:"artist,omitempty"`
	DateCreated    string `json:"date_created,omitempty"`
	DateSubmitted  string `json:"date_submitted,omitempty"`
	DateCameraShot string `json:"date_camera_shot,omitempty"`

	// People & Demographics
	NumberOfPeople string   `json:"number_of_people,omitempty"`
	Ethnicity      []string `json:"ethnicity,omitempty"`
	AgeOfPeople    []string `json:"age_of_people,omitempty"`

	// Metadata
	Keywords       []Keyword `json:"keywords,omitempty"`
	AlternativeIDs []AltID   `json:"alternative_ids,omitempty"`
	QualityRank    int       `json:"quality_rank,omitempty"`

	// Download
	CallForImage         bool       `json:"call_for_image,omitempty"`
	ReferralDestinations []RefDest  `json:"referral_destinations,omitempty"`
	LargestDownloads     []Download `json:"largest_downloads,omitempty"`
}

// GettyID returns the Getty image ID (backward compatibility helper).
func (i *ImageResult) GettyID() string {
	return i.ID
}

// Thumbnail returns the thumbnail URI from display sizes.
func (i *ImageResult) Thumbnail() string {
	for _, ds := range i.DisplaySizes {
		if ds.Name == "thumb" {
			return ds.URI
		}
	}
	return ""
}

// Preview returns the preview URI from display sizes, falling back to comp if preview not available.
func (i *ImageResult) Preview() string {
	var compURI string
	for _, ds := range i.DisplaySizes {
		if ds.Name == "preview" {
			return ds.URI
		}
		if ds.Name == "comp" {
			compURI = ds.URI
		}
	}
	return compURI
}

// Width returns the maximum width of the image.
func (i *ImageResult) Width() int {
	if i.MaxDimensions != nil {
		return i.MaxDimensions.Width
	}
	return 0
}

// Height returns the maximum height of the image.
func (i *ImageResult) Height() int {
	if i.MaxDimensions != nil {
		return i.MaxDimensions.Height
	}
	return 0
}

// RelatedSearch represents a related search suggestion.
type RelatedSearch struct {
	Text string `json:"text"`
}

// FacetEntry represents a single facet entry with count.
type FacetEntry struct {
	Text  string `json:"text"`
	Count int    `json:"count"`
}

// Facet represents a search facet with entries.
type Facet struct {
	Name    string       `json:"name"`
	Entries []FacetEntry `json:"entries,omitempty"`
}

// SearchResponse represents the response from Getty Images search endpoint.
type SearchResponse struct {
	ResultCount     int             `json:"result_count"`
	Images          []ImageResult   `json:"images,omitempty"`
	RelatedSearches []RelatedSearch `json:"related_searches,omitempty"`
	Facets          []Facet         `json:"facets,omitempty"`
}

// SearchResult is an alias for ImageResult for backward compatibility.
// Existing code using getty.SearchResult will continue to work.
type SearchResult = ImageResult

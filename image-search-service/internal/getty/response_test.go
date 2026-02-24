// internal/getty/response_test.go
package getty

import (
	"encoding/json"
	"testing"
)

func TestImageResultUnmarshal(t *testing.T) {
	jsonData := `{
		"id": "12345",
		"title": "Business Meeting",
		"caption": "People in a meeting",
		"max_dimensions": {"width": 5000, "height": 3000},
		"display_sizes": [
			{"name": "thumb", "uri": "http://example.com/thumb.jpg", "is_watermarked": false},
			{"name": "preview", "uri": "http://example.com/preview.jpg", "is_watermarked": true}
		],
		"orientation": "horizontal",
		"graphical_style": "photography",
		"artist": "John Doe",
		"keywords": [
			{"keyword_id": "123", "text": "business", "relevance": 100},
			{"keyword_id": "456", "text": "meeting", "relevance": 95}
		]
	}`

	var img ImageResult
	err := json.Unmarshal([]byte(jsonData), &img)
	if err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if img.ID != "12345" {
		t.Errorf("ID = %q, want %q", img.ID, "12345")
	}
	if img.Title != "Business Meeting" {
		t.Errorf("Title = %q, want %q", img.Title, "Business Meeting")
	}
	if img.MaxDimensions == nil || img.MaxDimensions.Width != 5000 {
		t.Errorf("MaxDimensions.Width = %v, want 5000", img.MaxDimensions)
	}
	if len(img.DisplaySizes) != 2 {
		t.Errorf("DisplaySizes length = %d, want 2", len(img.DisplaySizes))
	}
	if img.Orientation != "horizontal" {
		t.Errorf("Orientation = %q, want %q", img.Orientation, "horizontal")
	}
	if img.GraphicalStyle != "photography" {
		t.Errorf("GraphicalStyle = %q, want %q", img.GraphicalStyle, "photography")
	}
	if len(img.Keywords) != 2 {
		t.Errorf("Keywords length = %d, want 2", len(img.Keywords))
	}
	if img.Keywords[0].Text != "business" {
		t.Errorf("Keywords[0].Text = %q, want %q", img.Keywords[0].Text, "business")
	}
}

func TestSearchResponseUnmarshal(t *testing.T) {
	jsonData := `{
		"result_count": 100,
		"images": [
			{"id": "1", "title": "Image 1"},
			{"id": "2", "title": "Image 2"}
		]
	}`

	var resp SearchResponse
	err := json.Unmarshal([]byte(jsonData), &resp)
	if err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if resp.ResultCount != 100 {
		t.Errorf("ResultCount = %d, want 100", resp.ResultCount)
	}
	if len(resp.Images) != 2 {
		t.Errorf("Images length = %d, want 2", len(resp.Images))
	}
}

func TestImageResultHelpers(t *testing.T) {
	img := ImageResult{
		ID: "12345",
		DisplaySizes: []DisplaySize{
			{Name: "thumb", URI: "http://example.com/thumb.jpg"},
			{Name: "preview", URI: "http://example.com/preview.jpg"},
			{Name: "comp", URI: "http://example.com/comp.jpg"},
		},
	}

	if img.GettyID() != "12345" {
		t.Errorf("GettyID() = %q, want %q", img.GettyID(), "12345")
	}
	if img.Thumbnail() != "http://example.com/thumb.jpg" {
		t.Errorf("Thumbnail() = %q, want %q", img.Thumbnail(), "http://example.com/thumb.jpg")
	}
	if img.Preview() != "http://example.com/preview.jpg" {
		t.Errorf("Preview() = %q, want %q", img.Preview(), "http://example.com/preview.jpg")
	}
}

func TestImageResultPreviewFallback(t *testing.T) {
	img := ImageResult{
		DisplaySizes: []DisplaySize{
			{Name: "thumb", URI: "http://example.com/thumb.jpg"},
			{Name: "comp", URI: "http://example.com/comp.jpg"},
		},
	}

	if img.Preview() != "http://example.com/comp.jpg" {
		t.Errorf("Preview() fallback = %q, want %q", img.Preview(), "http://example.com/comp.jpg")
	}
}

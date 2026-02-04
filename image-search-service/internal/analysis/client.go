package analysis

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/airo-ai-builder/image-search-service/internal/config"
	"github.com/airo-ai-builder/image-search-service/internal/ratelimit"
	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

// Model is the Claude model used for image analysis.
const Model = "claude-3-haiku-20240307"

// Image media type constants.
const (
	MediaTypeJPEG = "image/jpeg"
	MediaTypePNG  = "image/png"
	MediaTypeGIF  = "image/gif"
	MediaTypeWebP = "image/webp"
)

// Result represents the structured response from Claude Haiku analysis.
type Result struct {
	PrimarySubject    string   `json:"primarySubject"`
	SubjectCategory   string   `json:"subjectCategory"`
	Activity          string   `json:"activity"`
	SettingType       string   `json:"settingType"`
	TextSafeColors    string   `json:"textSafeColors"`
	BackgroundType    string   `json:"backgroundType"`
	Composition       string   `json:"composition"`
	CopySpaceLocation string   `json:"copySpaceLocation"`
	CopySpaceAmount   string   `json:"copySpaceAmount"`
	VisualComplexity  string   `json:"visualComplexity"`
	PeopleCount       string   `json:"peopleCount"`
	PeopleFocus       string   `json:"peopleFocus"`
	Tone              []string `json:"tone"`
	UsageContext      []string `json:"usageContext"`
	AuthenticityStyle string   `json:"authenticityStyle"`
	Description       string   `json:"description"`
	SearchTerms       []string `json:"searchTerms"`
}

// Client provides methods for analyzing images using Claude Haiku.
type Client struct {
	httpClient *http.Client
	apiURL     string
	apiKey     string
	limiter    *ratelimit.Limiter
}

// New creates a new analysis client with the provided configuration.
func New(cfg *config.Config) *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: 60 * time.Second, // Image analysis can take time
		},
		apiURL:  cfg.AnthropicAPIURL,
		apiKey:  cfg.AnthropicAPIKey,
		limiter: ratelimit.New(cfg.HaikuConcurrency, cfg.HaikuRateLimitRPS),
	}
}

// Analyze sends an image to Claude Haiku for analysis and returns structured metadata.
func (c *Client) Analyze(ctx context.Context, imageURL string) (*Result, error) {
	if err := c.limiter.Acquire(ctx); err != nil {
		return nil, fmt.Errorf("failed to acquire rate limit: %w", err)
	}
	defer c.limiter.Release()

	// Fetch and encode the image as base64 (GoCode proxy doesn't support URL sources)
	imageData, mediaType, err := c.fetchAndEncodeImage(ctx, imageURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch image: %w", err)
	}

	reqBody := buildAnalysisRequest(imageData, mediaType)
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL+"/v1/messages", bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Api-Key", c.apiKey)
	req.Header.Set("Anthropic-Version", "2023-06-01")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("anthropic API returned status %d: %s", resp.StatusCode, string(body))
	}

	return parseAPIResponse(body)
}

// fetchAndEncodeImage downloads an image and returns it as base64 with its media type.
func (c *Client) fetchAndEncodeImage(ctx context.Context, imageURL string) (string, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return "", "", fmt.Errorf("failed to create image request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("failed to fetch image: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("image fetch returned status %d", resp.StatusCode)
	}

	// Read the image data
	imageBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", fmt.Errorf("failed to read image data: %w", err)
	}

	// Detect media type from Content-Type header or infer from data
	mediaType := detectMediaType(resp.Header.Get("Content-Type"), imageBytes)

	// Encode as base64
	encoded := base64.StdEncoding.EncodeToString(imageBytes)

	slog.Debug("analysis.image.fetched", "url", imageURL, "mediaType", mediaType, "sizeBytes", len(imageBytes))

	return encoded, mediaType, nil
}

// detectMediaType determines the image media type from Content-Type header or magic bytes.
//
//nolint:gocyclo // complexity is inherent to media type detection with multiple format checks
func detectMediaType(contentType string, data []byte) string {
	// Try Content-Type header first
	if contentType != "" {
		// Normalize common content types
		contentType = strings.ToLower(strings.Split(contentType, ";")[0])
		switch contentType {
		case MediaTypeJPEG, "image/jpg":
			return MediaTypeJPEG
		case MediaTypePNG:
			return MediaTypePNG
		case MediaTypeGIF:
			return MediaTypeGIF
		case MediaTypeWebP:
			return MediaTypeWebP
		}
	}

	// Fall back to magic byte detection
	if len(data) >= 3 {
		// JPEG: starts with FF D8 FF
		if data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
			return MediaTypeJPEG
		}
		// PNG: starts with 89 50 4E 47
		if len(data) >= 4 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
			return MediaTypePNG
		}
		// GIF: starts with GIF
		if data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 {
			return MediaTypeGIF
		}
		// WebP: starts with RIFF....WEBP
		if len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
			return MediaTypeWebP
		}
	}

	// Default to JPEG as it's most common for stock photos
	return MediaTypeJPEG
}

// Stats returns the current rate limiter statistics.
// busy is the number of currently active requests.
// available is the number of slots available for new requests.
func (c *Client) Stats() (busy int, available int) {
	return c.limiter.Stats()
}

// ToImageAnalysis converts a Result to a models.ImageAnalysis.
// Note: This sets only the fields populated by Haiku analysis.
// Other fields (GettyID, Title, URLs, DominantColors, AspectRatioCategory, etc.)
// must be set separately by the caller.
func ToImageAnalysis(r *Result) *models.ImageAnalysis {
	return &models.ImageAnalysis{
		// Subject Focus
		PrimarySubject:  r.PrimarySubject,
		SubjectCategory: models.SubjectCategory(r.SubjectCategory),
		Activity:        models.Activity(r.Activity),
		SettingType:     models.SettingType(r.SettingType),

		// Color/Background
		TextSafeColors: models.TextSafeColors(r.TextSafeColors),
		BackgroundType: models.BackgroundType(r.BackgroundType),

		// Composition
		Composition:       models.Composition(r.Composition),
		CopySpaceLocation: models.CopySpaceLocation(r.CopySpaceLocation),
		CopySpaceAmount:   models.CopySpaceAmount(r.CopySpaceAmount),
		VisualComplexity:  models.VisualComplexity(r.VisualComplexity),

		// People
		PeopleCount: models.PeopleCount(r.PeopleCount),
		PeopleFocus: models.PeopleFocus(r.PeopleFocus),

		// Mood & Style
		Tone:              r.Tone,
		UsageContext:      r.UsageContext,
		AuthenticityStyle: models.AuthenticityStyle(r.AuthenticityStyle),

		// Content
		Description: r.Description,
		SearchTerms: r.SearchTerms,
	}
}

// anthropicRequest represents the Anthropic Messages API request format.
type anthropicRequest struct {
	Model     string         `json:"model"`
	MaxTokens int            `json:"max_tokens"`
	System    string         `json:"system"`
	Messages  []anthropicMsg `json:"messages"`
}

type anthropicMsg struct {
	Role    string           `json:"role"`
	Content []anthropicBlock `json:"content"`
}

type anthropicBlock struct {
	Type   string              `json:"type"`
	Text   string              `json:"text,omitempty"`
	Source *anthropicImgSource `json:"source,omitempty"`
}

type anthropicImgSource struct {
	Type      string `json:"type"`
	MediaType string `json:"media_type,omitempty"`
	Data      string `json:"data,omitempty"`
}

// anthropicResponse represents the Anthropic Messages API response format.
type anthropicResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

// buildAnalysisRequest constructs the Anthropic API request for image analysis.
// imageData is the base64-encoded image data, mediaType is the MIME type (e.g., "image/jpeg").
func buildAnalysisRequest(imageData, mediaType string) anthropicRequest {
	return anthropicRequest{
		Model:     Model,
		MaxTokens: 1024,
		System:    SystemPrompt,
		Messages: []anthropicMsg{
			{
				Role: "user",
				Content: []anthropicBlock{
					{
						Type: "image",
						Source: &anthropicImgSource{
							Type:      "base64",
							MediaType: mediaType,
							Data:      imageData,
						},
					},
					{
						Type: "text",
						Text: UserMessage,
					},
				},
			},
		},
	}
}

// parseAPIResponse extracts and parses the analysis result from the API response.
func parseAPIResponse(data []byte) (*Result, error) {
	var resp anthropicResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal API response: %w", err)
	}

	if len(resp.Content) == 0 {
		return nil, errors.New("empty response content from API")
	}

	// Find the text content block
	for _, block := range resp.Content {
		if block.Type == "text" {
			return parseAnalysisResponse([]byte(block.Text))
		}
	}

	return nil, errors.New("no text content in API response")
}

// parseAnalysisResponse parses the JSON analysis result, handling markdown code blocks.
func parseAnalysisResponse(data []byte) (*Result, error) {
	text := string(data)

	// Clean markdown code blocks if present
	text = cleanMarkdownCodeBlock(text)

	var result Result
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal analysis result: %w", err)
	}

	return &result, nil
}

// cleanMarkdownCodeBlock removes markdown code block wrapping from JSON.
func cleanMarkdownCodeBlock(text string) string {
	text = strings.TrimSpace(text)

	// Pattern to match ```json or ``` at start and ``` at end
	codeBlockRegex := regexp.MustCompile("^```(?:json)?\\s*\\n([\\s\\S]*?)\\n```$")
	matches := codeBlockRegex.FindStringSubmatch(text)
	if len(matches) == 2 {
		return strings.TrimSpace(matches[1])
	}

	return text
}

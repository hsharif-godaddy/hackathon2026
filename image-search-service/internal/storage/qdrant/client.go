// Package qdrant provides a client for interacting with Qdrant vector database
// for hybrid vector and metadata search of image analyses.
package qdrant

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/qdrant/go-client/qdrant"

	"github.com/airo-ai-builder/image-search-service/internal/config"
	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

// Client provides methods for storing and searching image analyses in Qdrant.
type Client struct {
	client     *qdrant.Client
	collection string
}

// New creates a new Qdrant client with the provided configuration.
func New(cfg *config.Config) (*Client, error) {
	qdrantConfig := &qdrant.Config{
		Host: cfg.QdrantHost,
		Port: cfg.QdrantPort,
	}

	if cfg.QdrantAPIKey != "" {
		qdrantConfig.APIKey = cfg.QdrantAPIKey
	}
	qdrantConfig.UseTLS = cfg.QdrantUseTLS
	if cfg.QdrantUseTLS && cfg.QdrantTLSSkipVerify {
		qdrantConfig.TLSConfig = &tls.Config{
			InsecureSkipVerify: true, //nolint:gosec // Self-signed certs in internal network
		}
	}

	client, err := qdrant.NewClient(qdrantConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create qdrant client: %w", err)
	}

	return &Client{
		client:     client,
		collection: cfg.QdrantCollection,
	}, nil
}

// Close closes the Qdrant client connection.
func (c *Client) Close() error {
	return c.client.Close()
}

// EnsureCollection creates the collection if it doesn't exist.
// Uses 1536 dimensions for text-embedding-3-small and cosine distance.
func (c *Client) EnsureCollection(ctx context.Context) error {
	// Check if collection exists
	exists, err := c.client.CollectionExists(ctx, c.collection)
	if err != nil {
		return fmt.Errorf("failed to check collection existence: %w", err)
	}

	if exists {
		// Log collection info
		info, infoErr := c.client.GetCollectionInfo(ctx, c.collection)
		if infoErr != nil {
			slog.Warn("qdrant.collection.info.failed", "error", infoErr)
		} else {
			slog.Debug("qdrant.collection.exists",
				"collection", c.collection,
				"pointsCount", info.PointsCount,
				"status", info.Status.String())
		}
		return nil
	}

	// Create collection with vector config for text-embedding-3-small (1536 dimensions)
	err = c.client.CreateCollection(ctx, &qdrant.CreateCollection{
		CollectionName: c.collection,
		VectorsConfig: qdrant.NewVectorsConfig(&qdrant.VectorParams{
			Size:     1536,
			Distance: qdrant.Distance_Cosine,
		}),
	})
	if err != nil {
		// Handle race condition: another task may have created the collection concurrently
		if strings.Contains(err.Error(), "already exists") {
			slog.Info("qdrant.collection.already.exists", "collection", c.collection)
			return nil
		}
		return fmt.Errorf("failed to create collection: %w", err)
	}

	// Create payload indexes for filterable fields
	indexFields := []string{
		"aspectRatioCategory",
		"subjectCategory",
		"peopleCount",
		"peopleFocus",
		"tone",
		"moods",
		"copySpaceAmount",
		"copySpaceLocation",
		"colorMood",
		"composition",
		"usageContext",
		"backgroundType",
		"visualComplexity",
		// Getty metadata indexes
		"orientation",
		"graphicalStyle",
		"numberOfPeople",
		"ethnicity",
		"ageOfPeople",
	}

	for _, field := range indexFields {
		_, err = c.client.CreateFieldIndex(ctx, &qdrant.CreateFieldIndexCollection{
			CollectionName: c.collection,
			FieldName:      field,
			FieldType:      qdrant.PtrOf(qdrant.FieldType_FieldTypeKeyword),
		})
		if err != nil {
			// Log but don't fail - indexes are optimization, not required
			slog.Warn("qdrant.index.create.failed", "field", field, "error", err)
		}
	}

	return nil
}

// Search performs a vector similarity search with optional metadata filters.
// minScore filters out results below the given relevance threshold (0-1).
func (c *Client) Search(
	ctx context.Context,
	embedding []float32,
	filters models.SearchFilters,
	limit int,
	minScore float32,
) ([]*models.ImageAnalysis, error) {
	if limit <= 0 {
		limit = 10
	}

	// Ensure limit is non-negative before conversion to uint64
	queryRequest := &qdrant.QueryPoints{
		CollectionName: c.collection,
		Query:          qdrant.NewQueryDense(embedding),
		Limit:          qdrant.PtrOf(uint64(limit)), //nolint:gosec // limit is validated above
		WithPayload:    qdrant.NewWithPayload(true),
	}

	if minScore > 0 {
		queryRequest.ScoreThreshold = qdrant.PtrOf(minScore)
	}

	filter := buildFilters(filters)
	if filter != nil {
		queryRequest.Filter = filter
	}

	results, err := c.client.Query(ctx, queryRequest)
	if err != nil {
		return nil, fmt.Errorf("failed to search qdrant: %w", err)
	}

	analyses := make([]*models.ImageAnalysis, 0, len(results))
	for _, point := range results {
		analysis := payloadToAnalysis(point.Payload, point.Score)
		if analysis != nil {
			analyses = append(analyses, analysis)
		}
	}

	return analyses, nil
}

// GetByIDs retrieves image analyses by their Getty IDs.
func (c *Client) GetByIDs(ctx context.Context, gettyIDs []string) (map[string]*models.ImageAnalysis, error) {
	if len(gettyIDs) == 0 {
		return make(map[string]*models.ImageAnalysis), nil
	}

	pointIDs := make([]*qdrant.PointId, 0, len(gettyIDs))
	numericIDs := make([]uint64, 0, len(gettyIDs))
	for _, id := range gettyIDs {
		numID, err := gettyIDToPointID(id)
		if err != nil {
			slog.Debug("qdrant.getbyids.skip.invalid", "gettyId", id, "error", err)
			continue
		}
		pointIDs = append(pointIDs, qdrant.NewIDNum(numID))
		numericIDs = append(numericIDs, numID)
	}

	if len(pointIDs) == 0 {
		return make(map[string]*models.ImageAnalysis), nil
	}

	sampleCount := 3
	if len(numericIDs) < sampleCount {
		sampleCount = len(numericIDs)
	}
	slog.Debug("qdrant.getbyids.request", "collection", c.collection, "count", len(pointIDs), "sampleIds", numericIDs[:sampleCount])

	points, err := c.client.Get(ctx, &qdrant.GetPoints{
		CollectionName: c.collection,
		Ids:            pointIDs,
		WithPayload:    qdrant.NewWithPayload(true),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get points from qdrant: %w", err)
	}

	slog.Debug("qdrant.getbyids.response", "requested", len(pointIDs), "found", len(points))

	result := make(map[string]*models.ImageAnalysis, len(points))
	for _, point := range points {
		analysis := payloadToAnalysis(point.Payload, 0)
		if analysis != nil {
			result[analysis.GettyID] = analysis
		}
	}

	return result, nil
}

// ExpectedEmbeddingDimension is the expected dimension for embeddings (text-embedding-3-small).
const ExpectedEmbeddingDimension = 1536

// Upsert inserts or updates an image analysis in Qdrant.
func (c *Client) Upsert(ctx context.Context, analysis *models.ImageAnalysis) error {
	if analysis == nil {
		return errors.New("analysis cannot be nil")
	}

	if len(analysis.Embedding) == 0 {
		return errors.New("analysis must have an embedding")
	}

	if len(analysis.Embedding) != ExpectedEmbeddingDimension {
		return fmt.Errorf("embedding dimension mismatch: got %d, expected %d", len(analysis.Embedding), ExpectedEmbeddingDimension)
	}

	pointID, err := gettyIDToPointID(analysis.GettyID)
	if err != nil {
		return fmt.Errorf("invalid Getty ID %q: %w", analysis.GettyID, err)
	}

	payload := analysisToPayload(analysis)

	slog.Debug("qdrant.upsert.request", "collection", c.collection, "gettyId", analysis.GettyID, "pointId", pointID, "embeddingLen", len(analysis.Embedding))

	_, err = c.client.Upsert(ctx, &qdrant.UpsertPoints{
		CollectionName: c.collection,
		Points: []*qdrant.PointStruct{
			{
				Id:      qdrant.NewIDNum(pointID),
				Vectors: qdrant.NewVectorsDense(analysis.Embedding),
				Payload: payload,
			},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to upsert point to qdrant: %w", err)
	}

	slog.Debug("qdrant.upsert.success", "gettyId", analysis.GettyID, "pointId", pointID)

	return nil
}

// gettyIDToPointID converts a Getty ID string to a numeric point ID.
// Getty IDs are numeric strings, so we parse them directly as uint64.
func gettyIDToPointID(gettyID string) (uint64, error) {
	return strconv.ParseUint(gettyID, 10, 64)
}

// filterMapping maps a Qdrant field name to the filter values for that field.
type filterMapping struct {
	field  string
	values []string
}

// buildFilters converts SearchFilters to a Qdrant filter.
func buildFilters(filters models.SearchFilters) *qdrant.Filter {
	// Composition: merge Getty-native Compositions and analysis-enriched Composition
	// since both map to the same Qdrant "composition" field.
	compositionValues := append([]string{}, filters.Composition...)
	compositionValues = append(compositionValues, filters.Compositions...)

	mappings := []filterMapping{
		{"orientation", filters.Orientations},
		{"subjectCategory", filters.SubjectCategory},
		{"peopleCount", filters.PeopleCount},
		{"peopleFocus", filters.PeopleFocus},
		{"tone", filters.Tone},
		{"copySpaceAmount", filters.CopySpaceAmount},
		{"copySpaceLocation", filters.CopySpaceLocation},
		{"colorMood", filters.ColorMood},
		{"composition", compositionValues},
		{"usageContext", filters.UsageContext},
		{"backgroundType", filters.BackgroundType},
		{"visualComplexity", filters.VisualComplexity},
		// Getty metadata filters
		{"moods", filters.Moods},
		{"graphicalStyle", filters.GraphicalStyles},
		{"numberOfPeople", filters.NumberOfPeople},
		{"ethnicity", filters.Ethnicity},
		{"ageOfPeople", filters.AgeOfPeople},
	}

	var conditions []*qdrant.Condition
	for _, m := range mappings {
		if len(m.values) > 0 {
			conditions = append(conditions, qdrant.NewMatchKeywords(m.field, m.values...))
		}
	}

	if len(conditions) == 0 {
		return nil
	}

	return &qdrant.Filter{
		Must: conditions,
	}
}

// analysisToPayload converts an ImageAnalysis to a Qdrant payload map.
func analysisToPayload(a *models.ImageAnalysis) map[string]*qdrant.Value {
	payload := map[string]any{
		"gettyId":             a.GettyID,
		"title":               a.Title,
		"caption":             a.Caption,
		"width":               a.Dimensions.Width,
		"height":              a.Dimensions.Height,
		"thumbnailUrl":        a.URLs.Thumbnail,
		"previewUrl":          a.URLs.Preview,
		"highResUrl":          a.URLs.HighRes,
		"primarySubject":      a.PrimarySubject,
		"subjectCategory":     string(a.SubjectCategory),
		"activity":            string(a.Activity),
		"settingType":         string(a.SettingType),
		"dominantColors":      toInterfaceSlice(a.DominantColors),
		"colorMood":           string(a.ColorMood),
		"textSafeColors":      string(a.TextSafeColors),
		"backgroundType":      string(a.BackgroundType),
		"composition":         string(a.Composition),
		"copySpaceLocation":   string(a.CopySpaceLocation),
		"copySpaceAmount":     string(a.CopySpaceAmount),
		"visualComplexity":    string(a.VisualComplexity),
		"peopleCount":         string(a.PeopleCount),
		"peopleFocus":         string(a.PeopleFocus),
		"tone":                toInterfaceSlice(a.Tone),
		"usageContext":        toInterfaceSlice(a.UsageContext),
		"authenticityStyle":   string(a.AuthenticityStyle),
		"orientation":         a.Orientation,
		"graphicalStyle":      a.GraphicalStyle,
		"moods":               toInterfaceSlice(a.Moods),
		"numberOfPeople":      a.NumberOfPeople,
		"ethnicity":           toInterfaceSlice(a.Ethnicity),
		"ageOfPeople":         toInterfaceSlice(a.AgeOfPeople),
		"collectionCode":      a.CollectionCode,
		"artist":              a.Artist,
		"gettyKeywords":       toInterfaceSlice(a.GettyKeywords),
		"aspectRatioCategory": string(a.AspectRatioCategory),
		"description":         a.Description,
		"searchTerms":         toInterfaceSlice(a.SearchTerms),
		"analyzedAt":          a.AnalyzedAt.Format(time.RFC3339),
		"analysisVersion":     a.AnalysisVersion,
	}

	return qdrant.NewValueMap(payload)
}

// payloadToAnalysis converts a Qdrant payload to an ImageAnalysis.
func payloadToAnalysis(payload map[string]*qdrant.Value, score float32) *models.ImageAnalysis {
	if payload == nil {
		return nil
	}

	analysis := &models.ImageAnalysis{}

	// Core identification
	analysis.GettyID = getStringValue(payload, "gettyId")
	analysis.Title = getStringValue(payload, "title")
	analysis.Caption = getStringValue(payload, "caption")
	analysis.Dimensions = models.ImageDimensions{
		Width:  getIntValue(payload, "width"),
		Height: getIntValue(payload, "height"),
	}
	analysis.URLs = models.ImageURLs{
		Thumbnail: getStringValue(payload, "thumbnailUrl"),
		Preview:   getStringValue(payload, "previewUrl"),
		HighRes:   getStringValue(payload, "highResUrl"),
	}

	// Subject Focus
	analysis.PrimarySubject = getStringValue(payload, "primarySubject")
	analysis.SubjectCategory = models.SubjectCategory(getStringValue(payload, "subjectCategory"))
	analysis.Activity = models.Activity(getStringValue(payload, "activity"))
	analysis.SettingType = models.SettingType(getStringValue(payload, "settingType"))

	// Color
	analysis.DominantColors = getStringSlice(payload, "dominantColors")
	analysis.ColorMood = models.ColorMood(getStringValue(payload, "colorMood"))
	analysis.TextSafeColors = models.TextSafeColors(getStringValue(payload, "textSafeColors"))
	analysis.BackgroundType = models.BackgroundType(getStringValue(payload, "backgroundType"))

	// Composition
	analysis.Composition = models.Composition(getStringValue(payload, "composition"))
	analysis.CopySpaceLocation = models.CopySpaceLocation(getStringValue(payload, "copySpaceLocation"))
	analysis.CopySpaceAmount = models.CopySpaceAmount(getStringValue(payload, "copySpaceAmount"))
	analysis.VisualComplexity = models.VisualComplexity(getStringValue(payload, "visualComplexity"))

	// People
	analysis.PeopleCount = models.PeopleCount(getStringValue(payload, "peopleCount"))
	analysis.PeopleFocus = models.PeopleFocus(getStringValue(payload, "peopleFocus"))

	// Mood & Style
	analysis.Tone = getStringSlice(payload, "tone")
	analysis.UsageContext = getStringSlice(payload, "usageContext")
	analysis.AuthenticityStyle = models.AuthenticityStyle(getStringValue(payload, "authenticityStyle"))

	// Getty metadata
	analysis.Orientation = getStringValue(payload, "orientation")
	analysis.GraphicalStyle = getStringValue(payload, "graphicalStyle")
	analysis.Moods = getStringSlice(payload, "moods")
	analysis.NumberOfPeople = getStringValue(payload, "numberOfPeople")
	analysis.Ethnicity = getStringSlice(payload, "ethnicity")
	analysis.AgeOfPeople = getStringSlice(payload, "ageOfPeople")
	analysis.CollectionCode = getStringValue(payload, "collectionCode")
	analysis.Artist = getStringValue(payload, "artist")
	analysis.GettyKeywords = getStringSlice(payload, "gettyKeywords")

	// Programmatic
	analysis.AspectRatioCategory = models.AspectRatioCategory(getStringValue(payload, "aspectRatioCategory"))

	// Content
	analysis.Description = getStringValue(payload, "description")
	analysis.SearchTerms = getStringSlice(payload, "searchTerms")

	// Metadata
	if analyzedAtStr := getStringValue(payload, "analyzedAt"); analyzedAtStr != "" {
		if t, err := time.Parse(time.RFC3339, analyzedAtStr); err == nil {
			analysis.AnalyzedAt = t
		}
	}
	analysis.AnalysisVersion = getStringValue(payload, "analysisVersion")

	// Relevance score from Qdrant similarity search
	analysis.RelevanceScore = score

	return analysis
}

// Helper functions for extracting values from Qdrant payload

func getStringValue(payload map[string]*qdrant.Value, key string) string {
	if v, ok := payload[key]; ok {
		if sv, ok := v.Kind.(*qdrant.Value_StringValue); ok {
			return sv.StringValue
		}
	}
	return ""
}

func getIntValue(payload map[string]*qdrant.Value, key string) int {
	if v, ok := payload[key]; ok {
		if iv, ok := v.Kind.(*qdrant.Value_IntegerValue); ok {
			return int(iv.IntegerValue)
		}
	}
	return 0
}

func getStringSlice(payload map[string]*qdrant.Value, key string) []string {
	if v, ok := payload[key]; ok {
		if lv, ok := v.Kind.(*qdrant.Value_ListValue); ok {
			result := make([]string, 0, len(lv.ListValue.Values))
			for _, item := range lv.ListValue.Values {
				if sv, ok := item.Kind.(*qdrant.Value_StringValue); ok {
					result = append(result, sv.StringValue)
				}
			}
			return result
		}
	}
	return nil
}

func toInterfaceSlice(s []string) []interface{} {
	result := make([]interface{}, len(s))
	for i, v := range s {
		result[i] = v
	}
	return result
}

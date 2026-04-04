package qdrant

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"

	"github.com/qdrant/go-client/qdrant"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/airo-ai-builder/knowledge-service/internal/config"
	"github.com/airo-ai-builder/knowledge-service/pkg/models"
)

// Client provides methods for storing and searching knowledge chunks in Qdrant.
type Client struct {
	client     *qdrant.Client
	collection string
	cfg        *config.Config
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
	if cfg.QdrantUseTLS {
		tlsCfg := &tls.Config{MinVersion: tls.VersionTLS13}
		if cfg.QdrantTLSSkipVerify {
			tlsCfg.InsecureSkipVerify = true //nosemgrep: problem-based-packs.insecure-transport.go-stdlib.bypass-tls-verification.bypass-tls-verification -- Self-signed certs in internal network
		}
		qdrantConfig.TLSConfig = tlsCfg
	}

	client, err := qdrant.NewClient(qdrantConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create qdrant client: %w", err)
	}

	return &Client{
		client:     client,
		collection: cfg.QdrantCollection,
		cfg:        cfg,
	}, nil
}

// Close closes the Qdrant client connection.
func (c *Client) Close() error {
	return c.client.Close()
}

// DropCollection deletes the collection and all its data.
// The collection will be recreated with the correct schema on the next call to EnsureCollection.
func (c *Client) DropCollection(ctx context.Context) error {
	if err := c.client.DeleteCollection(ctx, c.collection); err != nil {
		return fmt.Errorf("failed to delete collection %q: %w", c.collection, err)
	}
	slog.Info("qdrant.collection.dropped", "collection", c.collection)
	return nil
}

// HealthCheck tests Qdrant connectivity by checking if the collection exists.
func (c *Client) HealthCheck(ctx context.Context) error {
	_, err := c.client.CollectionExists(ctx, c.collection)
	if err != nil {
		return fmt.Errorf("qdrant health check failed: %w", err)
	}
	return nil
}

// EnsureCollection creates the collection if it doesn't exist.
// Uses named vectors: "dense_fast" (256-dim cosine, HNSW), "dense_precise" (1024-dim cosine, on_disk),
// and "sparse" (IDF modifier).
func (c *Client) EnsureCollection(ctx context.Context) error {
	exists, err := c.client.CollectionExists(ctx, c.collection)
	if err != nil {
		return fmt.Errorf("failed to check collection existence: %w", err)
	}

	if exists {
		slog.Debug("qdrant.collection.exists", "collection", c.collection)
		return nil
	}

	dimFast := uint64(c.cfg.EmbeddingDimensionFast)       //nolint:gosec // G115: bounded by config defaults (positive int)
	dimPrecise := uint64(c.cfg.EmbeddingDimensionPrecise) //nolint:gosec // G115: bounded by config defaults (positive int)

	err = c.client.CreateCollection(ctx, &qdrant.CreateCollection{
		CollectionName: c.collection,
		VectorsConfig: qdrant.NewVectorsConfigMap(map[string]*qdrant.VectorParams{
			"dense_fast": {
				Size:     dimFast,
				Distance: qdrant.Distance_Cosine,
				HnswConfig: &qdrant.HnswConfigDiff{
					M:           qdrant.PtrOf(uint64(32)),
					EfConstruct: qdrant.PtrOf(uint64(256)),
				},
			},
			"dense_precise": {
				Size:     dimPrecise,
				Distance: qdrant.Distance_Cosine,
				OnDisk:   qdrant.PtrOf(true),
			},
		}),
		SparseVectorsConfig: qdrant.NewSparseVectorsConfig(map[string]*qdrant.SparseVectorParams{
			"sparse": {
				Modifier: qdrant.PtrOf(qdrant.Modifier_Idf),
			},
		}),
		QuantizationConfig: qdrant.NewQuantizationScalar(&qdrant.ScalarQuantization{
			Type:      qdrant.QuantizationType_Int8,
			Quantile:  qdrant.PtrOf(float32(0.99)),
			AlwaysRam: qdrant.PtrOf(true),
		}),
		OptimizersConfig: &qdrant.OptimizersConfigDiff{
			IndexingThreshold: qdrant.PtrOf(uint64(1000)),
			FlushIntervalSec:  qdrant.PtrOf(uint64(5)),
		},
	})
	if err != nil {
		// Treat AlreadyExists as success — concurrent requests can race to create
		// the collection when it's missing; the one that loses is still correct.
		if status.Code(err) == codes.AlreadyExists {
			slog.Debug("qdrant.collection.already_exists", "collection", c.collection)
			return nil
		}
		return fmt.Errorf("failed to create collection: %w", err)
	}

	// Create payload indexes
	keywordIndexes := []string{"docName", "tags", "contentHash", "sectionPath"}
	for _, field := range keywordIndexes {
		_, indexErr := c.client.CreateFieldIndex(ctx, &qdrant.CreateFieldIndexCollection{
			CollectionName: c.collection,
			FieldName:      field,
			FieldType:      qdrant.PtrOf(qdrant.FieldType_FieldTypeKeyword),
		})
		if indexErr != nil {
			slog.Warn("qdrant.index.create.failed", "field", field, "error", indexErr)
		}
	}

	// Integer index for chunkIndex
	_, err = c.client.CreateFieldIndex(ctx, &qdrant.CreateFieldIndexCollection{
		CollectionName: c.collection,
		FieldName:      "chunkIndex",
		FieldType:      qdrant.PtrOf(qdrant.FieldType_FieldTypeInteger),
	})
	if err != nil {
		slog.Warn("qdrant.index.create.failed", "field", "chunkIndex", "error", err)
	}

	// Datetime index for updatedAt
	_, err = c.client.CreateFieldIndex(ctx, &qdrant.CreateFieldIndexCollection{
		CollectionName: c.collection,
		FieldName:      "updatedAt",
		FieldType:      qdrant.PtrOf(qdrant.FieldType_FieldTypeDatetime),
	})
	if err != nil {
		slog.Warn("qdrant.index.create.failed", "field", "updatedAt", "error", err)
	}

	slog.Info("qdrant.collection.created", "collection", c.collection)
	return nil
}

// HybridSearchParams holds parameters for a hybrid search query.
type HybridSearchParams struct {
	DenseFastVector    []float32
	DensePreciseVector []float32
	SparseVector       *models.SparseVector
	Limit              uint64
	DocNamesFilter     []string
	TagsFilter         []string
}

// HybridSearch performs a multi-stage hybrid search using weighted RRF fusion:
//
//	Stage 1: dense_fast + sparse prefetch (inner candidates)
//	Stage 2: Weighted RRF fusion (k=1, dense 3x over sparse)
//	Stage 3: Rescore with dense_precise (final ranking)
func (c *Client) HybridSearch(ctx context.Context, params HybridSearchParams) ([]*qdrant.ScoredPoint, error) {
	prefetchLimit := uint64(c.cfg.SearchPrefetchLimit) //nolint:gosec // G115: bounded by config
	fusionLimit := uint64(c.cfg.SearchFusionLimit)     //nolint:gosec // G115: bounded by config
	prefetchThreshold := c.cfg.SearchPrefetchThreshold
	oversampling := float64(c.cfg.SearchOversampling)

	filter := c.buildSearchFilter(params.DocNamesFilter, params.TagsFilter)

	hnswEf := uint64(c.cfg.SearchHnswEf) //nolint:gosec // G115: bounded by config

	// Stage 1: dense_fast + sparse prefetch
	innerPrefetches := []*qdrant.PrefetchQuery{
		{
			Query:          qdrant.NewQueryDense(params.DenseFastVector),
			Using:          qdrant.PtrOf("dense_fast"),
			Limit:          qdrant.PtrOf(prefetchLimit),
			ScoreThreshold: qdrant.PtrOf(prefetchThreshold),
			Filter:         filter,
			Params: &qdrant.SearchParams{
				HnswEf: qdrant.PtrOf(hnswEf),
				Quantization: &qdrant.QuantizationSearchParams{
					Rescore:      qdrant.PtrOf(true),
					Oversampling: qdrant.PtrOf(oversampling),
				},
			},
		},
	}

	if params.SparseVector != nil && len(params.SparseVector.Indices) > 0 {
		innerPrefetches = append(innerPrefetches, &qdrant.PrefetchQuery{
			Query:          qdrant.NewQuerySparse(params.SparseVector.Indices, params.SparseVector.Values),
			Using:          qdrant.PtrOf("sparse"),
			Limit:          qdrant.PtrOf(prefetchLimit),
			ScoreThreshold: qdrant.PtrOf(prefetchThreshold),
			Filter:         filter,
		})
	}

	// Stage 2: Weighted RRF fusion → Stage 3: Rescore with dense_precise
	// Weights must match the number of prefetches: [dense_fast, sparse] when both present.
	rrfWeights := []float32{3.0}
	if len(innerPrefetches) > 1 {
		rrfWeights = append(rrfWeights, 1.0)
	}
	rrfPrefetch := &qdrant.PrefetchQuery{
		Prefetch: innerPrefetches,
		Query:    qdrant.NewQueryRRF(&qdrant.Rrf{K: qdrant.PtrOf(uint32(1)), Weights: rrfWeights}),
		Limit:    qdrant.PtrOf(fusionLimit),
	}

	results, err := c.client.Query(ctx, &qdrant.QueryPoints{
		CollectionName: c.collection,
		Prefetch:       []*qdrant.PrefetchQuery{rrfPrefetch},
		Query:          qdrant.NewQueryDense(params.DensePreciseVector),
		Using:          qdrant.PtrOf("dense_precise"),
		Limit:          qdrant.PtrOf(params.Limit),
		WithPayload:    qdrant.NewWithPayload(true),
		Params: &qdrant.SearchParams{
			HnswEf: qdrant.PtrOf(hnswEf),
			Quantization: &qdrant.QuantizationSearchParams{
				Rescore: qdrant.PtrOf(true),
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to execute multi-stage hybrid search: %w", err)
	}
	return results, nil
}

// FetchAdjacentContent retrieves content of chunks adjacent to the given chunkIndex
// within the same document. Returns the combined content of (chunkIndex-1, chunkIndex, chunkIndex+1).
func (c *Client) FetchAdjacentContent(ctx context.Context, docName string, chunkIndex int) string {
	scrollResult, err := c.client.Scroll(ctx, &qdrant.ScrollPoints{
		CollectionName: c.collection,
		Filter: &qdrant.Filter{
			Must: []*qdrant.Condition{
				qdrant.NewMatchKeyword("docName", docName),
				qdrant.NewRange("chunkIndex", &qdrant.Range{
					Gte: qdrant.PtrOf(float64(chunkIndex - 1)),
					Lte: qdrant.PtrOf(float64(chunkIndex + 1)),
				}),
			},
		},
		Limit:       qdrant.PtrOf(uint32(3)),
		WithPayload: qdrant.NewWithPayloadInclude("content", "chunkIndex"),
	})
	if err != nil {
		slog.Warn("qdrant.adjacent.fetch.failed", "docName", docName, "chunkIndex", chunkIndex, "error", err)
		return ""
	}

	// Sort by chunkIndex and join content
	type indexed struct {
		index   int
		content string
	}
	chunks := make([]indexed, 0, len(scrollResult))
	for _, point := range scrollResult {
		idx := getIntValue(point.Payload, "chunkIndex")
		content := getStringValue(point.Payload, "content")
		if content != "" && idx != chunkIndex {
			chunks = append(chunks, indexed{index: idx, content: content})
		}
	}

	// Build context: before + after
	var before, after string
	for _, c := range chunks {
		if c.index < chunkIndex {
			before = c.content
		} else if c.index > chunkIndex {
			after = c.content
		}
	}

	var parts []string
	if before != "" {
		parts = append(parts, before)
	}
	if after != "" {
		parts = append(parts, after)
	}

	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, "\n\n---\n\n")
}

// FetchSectionContent retrieves all chunks from the same document section
// (matching sectionPath) to provide full-section context. Falls back to
// FetchAdjacentContent when sectionPath is empty.
func (c *Client) FetchSectionContent(ctx context.Context, docName, sectionPath string, chunkIndex int) string {
	if sectionPath == "" {
		return c.FetchAdjacentContent(ctx, docName, chunkIndex)
	}

	scrollResult, err := c.client.Scroll(ctx, &qdrant.ScrollPoints{
		CollectionName: c.collection,
		Filter: &qdrant.Filter{
			Must: []*qdrant.Condition{
				qdrant.NewMatchKeyword("docName", docName),
				qdrant.NewMatchKeyword("sectionPath", sectionPath),
			},
		},
		Limit:       qdrant.PtrOf(uint32(20)),
		WithPayload: qdrant.NewWithPayloadInclude("content", "chunkIndex"),
	})
	if err != nil {
		slog.Warn("qdrant.section.fetch.failed", "docName", docName, "sectionPath", sectionPath, "error", err)
		return c.FetchAdjacentContent(ctx, docName, chunkIndex)
	}

	type indexed struct {
		index   int
		content string
	}
	siblings := make([]indexed, 0, len(scrollResult))
	for _, point := range scrollResult {
		idx := getIntValue(point.Payload, "chunkIndex")
		content := getStringValue(point.Payload, "content")
		if content != "" && idx != chunkIndex {
			siblings = append(siblings, indexed{index: idx, content: content})
		}
	}

	if len(siblings) == 0 {
		return ""
	}

	slices.SortFunc(siblings, func(a, b indexed) int { return a.index - b.index })

	parts := make([]string, len(siblings))
	for i, s := range siblings {
		parts[i] = s.content
	}
	return strings.Join(parts, "\n\n---\n\n")
}

// BatchUpsert inserts or updates chunks in Qdrant.
func (c *Client) BatchUpsert(ctx context.Context, chunks []*models.Chunk) error {
	if len(chunks) == 0 {
		return nil
	}

	points := make([]*qdrant.PointStruct, 0, len(chunks))
	for _, chunk := range chunks {
		if chunk.DenseVector == nil || chunk.DenseFastVector == nil || chunk.ContentHash == "" {
			continue
		}

		payload := chunkToPayload(chunk)

		point := &qdrant.PointStruct{
			Id:      qdrant.NewID(contentHashToUUID(chunk.ContentHash)),
			Payload: payload,
		}

		// Set named vectors
		namedVectors := map[string]*qdrant.Vector{
			"dense_fast":    qdrant.NewVectorDense(chunk.DenseFastVector),
			"dense_precise": qdrant.NewVectorDense(chunk.DenseVector),
		}
		if chunk.SparseVector != nil && len(chunk.SparseVector.Indices) > 0 {
			namedVectors["sparse"] = qdrant.NewVectorSparse(chunk.SparseVector.Indices, chunk.SparseVector.Values)
		}
		point.Vectors = qdrant.NewVectorsMap(namedVectors)

		points = append(points, point)
	}

	if len(points) == 0 {
		return nil
	}

	// Batch in groups of configured batch size
	batchSize := c.cfg.IngestBatchSize
	for i := 0; i < len(points); i += batchSize {
		end := i + batchSize
		if end > len(points) {
			end = len(points)
		}

		_, err := c.client.Upsert(ctx, &qdrant.UpsertPoints{
			CollectionName: c.collection,
			Points:         points[i:end],
		})
		if err != nil {
			return fmt.Errorf("failed to upsert batch starting at %d: %w", i, err)
		}
	}

	return nil
}

// ScrollByDocName returns all point IDs and content hashes for a given document name.
func (c *Client) ScrollByDocName(ctx context.Context, docName string) (map[string]string, error) {
	result := make(map[string]string) // pointID -> contentHash

	var offset *qdrant.PointId
	for {
		scrollResult, err := c.client.Scroll(ctx, &qdrant.ScrollPoints{
			CollectionName: c.collection,
			Filter: &qdrant.Filter{
				Must: []*qdrant.Condition{
					qdrant.NewMatchKeyword("docName", docName),
				},
			},
			Limit:       qdrant.PtrOf(uint32(100)),
			WithPayload: qdrant.NewWithPayloadInclude("contentHash"),
			Offset:      offset,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to scroll by docName %q: %w", docName, err)
		}

		for _, point := range scrollResult {
			pointID := extractPointID(point.Id)
			contentHash := getStringValue(point.Payload, "contentHash")
			if pointID != "" {
				result[pointID] = contentHash
			}
		}

		if len(scrollResult) < 100 {
			break
		}
		if len(scrollResult) > 0 {
			offset = scrollResult[len(scrollResult)-1].Id
		}
	}

	return result, nil
}

// DeletePoints deletes points by their IDs.
func (c *Client) DeletePoints(ctx context.Context, pointIDs []string) error {
	if len(pointIDs) == 0 {
		return nil
	}

	ids := make([]*qdrant.PointId, len(pointIDs))
	for i, id := range pointIDs {
		ids[i] = qdrant.NewID(id)
	}

	_, err := c.client.Delete(ctx, &qdrant.DeletePoints{
		CollectionName: c.collection,
		Points:         qdrant.NewPointsSelectorIDs(ids),
	})
	if err != nil {
		return fmt.Errorf("failed to delete points: %w", err)
	}

	return nil
}

// GetCollectionStats returns collection statistics.
func (c *Client) GetCollectionStats(ctx context.Context) (*models.StatsResponse, error) {
	info, err := c.client.GetCollectionInfo(ctx, c.collection)
	if err != nil {
		return nil, fmt.Errorf("failed to get collection info: %w", err)
	}

	pointCount := uint64(0)
	if info.PointsCount != nil {
		pointCount = *info.PointsCount
	}

	// Count distinct documents via the Facet API (docName is a keyword-indexed field).
	documentCount := uint64(0)
	if pointCount > 0 {
		facets, facetErr := c.client.Facet(ctx, &qdrant.FacetCounts{
			CollectionName: c.collection,
			Key:            "docName",
			Limit:          qdrant.PtrOf(uint64(100000)),
		})
		if facetErr != nil {
			slog.Warn("qdrant.stats.facet.failed", "error", facetErr)
		} else {
			documentCount = uint64(len(facets))
		}
	}

	return &models.StatsResponse{
		Collection:    c.collection,
		PointCount:    pointCount,
		DocumentCount: documentCount,
		IndexStatus:   strings.ToLower(info.Status.String()),
	}, nil
}

// buildSearchFilter creates a Qdrant filter from doc names and tags.
func (c *Client) buildSearchFilter(docNames, tags []string) *qdrant.Filter {
	var conditions []*qdrant.Condition

	if len(docNames) > 0 {
		conditions = append(conditions, qdrant.NewMatchKeywords("docName", docNames...))
	}
	if len(tags) > 0 {
		conditions = append(conditions, qdrant.NewMatchKeywords("tags", tags...))
	}

	if len(conditions) == 0 {
		return nil
	}

	return &qdrant.Filter{
		Must: conditions,
	}
}

// chunkToPayload converts a Chunk to a Qdrant payload map.
func chunkToPayload(chunk *models.Chunk) map[string]*qdrant.Value {
	tagsInterface := make([]any, len(chunk.Tags))
	for i, t := range chunk.Tags {
		tagsInterface[i] = t
	}

	payload := map[string]any{
		"docName":           chunk.DocName,
		"sectionPath":       chunk.SectionPath,
		"content":           chunk.Content,
		"contextualContent": chunk.ContextualContent,
		"contentHash":       chunk.ContentHash,
		"contextualHash":    chunk.ContextualHash,
		"chunkIndex":        chunk.ChunkIndex,
		"tags":              tagsInterface,
		"createdAt":         chunk.CreatedAt.Format("2006-01-02T15:04:05Z"),
		"updatedAt":         chunk.UpdatedAt.Format("2006-01-02T15:04:05Z"),
	}

	return qdrant.NewValueMap(payload)
}

// contentHashToUUID converts a 64-char SHA-256 hex string to UUID format (8-4-4-4-12)
// by taking the first 32 hex chars (128 bits) and inserting dashes.
// This produces a deterministic, Qdrant-compatible point ID from a content hash.
func contentHashToUUID(hash string) string {
	if len(hash) < 32 {
		return hash
	}
	h := hash[:32]
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}

// Helper functions for extracting values from Qdrant payload.

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

func extractPointID(id *qdrant.PointId) string {
	if id == nil {
		return ""
	}
	switch v := id.PointIdOptions.(type) {
	case *qdrant.PointId_Uuid:
		return v.Uuid
	case *qdrant.PointId_Num:
		return strconv.FormatUint(v.Num, 10)
	default:
		return ""
	}
}

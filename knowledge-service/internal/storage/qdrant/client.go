package qdrant

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"github.com/qdrant/go-client/qdrant"

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

// HealthCheck tests Qdrant connectivity by checking if the collection exists.
func (c *Client) HealthCheck(ctx context.Context) error {
	_, err := c.client.CollectionExists(ctx, c.collection)
	if err != nil {
		return fmt.Errorf("qdrant health check failed: %w", err)
	}
	return nil
}

// EnsureCollection creates the collection if it doesn't exist.
// Uses named vectors: "dense" (1536-dim cosine) and "sparse" (IDF modifier, dot product).
func (c *Client) EnsureCollection(ctx context.Context) error {
	exists, err := c.client.CollectionExists(ctx, c.collection)
	if err != nil {
		return fmt.Errorf("failed to check collection existence: %w", err)
	}

	if exists {
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

	dim := uint64(c.cfg.EmbeddingDimension) //nolint:gosec // G115: bounded by config defaults (positive int)

	err = c.client.CreateCollection(ctx, &qdrant.CreateCollection{
		CollectionName: c.collection,
		VectorsConfig: qdrant.NewVectorsConfigMap(map[string]*qdrant.VectorParams{
			"dense": {
				Size:     dim,
				Distance: qdrant.Distance_Cosine,
				OnDisk:   qdrant.PtrOf(true),
				HnswConfig: &qdrant.HnswConfigDiff{
					M:           qdrant.PtrOf(uint64(16)),
					EfConstruct: qdrant.PtrOf(uint64(100)),
				},
			},
		}),
		SparseVectorsConfig: qdrant.NewSparseVectorsConfig(map[string]*qdrant.SparseVectorParams{
			"sparse": {
				Modifier: qdrant.PtrOf(qdrant.Modifier_Idf),
			},
		}),
		QuantizationConfig: qdrant.NewQuantizationScalar(&qdrant.ScalarQuantization{
			Type:      qdrant.QuantizationType_Int8,
			AlwaysRam: qdrant.PtrOf(true),
		}),
		OptimizersConfig: &qdrant.OptimizersConfigDiff{
			IndexingThreshold: qdrant.PtrOf(uint64(1000)),
			FlushIntervalSec:  qdrant.PtrOf(uint64(5)),
		},
	})
	if err != nil {
		return fmt.Errorf("failed to create collection: %w", err)
	}

	// Create payload indexes
	keywordIndexes := []string{"docName", "tags", "contentHash"}
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

	// Integer index for chunkIndex (formula boost)
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
	DenseVector    []float32
	SparseVector   *models.SparseVector
	Limit          uint64
	DocNamesFilter []string
	TagsFilter     []string
}

// HybridSearch performs a hybrid dense+sparse search with RRF fusion, optionally
// followed by Qdrant formula reranking that boosts introductory chunks (chunkIndex == 0).
//
// When SearchFormulaBoost > 0 (default 0.05), the pipeline is:
//
//	dense + sparse → [RRF prefetch] → formula(score + boost*(chunkIndex==0))
//
// This rewards overview/introduction chunks that are broadly representative,
// helping reduce false positives where a deep implementation chunk scores high
// purely because it shares keywords with the query.
func (c *Client) HybridSearch(ctx context.Context, params HybridSearchParams) ([]*qdrant.ScoredPoint, error) {
	prefetchLimit := uint64(c.cfg.SearchPrefetchLimit) //nolint:gosec // G115: bounded by config defaults (positive int)
	prefetchThreshold := c.cfg.SearchPrefetchThreshold
	fusionThreshold := c.cfg.SearchFusionThreshold
	formulaBoost := c.cfg.SearchFormulaBoost
	overFetchLimit := params.Limit * 3 // over-fetch for dedup

	// Build filter conditions (applied at the innermost prefetch level)
	filter := c.buildSearchFilter(params.DocNamesFilter, params.TagsFilter)

	// Dense prefetch
	densePrefetch := &qdrant.PrefetchQuery{
		Query:          qdrant.NewQueryDense(params.DenseVector),
		Using:          qdrant.PtrOf("dense"),
		Limit:          qdrant.PtrOf(prefetchLimit),
		ScoreThreshold: qdrant.PtrOf(prefetchThreshold),
		Filter:         filter,
	}

	// Sparse prefetch
	innerPrefetches := []*qdrant.PrefetchQuery{densePrefetch}
	if params.SparseVector != nil && len(params.SparseVector.Indices) > 0 {
		innerPrefetches = append(innerPrefetches, &qdrant.PrefetchQuery{
			Query:          qdrant.NewQuerySparse(params.SparseVector.Indices, params.SparseVector.Values),
			Using:          qdrant.PtrOf("sparse"),
			Limit:          qdrant.PtrOf(prefetchLimit),
			ScoreThreshold: qdrant.PtrOf(prefetchThreshold),
			Filter:         filter,
		})
	}

	// When formula boost is configured, use two-level query:
	//   [dense, sparse] → RRF prefetch → formula main query
	if formulaBoost > 0 {
		rrfPrefetch := &qdrant.PrefetchQuery{
			Prefetch: innerPrefetches,
			Query:    qdrant.NewQueryFusion(qdrant.Fusion_RRF),
			Limit:    qdrant.PtrOf(overFetchLimit),
		}

		// Formula: $score + formulaBoost * (chunkIndex == 0)
		// Introductory chunks (index 0) get a small lift.  All other chunks are
		// evaluated purely on their RRF score.  Defaults prevent a missing
		// chunkIndex payload from accidentally receiving the bonus.
		scoreFormula := qdrant.NewQueryFormula(&qdrant.Formula{
			Expression: qdrant.NewExpressionSum(&qdrant.SumExpression{
				Sum: []*qdrant.Expression{
					qdrant.NewExpressionVariable("$score"),
					qdrant.NewExpressionMult(&qdrant.MultExpression{
						Mult: []*qdrant.Expression{
							qdrant.NewExpressionConstant(formulaBoost),
							qdrant.NewExpressionCondition(qdrant.NewMatchInt("chunkIndex", 0)),
						},
					}),
				},
			}),
			// Default chunkIndex to 1 so mid-document chunks get no bonus when
			// the payload field happens to be absent.
			Defaults: map[string]*qdrant.Value{
				"chunkIndex": {Kind: &qdrant.Value_IntegerValue{IntegerValue: 1}},
			},
		})

		results, err := c.client.Query(ctx, &qdrant.QueryPoints{
			CollectionName: c.collection,
			Prefetch:       []*qdrant.PrefetchQuery{rrfPrefetch},
			Query:          scoreFormula,
			Limit:          qdrant.PtrOf(overFetchLimit),
			ScoreThreshold: qdrant.PtrOf(fusionThreshold),
			WithPayload:    qdrant.NewWithPayload(true),
		})
		if err != nil {
			return nil, fmt.Errorf("failed to execute hybrid search with formula reranking: %w", err)
		}
		return results, nil
	}

	// Fallback: plain RRF without formula reranking
	results, err := c.client.Query(ctx, &qdrant.QueryPoints{
		CollectionName: c.collection,
		Prefetch:       innerPrefetches,
		Query:          qdrant.NewQueryFusion(qdrant.Fusion_RRF),
		Limit:          qdrant.PtrOf(overFetchLimit),
		ScoreThreshold: qdrant.PtrOf(fusionThreshold),
		WithPayload:    qdrant.NewWithPayload(true),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to execute hybrid search: %w", err)
	}
	return results, nil
}

// BatchUpsert inserts or updates chunks in Qdrant.
func (c *Client) BatchUpsert(ctx context.Context, chunks []*models.Chunk) error {
	if len(chunks) == 0 {
		return nil
	}

	points := make([]*qdrant.PointStruct, 0, len(chunks))
	for _, chunk := range chunks {
		if chunk.DenseVector == nil || chunk.ContentHash == "" {
			continue
		}

		payload := chunkToPayload(chunk)

		point := &qdrant.PointStruct{
			Id:      qdrant.NewID(contentHashToUUID(chunk.ContentHash)),
			Payload: payload,
		}

		// Set named vectors
		namedVectors := map[string]*qdrant.Vector{
			"dense": qdrant.NewVectorDense(chunk.DenseVector),
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

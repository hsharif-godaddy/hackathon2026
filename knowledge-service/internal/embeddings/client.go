package embeddings

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"

	"github.com/airo-ai-builder/knowledge-service/internal/config"
)

// Client provides methods for generating text embeddings using OpenAI's API.
type Client struct {
	openaiClient openai.Client
	model        string
	dimension    int
}

// New creates a new embeddings client with the provided configuration.
func New(cfg *config.Config) *Client {
	opts := []option.RequestOption{
		option.WithAPIKey(cfg.OpenAIAPIKey),
	}
	if cfg.OpenAIBaseURL != "" {
		opts = append(opts, option.WithBaseURL(cfg.OpenAIBaseURL))
	}

	return &Client{
		openaiClient: openai.NewClient(opts...),
		model:        cfg.EmbeddingModel,
		dimension:    cfg.EmbeddingDimension,
	}
}

// Dimension returns the expected embedding dimension.
func (c *Client) Dimension() int {
	return c.dimension
}

// Generate creates an embedding vector for a single text input.
func (c *Client) Generate(ctx context.Context, text string) ([]float32, error) {
	resp, err := c.openaiClient.Embeddings.New(ctx, openai.EmbeddingNewParams{
		Input: openai.EmbeddingNewParamsInputUnion{
			OfArrayOfStrings: []string{text},
		},
		Model: c.model,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create embedding: %w", err)
	}

	if len(resp.Data) == 0 {
		return nil, errors.New("empty embedding response")
	}

	return normalizeEmbedding(toFloat32(resp.Data[0].Embedding)), nil
}

// GenerateBatch creates embedding vectors for multiple text inputs.
func (c *Client) GenerateBatch(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}

	resp, err := c.openaiClient.Embeddings.New(ctx, openai.EmbeddingNewParams{
		Input: openai.EmbeddingNewParamsInputUnion{
			OfArrayOfStrings: texts,
		},
		Model: c.model,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create batch embeddings: %w", err)
	}

	if len(resp.Data) != len(texts) {
		return nil, fmt.Errorf("embedding count mismatch: got %d, want %d", len(resp.Data), len(texts))
	}

	embeddings := make([][]float32, len(resp.Data))
	for i, data := range resp.Data {
		embeddings[i] = normalizeEmbedding(toFloat32(data.Embedding))
	}

	return embeddings, nil
}

func toFloat32(f64 []float64) []float32 {
	f32 := make([]float32, len(f64))
	for i, v := range f64 {
		f32[i] = float32(v)
	}
	return f32
}

func normalizeEmbedding(embedding []float32) []float32 {
	var sum float64
	for _, v := range embedding {
		sum += float64(v * v)
	}
	magnitude := float32(math.Sqrt(sum))

	if magnitude == 0 {
		return embedding
	}

	normalized := make([]float32, len(embedding))
	for i, v := range embedding {
		normalized[i] = v / magnitude
	}
	return normalized
}

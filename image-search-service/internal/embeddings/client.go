// Package embeddings provides a client for generating text embeddings via OpenAI.
package embeddings

import (
	"context"
	"errors"
	"fmt"
	"math"

	openai "github.com/sashabaranov/go-openai"

	"github.com/airo-ai-builder/image-search-service/internal/config"
)

// EmbeddingModel is the OpenAI model used for generating embeddings.
const EmbeddingModel = openai.SmallEmbedding3

// EmbeddingDimension is the vector dimension for text-embedding-3-small.
const EmbeddingDimension = 1536

// Client provides methods for generating text embeddings using OpenAI's API.
type Client struct {
	openaiClient *openai.Client
}

// New creates a new embeddings client with the provided configuration.
func New(cfg *config.Config) *Client {
	var clientConfig openai.ClientConfig

	if cfg.OpenAIBaseURL != "" {
		clientConfig = openai.DefaultConfig(cfg.OpenAIAPIKey)
		clientConfig.BaseURL = cfg.OpenAIBaseURL
	} else {
		clientConfig = openai.DefaultConfig(cfg.OpenAIAPIKey)
	}

	return &Client{
		openaiClient: openai.NewClientWithConfig(clientConfig),
	}
}

// Generate creates an embedding vector for a single text input.
func (c *Client) Generate(ctx context.Context, text string) ([]float32, error) {
	req := openai.EmbeddingRequest{
		Input: []string{text},
		Model: EmbeddingModel,
	}

	resp, err := c.openaiClient.CreateEmbeddings(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to create embedding: %w", err)
	}

	if len(resp.Data) == 0 {
		return nil, errors.New("empty embedding response")
	}

	return normalizeEmbedding(resp.Data[0].Embedding), nil
}

// GenerateBatch creates embedding vectors for multiple text inputs.
func (c *Client) GenerateBatch(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}

	req := openai.EmbeddingRequest{
		Input: texts,
		Model: EmbeddingModel,
	}

	resp, err := c.openaiClient.CreateEmbeddings(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to create batch embeddings: %w", err)
	}

	if len(resp.Data) != len(texts) {
		return nil, fmt.Errorf("embedding count mismatch: got %d, want %d", len(resp.Data), len(texts))
	}

	embeddings := make([][]float32, len(resp.Data))
	for i, data := range resp.Data {
		embeddings[i] = normalizeEmbedding(data.Embedding)
	}

	return embeddings, nil
}

// normalizeEmbedding normalizes a vector to unit length (magnitude of 1).
// This is important for cosine similarity calculations in vector search.
func normalizeEmbedding(embedding []float32) []float32 {
	var sum float64
	for _, v := range embedding {
		sum += float64(v * v)
	}
	magnitude := float32(math.Sqrt(sum))

	if magnitude == 0 {
		return embedding // return as-is for zero vectors
	}

	normalized := make([]float32, len(embedding))
	for i, v := range embedding {
		normalized[i] = v / magnitude
	}
	return normalized
}

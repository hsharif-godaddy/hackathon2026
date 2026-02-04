package embeddings

import (
	"math"
	"testing"

	"github.com/airo-ai-builder/image-search-service/internal/config"
)

func TestNormalizeEmbedding(t *testing.T) {
	tests := []struct {
		name      string
		input     []float32
		wantLen   int
		wantMag   float64 // expected magnitude (should be ~1 for non-zero vectors)
		tolerance float64
	}{
		{
			name:      "simple vector",
			input:     []float32{3, 4}, // 3-4-5 triangle, magnitude = 5
			wantLen:   2,
			wantMag:   1.0,
			tolerance: 1e-6,
		},
		{
			name:      "unit vector stays unit",
			input:     []float32{1, 0, 0},
			wantLen:   3,
			wantMag:   1.0,
			tolerance: 1e-6,
		},
		{
			name:      "negative values",
			input:     []float32{-3, 4},
			wantLen:   2,
			wantMag:   1.0,
			tolerance: 1e-6,
		},
		{
			name:      "high dimensional vector",
			input:     make([]float32, 1536), // Same dimension as text-embedding-3-small
			wantLen:   1536,
			wantMag:   0.0, // Zero vector
			tolerance: 1e-6,
		},
		{
			name:      "mixed positive negative",
			input:     []float32{1, -1, 1, -1},
			wantLen:   4,
			wantMag:   1.0,
			tolerance: 1e-6,
		},
	}

	// Initialize the high dimensional vector with non-zero values
	tests[3].input[0] = 1.0
	tests[3].input[100] = 2.0
	tests[3].input[500] = -1.5
	tests[3].wantMag = 1.0

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeEmbedding(tt.input)

			if len(result) != tt.wantLen {
				t.Errorf("normalizeEmbedding() length = %d, want %d", len(result), tt.wantLen)
			}

			// Calculate magnitude of result
			var sum float64
			for _, v := range result {
				sum += float64(v * v)
			}
			gotMag := math.Sqrt(sum)

			if math.Abs(gotMag-tt.wantMag) > tt.tolerance {
				t.Errorf("normalizeEmbedding() magnitude = %v, want %v (tolerance %v)", gotMag, tt.wantMag, tt.tolerance)
			}
		})
	}
}

func TestNormalizeEmbedding_ZeroVector(t *testing.T) {
	input := []float32{0, 0, 0}
	result := normalizeEmbedding(input)

	// Zero vector should be returned as-is
	if len(result) != len(input) {
		t.Errorf("normalizeEmbedding() length = %d, want %d", len(result), len(input))
	}

	for i, v := range result {
		if v != 0 {
			t.Errorf("normalizeEmbedding()[%d] = %v, want 0", i, v)
		}
	}
}

func TestNormalizeEmbedding_PreservesDirection(t *testing.T) {
	input := []float32{3, 4}
	result := normalizeEmbedding(input)

	// The ratio of components should be preserved
	// 3/4 = 0.75, so result[0]/result[1] should also be 0.75
	expectedRatio := float64(input[0]) / float64(input[1])
	gotRatio := float64(result[0]) / float64(result[1])

	if math.Abs(expectedRatio-gotRatio) > 1e-6 {
		t.Errorf("normalizeEmbedding() ratio = %v, want %v", gotRatio, expectedRatio)
	}
}

func TestClient_New(t *testing.T) {
	cfg := &config.Config{
		OpenAIAPIKey:  "test-api-key",
		OpenAIBaseURL: "",
	}

	client := New(cfg)

	if client == nil {
		t.Fatal("New() returned nil client")
	}

	if client.openaiClient == nil {
		t.Error("New() client has nil openaiClient")
	}
}

func TestClient_New_WithCustomBaseURL(t *testing.T) {
	cfg := &config.Config{
		OpenAIAPIKey:  "test-api-key",
		OpenAIBaseURL: "https://custom.openai.proxy/v1",
	}

	client := New(cfg)

	if client == nil {
		t.Fatal("New() returned nil client")
	}

	if client.openaiClient == nil {
		t.Error("New() client has nil openaiClient")
	}
}

func TestEmbeddingDimension(t *testing.T) {
	// Verify the constant matches text-embedding-3-small dimension
	if EmbeddingDimension != 1536 {
		t.Errorf("EmbeddingDimension = %d, want 1536", EmbeddingDimension)
	}
}

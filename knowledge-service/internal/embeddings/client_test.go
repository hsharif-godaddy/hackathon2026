package embeddings

import (
	"math"
	"testing"

	"github.com/airo-ai-builder/knowledge-service/internal/config"
)

func TestNormalizeEmbedding(t *testing.T) {
	tests := []struct {
		name      string
		input     []float32
		wantLen   int
		wantMag   float64
		tolerance float64
	}{
		{
			name:      "simple vector",
			input:     []float32{3, 4},
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
			name:      "mixed positive negative",
			input:     []float32{1, -1, 1, -1},
			wantLen:   4,
			wantMag:   1.0,
			tolerance: 1e-6,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeEmbedding(tt.input)

			if len(result) != tt.wantLen {
				t.Errorf("normalizeEmbedding() length = %d, want %d", len(result), tt.wantLen)
			}

			var sum float64
			for _, v := range result {
				sum += float64(v * v)
			}
			gotMag := math.Sqrt(sum)

			if math.Abs(gotMag-tt.wantMag) > tt.tolerance {
				t.Errorf("normalizeEmbedding() magnitude = %v, want %v", gotMag, tt.wantMag)
			}
		})
	}
}

func TestNormalizeEmbedding_ZeroVector(t *testing.T) {
	input := []float32{0, 0, 0}
	result := normalizeEmbedding(input)

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

	expectedRatio := float64(input[0]) / float64(input[1])
	gotRatio := float64(result[0]) / float64(result[1])

	if math.Abs(expectedRatio-gotRatio) > 1e-6 {
		t.Errorf("normalizeEmbedding() ratio = %v, want %v", gotRatio, expectedRatio)
	}
}

func TestToFloat32(t *testing.T) {
	input := []float64{1.0, 2.5, -3.7}
	result := toFloat32(input)

	if len(result) != len(input) {
		t.Fatalf("toFloat32() length = %d, want %d", len(result), len(input))
	}

	for i, v := range result {
		if math.Abs(float64(v)-input[i]) > 1e-6 {
			t.Errorf("toFloat32()[%d] = %v, want %v", i, v, input[i])
		}
	}
}

func TestClient_New(t *testing.T) {
	cfg := &config.Config{
		OpenAIAPIKey:       "test-api-key",
		OpenAIBaseURL:      "",
		EmbeddingModel:     "text-embedding-3-small",
		EmbeddingDimension: 1536,
	}

	client := New(cfg, nil)

	if client == nil {
		t.Fatal("New() returned nil client")
	}

	if client.Dimension() != 1536 {
		t.Errorf("Dimension() = %d, want 1536", client.Dimension())
	}
}

func TestClient_New_WithCustomBaseURL(t *testing.T) {
	cfg := &config.Config{
		OpenAIAPIKey:       "test-api-key",
		OpenAIBaseURL:      "https://custom.openai.proxy/v1",
		EmbeddingModel:     "text-embedding-3-small",
		EmbeddingDimension: 1536,
	}

	client := New(cfg, nil)

	if client == nil {
		t.Fatal("New() returned nil client")
	}
}

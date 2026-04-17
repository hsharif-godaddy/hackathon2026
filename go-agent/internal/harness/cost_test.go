package harness

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCalculateCost(t *testing.T) {
	// 1M tokens of each type with Haiku pricing
	usage := TokenUsage{
		InputTokens:         1_000_000,
		OutputTokens:        1_000_000,
		CacheCreationTokens: 1_000_000,
		CacheReadTokens:     1_000_000,
	}

	breakdown := CalculateCost("claude-haiku-4-5-20251001", usage)

	assert.InDelta(t, 1.00, breakdown.InputCost, 0.0001)
	assert.InDelta(t, 5.00, breakdown.OutputCost, 0.0001)
	assert.InDelta(t, 1.25, breakdown.CacheCreationCost, 0.0001)
	assert.InDelta(t, 0.10, breakdown.CacheReadCost, 0.0001)
	assert.InDelta(t, 7.35, breakdown.Total(), 0.0001)
}

func TestCalculateCostSonnet(t *testing.T) {
	// Partial tokens with Sonnet pricing
	usage := TokenUsage{
		InputTokens:         500_000,
		OutputTokens:        250_000,
		CacheCreationTokens: 100_000,
		CacheReadTokens:     200_000,
	}

	breakdown := CalculateCost("claude-sonnet-4-6-20250514", usage)

	// 500k * $3.00/1M = $1.50
	assert.InDelta(t, 1.50, breakdown.InputCost, 0.0001)
	// 250k * $15.00/1M = $3.75
	assert.InDelta(t, 3.75, breakdown.OutputCost, 0.0001)
	// 100k * $3.75/1M = $0.375
	assert.InDelta(t, 0.375, breakdown.CacheCreationCost, 0.0001)
	// 200k * $0.30/1M = $0.06
	assert.InDelta(t, 0.06, breakdown.CacheReadCost, 0.0001)
	assert.InDelta(t, 5.685, breakdown.Total(), 0.0001)
}

func TestCalculateCostUnknownModel(t *testing.T) {
	// Unknown model should fall back to Sonnet pricing
	usage := TokenUsage{
		InputTokens:  1_000_000,
		OutputTokens: 1_000_000,
	}

	sonnetBreakdown := CalculateCost("claude-sonnet-4-6-20250514", usage)
	unknownBreakdown := CalculateCost("claude-unknown-model", usage)

	assert.InDelta(t, sonnetBreakdown.InputCost, unknownBreakdown.InputCost, 0.0001)
	assert.InDelta(t, sonnetBreakdown.OutputCost, unknownBreakdown.OutputCost, 0.0001)
	assert.InDelta(t, sonnetBreakdown.CacheCreationCost, unknownBreakdown.CacheCreationCost, 0.0001)
	assert.InDelta(t, sonnetBreakdown.CacheReadCost, unknownBreakdown.CacheReadCost, 0.0001)
}

func TestTokenUsageAdd(t *testing.T) {
	a := TokenUsage{
		InputTokens:         100,
		OutputTokens:        200,
		CacheCreationTokens: 300,
		CacheReadTokens:     400,
	}
	b := TokenUsage{
		InputTokens:         10,
		OutputTokens:        20,
		CacheCreationTokens: 30,
		CacheReadTokens:     40,
	}

	result := a.Add(b)

	assert.Equal(t, int64(110), result.InputTokens)
	assert.Equal(t, int64(220), result.OutputTokens)
	assert.Equal(t, int64(330), result.CacheCreationTokens)
	assert.Equal(t, int64(440), result.CacheReadTokens)
}

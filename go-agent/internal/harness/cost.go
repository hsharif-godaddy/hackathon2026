package harness

// TokenUsage tracks token consumption across API calls.
type TokenUsage struct {
	InputTokens         int64 `json:"input_tokens"`
	OutputTokens        int64 `json:"output_tokens"`
	CacheCreationTokens int64 `json:"cache_creation_tokens"`
	CacheReadTokens     int64 `json:"cache_read_tokens"`
}

// Add returns the sum of two TokenUsage values.
func (t TokenUsage) Add(other TokenUsage) TokenUsage {
	return TokenUsage{
		InputTokens:         t.InputTokens + other.InputTokens,
		OutputTokens:        t.OutputTokens + other.OutputTokens,
		CacheCreationTokens: t.CacheCreationTokens + other.CacheCreationTokens,
		CacheReadTokens:     t.CacheReadTokens + other.CacheReadTokens,
	}
}

// CostBreakdown shows cost by category.
type CostBreakdown struct {
	InputCost         float64
	OutputCost        float64
	CacheCreationCost float64
	CacheReadCost     float64
}

// Total returns the sum of all costs.
func (c CostBreakdown) Total() float64 {
	return c.InputCost + c.OutputCost + c.CacheCreationCost + c.CacheReadCost
}

// modelPricing holds per-1M-token prices in USD.
type modelPricing struct {
	inputPerM         float64
	outputPerM        float64
	cacheCreationPerM float64
	cacheReadPerM     float64
}

// pricingTable maps model identifiers to their pricing.
var pricingTable = map[string]modelPricing{
	"claude-haiku-4-5-20251001": {
		inputPerM:         1.00,
		outputPerM:        5.00,
		cacheCreationPerM: 1.25,
		cacheReadPerM:     0.10,
	},
	"claude-sonnet-4-6-20250514": {
		inputPerM:         3.00,
		outputPerM:        15.00,
		cacheCreationPerM: 3.75,
		cacheReadPerM:     0.30,
	},
	"claude-sonnet-4-6": {
		inputPerM:         3.00,
		outputPerM:        15.00,
		cacheCreationPerM: 3.75,
		cacheReadPerM:     0.30,
	},
	"claude-opus-4-6-20250901": {
		inputPerM:         15.00,
		outputPerM:        75.00,
		cacheCreationPerM: 18.75,
		cacheReadPerM:     1.50,
	},
}

// defaultPricing is used when the model is not found in pricingTable.
var defaultPricing = pricingTable["claude-sonnet-4-6-20250514"]

// CalculateCost computes the USD cost for a given model and token usage.
// Unknown models default to Sonnet pricing.
func CalculateCost(model string, tokens TokenUsage) CostBreakdown {
	pricing, ok := pricingTable[model]
	if !ok {
		pricing = defaultPricing
	}

	const perM = 1_000_000.0

	return CostBreakdown{
		InputCost:         float64(tokens.InputTokens) / perM * pricing.inputPerM,
		OutputCost:        float64(tokens.OutputTokens) / perM * pricing.outputPerM,
		CacheCreationCost: float64(tokens.CacheCreationTokens) / perM * pricing.cacheCreationPerM,
		CacheReadCost:     float64(tokens.CacheReadTokens) / perM * pricing.cacheReadPerM,
	}
}

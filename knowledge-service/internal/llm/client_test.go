package llm

import (
	"testing"

	"github.com/airo-ai-builder/knowledge-service/internal/config"
)

func TestClient_New(t *testing.T) {
	cfg := &config.Config{
		OpenAIAPIKey:  "test-api-key",
		OpenAIBaseURL: "",
		LLMModel:      "gpt-4o-mini",
		LLMMaxTokens:  100,
	}

	client := New(cfg)

	if client == nil {
		t.Fatal("New() returned nil client")
	}

	if client.model != "gpt-4o-mini" {
		t.Errorf("model = %q, want %q", client.model, "gpt-4o-mini")
	}

	if client.maxTokens != 100 {
		t.Errorf("maxTokens = %d, want %d", client.maxTokens, 100)
	}
}

func TestClient_New_WithCustomBaseURL(t *testing.T) {
	cfg := &config.Config{
		OpenAIAPIKey:  "test-api-key",
		OpenAIBaseURL: "https://custom.proxy/v1",
		LLMModel:      "gpt-4o-mini",
		LLMMaxTokens:  100,
	}

	client := New(cfg)

	if client == nil {
		t.Fatal("New() returned nil client")
	}
}

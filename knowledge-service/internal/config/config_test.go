package config

import (
	"os"
	"testing"
)

var testedEnvVars = []string{
	"PORT",
	"LOG_LEVEL",
	"VERSION",
	"QDRANT_HOST",
	"QDRANT_PORT",
	"QDRANT_COLLECTION",
	"QDRANT_API_KEY",
	"QDRANT_USE_TLS",
	"OPENAI_API_KEY",
	"OPENAI_BASE_URL",
	"EMBEDDING_MODEL",
	"EMBEDDING_DIMENSION",
	"LLM_MODEL",
	"LLM_MAX_TOKENS",
	"AUTH_TYPE",
	"JWKS_URL",
	"JWT_ISSUER",
	"JWT_AUDIENCE",
	"SSO_HOST",
	"INGEST_API_KEY",
	"SEARCH_TOP_N",
	"SEARCH_PREFETCH_LIMIT",
	"SEARCH_PREFETCH_THRESHOLD",
	"SEARCH_FUSION_THRESHOLD",
	"SEARCH_FORMULA_BOOST",
	"INGEST_BATCH_SIZE",
	"INGEST_MIN_CHUNK_SIZE",
	"HTTP_READ_TIMEOUT",
	"HTTP_WRITE_TIMEOUT",
	"HTTP_IDLE_TIMEOUT",
	"RATE_LIMIT_ENABLED",
	"RATE_LIMIT_RPS",
}

func saveEnvVars(vars []string) func() {
	saved := make(map[string]string)
	unset := make(map[string]bool)

	for _, key := range vars {
		if value, exists := os.LookupEnv(key); exists {
			saved[key] = value
		} else {
			unset[key] = true
		}
	}

	return func() {
		for _, key := range vars {
			if unset[key] {
				_ = os.Unsetenv(key)
			} else if value, ok := saved[key]; ok {
				_ = os.Setenv(key, value)
			}
		}
	}
}

func TestLoadConfig_Defaults(t *testing.T) {
	restore := saveEnvVars(testedEnvVars)
	defer restore()

	for _, key := range testedEnvVars {
		_ = os.Unsetenv(key)
	}

	cfg := LoadConfig()

	if cfg.Port != 8081 {
		t.Errorf("expected default port 8081, got %d", cfg.Port)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("expected default log level info, got %s", cfg.LogLevel)
	}
	if cfg.QdrantCollection != "knowledge_base" {
		t.Errorf("expected default collection knowledge_base, got %s", cfg.QdrantCollection)
	}
	if cfg.EmbeddingModel != "text-embedding-3-small" {
		t.Errorf("expected default embedding model text-embedding-3-small, got %s", cfg.EmbeddingModel)
	}
	if cfg.EmbeddingDimension != 1536 {
		t.Errorf("expected default embedding dimension 1536, got %d", cfg.EmbeddingDimension)
	}
	if cfg.LLMModel != "gpt-4o-mini" {
		t.Errorf("expected default LLM model gpt-4o-mini, got %s", cfg.LLMModel)
	}
	if cfg.SearchTopN != 5 {
		t.Errorf("expected default search top N 5, got %d", cfg.SearchTopN)
	}
	if cfg.IngestBatchSize != 100 {
		t.Errorf("expected default ingest batch size 100, got %d", cfg.IngestBatchSize)
	}
	if cfg.RateLimitEnabled {
		t.Errorf("expected rate limiting disabled by default")
	}
}

func TestLoadConfig_FromEnv(t *testing.T) {
	restore := saveEnvVars(testedEnvVars)
	defer restore()

	_ = os.Setenv("PORT", "9090")
	_ = os.Setenv("LOG_LEVEL", "debug")
	_ = os.Setenv("QDRANT_HOST", "qdrant.example.com")
	_ = os.Setenv("SEARCH_TOP_N", "10")
	_ = os.Setenv("RATE_LIMIT_ENABLED", "true")

	cfg := LoadConfig()

	if cfg.Port != 9090 {
		t.Errorf("expected port 9090, got %d", cfg.Port)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("expected log level debug, got %s", cfg.LogLevel)
	}
	if cfg.QdrantHost != "qdrant.example.com" {
		t.Errorf("expected qdrant host qdrant.example.com, got %s", cfg.QdrantHost)
	}
	if cfg.SearchTopN != 10 {
		t.Errorf("expected search top N 10, got %d", cfg.SearchTopN)
	}
	if !cfg.RateLimitEnabled {
		t.Errorf("expected rate limiting enabled")
	}
}

package config

import (
	"os"
	"slices"
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
	"QDRANT_TLS_SKIP_VERIFY",
	"OPENAI_API_KEY",
	"OPENAI_BASE_URL",
	"EMBEDDING_MODEL",
	"EMBEDDING_DIMENSION",
	"LLM_MODEL",
	"LLM_MAX_TOKENS",
	"AUTH_TYPE",
	"SSO_HOST",
	"SEARCH_TOP_N",
	"SEARCH_MAX_CHUNKS_PER_DOC",
	"SEARCH_PREFETCH_LIMIT",
	"SEARCH_PREFETCH_THRESHOLD",
	"SEARCH_FUSION_THRESHOLD",
	"SEARCH_FORMULA_BOOST",
	"INGEST_BATCH_SIZE",
	"INGEST_MIN_CHUNK_SIZE",
	"INGEST_MAX_CHUNK_SIZE",
	"INGEST_CHUNK_OVERLAP",
	"HTTP_READ_TIMEOUT",
	"HTTP_WRITE_TIMEOUT",
	"HTTP_IDLE_TIMEOUT",
	"RATE_LIMIT_ENABLED",
	"RATE_LIMIT_RPS",
	"SERVER_CERT_PATH",
	"SERVER_KEY_PATH",
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

func TestLoadConfig_Defaults_NoAuth(t *testing.T) {
	restore := saveEnvVars(testedEnvVars)
	defer restore()

	for _, key := range testedEnvVars {
		_ = os.Unsetenv(key)
	}

	_ = os.Setenv("AUTH_TYPE", "none")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Port != 8081 {
		t.Errorf("expected default port 8081, got %d", cfg.Port)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("expected default log level info, got %s", cfg.LogLevel)
	}
	if cfg.QdrantCollection != "knowledge_base" {
		t.Errorf("expected default collection knowledge_base, got %s", cfg.QdrantCollection)
	}
	if cfg.QdrantTLSSkipVerify {
		t.Errorf("expected QdrantTLSSkipVerify to be false by default")
	}
	if cfg.EmbeddingModel != "text-embedding-3-large" {
		t.Errorf("expected default embedding model text-embedding-3-large, got %s", cfg.EmbeddingModel)
	}
	if cfg.LLMModel != "gpt-4o-mini" {
		t.Errorf("expected default LLM model gpt-4o-mini, got %s", cfg.LLMModel)
	}
	if cfg.SearchTopN != 8 {
		t.Errorf("expected default search top N 8, got %d", cfg.SearchTopN)
	}
	if cfg.SearchMaxChunksPerDoc != 3 {
		t.Errorf("expected default max chunks per doc 3, got %d", cfg.SearchMaxChunksPerDoc)
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

	for _, key := range testedEnvVars {
		_ = os.Unsetenv(key)
	}

	_ = os.Setenv("PORT", "9090")
	_ = os.Setenv("LOG_LEVEL", "debug")
	_ = os.Setenv("QDRANT_HOST", "qdrant.example.com")
	_ = os.Setenv("QDRANT_TLS_SKIP_VERIFY", "true")
	_ = os.Setenv("SEARCH_TOP_N", "10")
	_ = os.Setenv("RATE_LIMIT_ENABLED", "true")
	_ = os.Setenv("AUTH_TYPE", "none")
	_ = os.Setenv("SERVER_CERT_PATH", "/app/certs/server.crt")
	_ = os.Setenv("SERVER_KEY_PATH", "/app/certs/server.key")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Port != 9090 {
		t.Errorf("expected port 9090, got %d", cfg.Port)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("expected log level debug, got %s", cfg.LogLevel)
	}
	if cfg.QdrantHost != "qdrant.example.com" {
		t.Errorf("expected qdrant host qdrant.example.com, got %s", cfg.QdrantHost)
	}
	if !cfg.QdrantTLSSkipVerify {
		t.Errorf("expected QdrantTLSSkipVerify to be true when QDRANT_TLS_SKIP_VERIFY=true")
	}
	if cfg.SearchTopN != 10 {
		t.Errorf("expected search top N 10, got %d", cfg.SearchTopN)
	}
	if !cfg.RateLimitEnabled {
		t.Errorf("expected rate limiting enabled")
	}
	if cfg.TLSCertPath != "/app/certs/server.crt" {
		t.Errorf("expected TLSCertPath /app/certs/server.crt, got %s", cfg.TLSCertPath)
	}
	if cfg.TLSKeyPath != "/app/certs/server.key" {
		t.Errorf("expected TLSKeyPath /app/certs/server.key, got %s", cfg.TLSKeyPath)
	}
}

func TestLoadConfig_JWTWithoutSSOHost_Fails(t *testing.T) {
	restore := saveEnvVars(testedEnvVars)
	defer restore()

	for _, key := range testedEnvVars {
		_ = os.Unsetenv(key)
	}

	_ = os.Setenv("AUTH_TYPE", "jwt")

	_, err := LoadConfig()
	if err == nil {
		t.Fatal("expected error when AUTH_TYPE=jwt and SSO_HOST is unset, got nil")
	}
}

func TestLoadConfig_JWTWithSSOHost_Succeeds(t *testing.T) {
	restore := saveEnvVars(testedEnvVars)
	defer restore()

	for _, key := range testedEnvVars {
		_ = os.Unsetenv(key)
	}

	_ = os.Setenv("AUTH_TYPE", "jwt")
	_ = os.Setenv("SSO_HOST", "sso.godaddy.com")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.SSOHost != "sso.godaddy.com" {
		t.Errorf("expected SSOHost sso.godaddy.com, got %s", cfg.SSOHost)
	}
}

var newRAGEnvVars = []string{
	"EMBEDDING_DIMENSION_FAST",
	"EMBEDDING_DIMENSION_PRECISE",
	"SEARCH_LLM_ENHANCED",
	"SEARCH_QUERY_REWRITE_MODEL",
	"SEARCH_QUERY_REWRITE_MAX_TOKENS",
	"SEARCH_QUERY_REWRITE_TIMEOUT_MS",
	"SEARCH_MULTI_QUERY_COUNT",
	"SEARCH_HNSW_EF",
	"SEARCH_FUSION_LIMIT",
	"SEARCH_OVERSAMPLING",
	"SEARCH_CONFIDENCE_THRESHOLD",
	"SEARCH_CALIBRATION_MIDPOINT",
	"SEARCH_CALIBRATION_STEEPNESS",
}

func TestLoadConfig_NewRAGDefaults(t *testing.T) {
	allVars := slices.Concat(testedEnvVars, newRAGEnvVars)
	restore := saveEnvVars(allVars)
	defer restore()

	for _, key := range allVars {
		_ = os.Unsetenv(key)
	}

	_ = os.Setenv("AUTH_TYPE", "none")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.EmbeddingDimensionFast != 256 {
		t.Errorf("expected EmbeddingDimensionFast 256, got %d", cfg.EmbeddingDimensionFast)
	}
	if cfg.EmbeddingDimensionPrecise != 1024 {
		t.Errorf("expected EmbeddingDimensionPrecise 1024, got %d", cfg.EmbeddingDimensionPrecise)
	}
	if cfg.SearchLLMEnhanced {
		t.Errorf("expected SearchLLMEnhanced false by default")
	}
	if cfg.SearchQueryRewriteModel != "gpt-4o-mini" {
		t.Errorf("expected SearchQueryRewriteModel gpt-4o-mini, got %s", cfg.SearchQueryRewriteModel)
	}
	if cfg.SearchQueryRewriteMaxTokens != 150 {
		t.Errorf("expected SearchQueryRewriteMaxTokens 150, got %d", cfg.SearchQueryRewriteMaxTokens)
	}
	if cfg.SearchQueryRewriteTimeoutMs != 2000 {
		t.Errorf("expected SearchQueryRewriteTimeoutMs 2000, got %d", cfg.SearchQueryRewriteTimeoutMs)
	}
	if cfg.SearchMultiQueryCount != 3 {
		t.Errorf("expected SearchMultiQueryCount 3, got %d", cfg.SearchMultiQueryCount)
	}
	if cfg.SearchHnswEf != 256 {
		t.Errorf("expected SearchHnswEf 256, got %d", cfg.SearchHnswEf)
	}
	if cfg.SearchFusionLimit != 50 {
		t.Errorf("expected SearchFusionLimit 50, got %d", cfg.SearchFusionLimit)
	}
	if cfg.SearchOversampling != 2.5 {
		t.Errorf("expected SearchOversampling 2.5, got %f", cfg.SearchOversampling)
	}
	if cfg.SearchConfidenceThreshold != 0.2 {
		t.Errorf("expected SearchConfidenceThreshold 0.2, got %f", cfg.SearchConfidenceThreshold)
	}
	if cfg.SearchCalibrationMidpoint != 0.30 {
		t.Errorf("expected SearchCalibrationMidpoint 0.30, got %f", cfg.SearchCalibrationMidpoint)
	}
	if cfg.SearchCalibrationSteepness != 6.0 {
		t.Errorf("expected SearchCalibrationSteepness 6.0, got %f", cfg.SearchCalibrationSteepness)
	}
}

func TestLoadConfig_NewRAGOverrides(t *testing.T) {
	allVars := slices.Concat(testedEnvVars, newRAGEnvVars)
	restore := saveEnvVars(allVars)
	defer restore()

	for _, key := range allVars {
		_ = os.Unsetenv(key)
	}

	_ = os.Setenv("AUTH_TYPE", "none")
	_ = os.Setenv("EMBEDDING_DIMENSION_FAST", "512")
	_ = os.Setenv("EMBEDDING_DIMENSION_PRECISE", "2048")
	_ = os.Setenv("SEARCH_LLM_ENHANCED", "true")
	_ = os.Setenv("SEARCH_QUERY_REWRITE_MODEL", "gpt-4o")
	_ = os.Setenv("SEARCH_QUERY_REWRITE_MAX_TOKENS", "100")
	_ = os.Setenv("SEARCH_QUERY_REWRITE_TIMEOUT_MS", "1000")
	_ = os.Setenv("SEARCH_FUSION_LIMIT", "60")
	_ = os.Setenv("SEARCH_OVERSAMPLING", "3.0")
	_ = os.Setenv("SEARCH_CONFIDENCE_THRESHOLD", "0.6")
	_ = os.Setenv("SEARCH_CALIBRATION_MIDPOINT", "0.7")
	_ = os.Setenv("SEARCH_CALIBRATION_STEEPNESS", "15.0")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.EmbeddingDimensionFast != 512 {
		t.Errorf("expected EmbeddingDimensionFast 512, got %d", cfg.EmbeddingDimensionFast)
	}
	if cfg.EmbeddingDimensionPrecise != 2048 {
		t.Errorf("expected EmbeddingDimensionPrecise 2048, got %d", cfg.EmbeddingDimensionPrecise)
	}
	if !cfg.SearchLLMEnhanced {
		t.Errorf("expected SearchLLMEnhanced true")
	}
	if cfg.SearchQueryRewriteModel != "gpt-4o" {
		t.Errorf("expected SearchQueryRewriteModel gpt-4o, got %s", cfg.SearchQueryRewriteModel)
	}
	if cfg.SearchQueryRewriteMaxTokens != 100 {
		t.Errorf("expected SearchQueryRewriteMaxTokens 100, got %d", cfg.SearchQueryRewriteMaxTokens)
	}
	if cfg.SearchQueryRewriteTimeoutMs != 1000 {
		t.Errorf("expected SearchQueryRewriteTimeoutMs 1000, got %d", cfg.SearchQueryRewriteTimeoutMs)
	}
	if cfg.SearchFusionLimit != 60 {
		t.Errorf("expected SearchFusionLimit 60, got %d", cfg.SearchFusionLimit)
	}
	if cfg.SearchOversampling != 3.0 {
		t.Errorf("expected SearchOversampling 3.0, got %f", cfg.SearchOversampling)
	}
	if cfg.SearchConfidenceThreshold != 0.6 {
		t.Errorf("expected SearchConfidenceThreshold 0.6, got %f", cfg.SearchConfidenceThreshold)
	}
	if cfg.SearchCalibrationMidpoint != 0.7 {
		t.Errorf("expected SearchCalibrationMidpoint 0.7, got %f", cfg.SearchCalibrationMidpoint)
	}
	if cfg.SearchCalibrationSteepness != 15.0 {
		t.Errorf("expected SearchCalibrationSteepness 15.0, got %f", cfg.SearchCalibrationSteepness)
	}
}

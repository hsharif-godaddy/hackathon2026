package config

import (
	"errors"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

// Config holds all service configuration loaded from environment variables.
type Config struct {
	// Service
	Port     int
	LogLevel string
	Version  string

	// Qdrant
	QdrantHost          string
	QdrantPort          int
	QdrantCollection    string
	QdrantAPIKey        string
	QdrantUseTLS        bool
	QdrantTLSSkipVerify bool

	// OpenAI (Embeddings)
	OpenAIAPIKey   string
	OpenAIBaseURL  string
	EmbeddingModel string

	// LLM (Contextual Retrieval)
	LLMModel     string
	LLMMaxTokens int

	// Auth
	AuthType string
	SSOHost  string

	// GoCode S2S
	GoCodeRoleARN string
	GoCodeBaseURL string

	// Search defaults
	SearchTopN              int
	SearchMaxChunksPerDoc   int
	SearchPrefetchLimit     int
	SearchPrefetchThreshold float32

	// Embedding dimensions (multi-vector)
	EmbeddingDimensionFast    int
	EmbeddingDimensionPrecise int

	// LLM-enhanced search (HyDE + multi-query, single toggle)
	SearchLLMEnhanced           bool
	SearchQueryRewriteModel     string
	SearchQueryRewriteMaxTokens int
	SearchQueryRewriteTimeoutMs int
	SearchMultiQueryCount       int

	// Search HNSW
	SearchHnswEf int

	// Search fusion / scoring
	SearchFusionLimit          int
	SearchOversampling         float32
	SearchConfidenceThreshold  float32
	SearchCalibrationMidpoint  float32
	SearchCalibrationSteepness float32

	// Ingest
	IngestBatchSize    int
	IngestMinChunkSize int
	IngestMaxChunkSize int
	IngestChunkOverlap int

	// Server TLS
	TLSCertPath string
	TLSKeyPath  string

	// HTTP Server timeouts
	HTTPReadTimeout   int
	HTTPWriteTimeout  int
	HTTPIdleTimeout   int
	HTTPSearchTimeout int

	// Rate limiting
	RateLimitEnabled bool
	RateLimitRPS     int
}

// LoadConfig loads configuration from environment variables, applying sensible defaults
// for any values not explicitly set. Returns an error if auth configuration is invalid.
func LoadConfig() (*Config, error) {
	cfg := &Config{
		// Service
		Port:     getEnvInt("PORT", 8081),
		LogLevel: getEnvString("LOG_LEVEL", "info"),
		Version:  getEnvString("VERSION", "dev"),

		// Qdrant (use 127.0.0.1 to avoid IPv6 timeout when Docker only binds IPv4)
		QdrantHost:          getEnvString("QDRANT_HOST", "127.0.0.1"),
		QdrantPort:          getEnvInt("QDRANT_PORT", 6334),
		QdrantCollection:    getEnvString("QDRANT_COLLECTION", "knowledge_base"),
		QdrantAPIKey:        getEnvString("QDRANT_API_KEY", ""),
		QdrantUseTLS:        getEnvBool("QDRANT_USE_TLS", false),
		QdrantTLSSkipVerify: getEnvBool("QDRANT_TLS_SKIP_VERIFY", false),

		// OpenAI (Embeddings)
		OpenAIAPIKey:   getEnvString("OPENAI_API_KEY", ""),
		OpenAIBaseURL:  getEnvString("OPENAI_BASE_URL", ""),
		EmbeddingModel: getEnvString("EMBEDDING_MODEL", "text-embedding-3-large"),

		// LLM (Contextual Retrieval)
		LLMModel:     getEnvString("LLM_MODEL", "gpt-4o-mini"),
		LLMMaxTokens: getEnvInt("LLM_MAX_TOKENS", 200),

		// Auth
		AuthType: getEnvString("AUTH_TYPE", "jwt"),
		SSOHost:  getEnvString("SSO_HOST", ""),

		// GoCode S2S
		GoCodeRoleARN: getEnvString("GOCODE_ROLE_ARN", ""),
		GoCodeBaseURL: getEnvString("GOCODE_BASE_URL", ""),

		// Search defaults
		SearchTopN:              getEnvInt("SEARCH_TOP_N", 8),
		SearchMaxChunksPerDoc:   getEnvInt("SEARCH_MAX_CHUNKS_PER_DOC", 3),
		SearchPrefetchLimit:     getEnvInt("SEARCH_PREFETCH_LIMIT", 100),
		SearchPrefetchThreshold: getEnvFloat32("SEARCH_PREFETCH_THRESHOLD", 0.15),

		// Embedding dimensions (multi-vector)
		EmbeddingDimensionFast:    getEnvInt("EMBEDDING_DIMENSION_FAST", 256),
		EmbeddingDimensionPrecise: getEnvInt("EMBEDDING_DIMENSION_PRECISE", 1024),

		// LLM-enhanced search (HyDE + multi-query, single toggle)
		SearchLLMEnhanced:           getEnvBool("SEARCH_LLM_ENHANCED", false),
		SearchQueryRewriteModel:     getEnvString("SEARCH_QUERY_REWRITE_MODEL", "gpt-4o-mini"),
		SearchQueryRewriteMaxTokens: getEnvInt("SEARCH_QUERY_REWRITE_MAX_TOKENS", 150),
		SearchQueryRewriteTimeoutMs: getEnvInt("SEARCH_QUERY_REWRITE_TIMEOUT_MS", 2000),
		SearchMultiQueryCount:       getEnvInt("SEARCH_MULTI_QUERY_COUNT", 3),

		// Search HNSW
		SearchHnswEf: getEnvInt("SEARCH_HNSW_EF", 256),

		// Search fusion / scoring
		SearchFusionLimit:          getEnvInt("SEARCH_FUSION_LIMIT", 50),
		SearchOversampling:         getEnvFloat32("SEARCH_OVERSAMPLING", 2.5),
		SearchConfidenceThreshold:  getEnvFloat32("SEARCH_CONFIDENCE_THRESHOLD", 0.2),
		SearchCalibrationMidpoint:  getEnvFloat32("SEARCH_CALIBRATION_MIDPOINT", 0.30),
		SearchCalibrationSteepness: getEnvFloat32("SEARCH_CALIBRATION_STEEPNESS", 6.0),

		// Ingest
		IngestBatchSize:    getEnvInt("INGEST_BATCH_SIZE", 100),
		IngestMinChunkSize: getEnvInt("INGEST_MIN_CHUNK_SIZE", 400),
		IngestMaxChunkSize: getEnvInt("INGEST_MAX_CHUNK_SIZE", 3200),
		IngestChunkOverlap: getEnvInt("INGEST_CHUNK_OVERLAP", 320),

		// TLS
		TLSCertPath: getEnvString("SERVER_CERT_PATH", ""),
		TLSKeyPath:  getEnvString("SERVER_KEY_PATH", ""),

		// HTTP Server timeouts (seconds)
		HTTPReadTimeout:   getEnvInt("HTTP_READ_TIMEOUT", 30),
		HTTPWriteTimeout:  getEnvInt("HTTP_WRITE_TIMEOUT", 60),
		HTTPIdleTimeout:   getEnvInt("HTTP_IDLE_TIMEOUT", 120),
		HTTPSearchTimeout: getEnvInt("HTTP_SEARCH_TIMEOUT", 15),

		// Rate limiting
		RateLimitEnabled: getEnvBool("RATE_LIMIT_ENABLED", false),
		RateLimitRPS:     getEnvInt("RATE_LIMIT_RPS", 50),
	}

	if cfg.AuthType == "jwt" && cfg.SSOHost == "" {
		return nil, errors.New("SSO_HOST must be set when AUTH_TYPE=jwt")
	}

	if cfg.IngestMaxChunkSize > 0 && cfg.IngestChunkOverlap >= cfg.IngestMaxChunkSize {
		slog.Warn("config.invalid.chunk_overlap",
			"IngestChunkOverlap", cfg.IngestChunkOverlap,
			"IngestMaxChunkSize", cfg.IngestMaxChunkSize,
			"hint", "overlap will be silently reduced to maxChars/4 inside slidingWindow; set INGEST_CHUNK_OVERLAP < INGEST_MAX_CHUNK_SIZE")
	}

	return cfg, nil
}

func getEnvString(key, defaultValue string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}

func getEnvFloat32(key string, defaultValue float32) float32 {
	if value := os.Getenv(key); value != "" {
		if floatVal, err := strconv.ParseFloat(value, 32); err == nil {
			return float32(floatVal)
		}
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool { //nolint:unparam // defaultValue is always false today but the signature should stay generic
	if value := os.Getenv(key); value != "" {
		if boolVal, err := strconv.ParseBool(value); err == nil {
			return boolVal
		}
	}
	return defaultValue
}

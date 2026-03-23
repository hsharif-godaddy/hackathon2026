package config

import (
	"errors"
	"log/slog"
	"os"
	"strconv"
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
	OpenAIAPIKey       string
	OpenAIBaseURL      string
	EmbeddingModel     string
	EmbeddingDimension int

	// LLM (Contextual Retrieval)
	LLMModel     string
	LLMMaxTokens int

	// Auth
	AuthType string
	SSOHost  string

	// Search defaults
	SearchTopN              int
	SearchPrefetchLimit     int
	SearchPrefetchThreshold float32
	SearchFusionThreshold   float32
	SearchFormulaBoost      float32

	// Ingest
	IngestBatchSize    int
	IngestMinChunkSize int
	IngestMaxChunkSize int
	IngestChunkOverlap int

	// Server TLS
	TLSCertPath string
	TLSKeyPath  string

	// HTTP Server timeouts
	HTTPReadTimeout  int
	HTTPWriteTimeout int
	HTTPIdleTimeout  int

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
		OpenAIAPIKey:       getEnvString("OPENAI_API_KEY", ""),
		OpenAIBaseURL:      getEnvString("OPENAI_BASE_URL", ""),
		EmbeddingModel:     getEnvString("EMBEDDING_MODEL", "text-embedding-3-small"),
		EmbeddingDimension: getEnvInt("EMBEDDING_DIMENSION", 1536),

		// LLM (Contextual Retrieval)
		LLMModel:     getEnvString("LLM_MODEL", "gpt-4o-mini"),
		LLMMaxTokens: getEnvInt("LLM_MAX_TOKENS", 100),

		// Auth
		AuthType: getEnvString("AUTH_TYPE", "jwt"),
		SSOHost:  getEnvString("SSO_HOST", ""),

		// Search defaults
		SearchTopN:              getEnvInt("SEARCH_TOP_N", 5),
		SearchPrefetchLimit:     getEnvInt("SEARCH_PREFETCH_LIMIT", 20),
		SearchPrefetchThreshold: getEnvFloat32("SEARCH_PREFETCH_THRESHOLD", 0.25),
		SearchFusionThreshold:   getEnvFloat32("SEARCH_FUSION_THRESHOLD", 0.4),
		SearchFormulaBoost:      getEnvFloat32("SEARCH_FORMULA_BOOST", 0.05),

		// Ingest
		IngestBatchSize:    getEnvInt("INGEST_BATCH_SIZE", 100),
		IngestMinChunkSize: getEnvInt("INGEST_MIN_CHUNK_SIZE", 100),
		IngestMaxChunkSize: getEnvInt("INGEST_MAX_CHUNK_SIZE", 1500),
		IngestChunkOverlap: getEnvInt("INGEST_CHUNK_OVERLAP", 150),

		// TLS
		TLSCertPath: getEnvString("SERVER_CERT_PATH", ""),
		TLSKeyPath:  getEnvString("SERVER_KEY_PATH", ""),

		// HTTP Server timeouts (seconds)
		HTTPReadTimeout:  getEnvInt("HTTP_READ_TIMEOUT", 30),
		HTTPWriteTimeout: getEnvInt("HTTP_WRITE_TIMEOUT", 60),
		HTTPIdleTimeout:  getEnvInt("HTTP_IDLE_TIMEOUT", 120),

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
	if value := os.Getenv(key); value != "" {
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

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolVal, err := strconv.ParseBool(value); err == nil {
			return boolVal
		}
	}
	return defaultValue
}

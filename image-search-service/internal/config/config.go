// Package config provides configuration loading from environment variables.
package config

import (
	"os"
	"strconv"
)

// Config holds all service configuration loaded from environment variables.
// It provides settings for the HTTP server, external APIs (Getty, Anthropic),
// storage backends (Qdrant, S3), SSO authentication, and APM telemetry.
type Config struct {
	// Service
	Port     int
	LogLevel string

	// Getty API (via airo-builder proxy)
	GettyUpstream     string
	GettyToken        string // Bearer token for proxy auth (from GETTY_TOKEN)
	GettyXAppKey      string // x-app-key header value (identifies calling app)
	GettyRateLimitRPS int
	GettyConcurrency  int

	// Haiku/Anthropic
	AnthropicAPIURL   string
	AnthropicAPIKey   string
	HaikuRateLimitRPS int
	HaikuConcurrency  int

	// OpenAI (Embeddings)
	OpenAIAPIKey  string
	OpenAIBaseURL string

	// Qdrant
	QdrantHost       string
	QdrantPort       int
	QdrantCollection string
	QdrantAPIKey     string

	// S3
	S3Bucket string
	S3Region string
	S3Prefix string

	// Response behavior
	DefaultMinCached   int
	DefaultMaxWaitSecs int
	MinRelevanceScore  float32

	// SSO
	SSOHost string

	// APM
	APMServerURL   string
	APMServiceName string
	APMEnvironment string
}

// LoadConfig loads configuration from environment variables, applying sensible defaults
// for any values not explicitly set. This function should be called once at service startup.
func LoadConfig() *Config {
	return &Config{
		// Service
		Port:     getEnvInt("PORT", 8080),
		LogLevel: getEnvString("LOG_LEVEL", "info"),

		// Getty API (via airo-builder proxy)
		GettyUpstream:     getEnvString("GETTY_UPSTREAM", "https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net"),
		GettyToken:        getEnvString("GETTY_TOKEN", ""),
		GettyXAppKey:      getEnvString("GETTY_X_APP_KEY", "image-search-service"),
		GettyRateLimitRPS: getEnvInt("GETTY_RATE_LIMIT_RPS", 50),
		GettyConcurrency:  getEnvInt("GETTY_CONCURRENCY", 10),

		// Haiku
		AnthropicAPIURL:   getEnvString("ANTHROPIC_API_URL", "https://api.anthropic.com"),
		AnthropicAPIKey:   getEnvString("ANTHROPIC_API_KEY", ""),
		HaikuRateLimitRPS: getEnvInt("HAIKU_RATE_LIMIT_RPS", 20),
		HaikuConcurrency:  getEnvInt("HAIKU_CONCURRENCY", 5),

		// OpenAI (Embeddings)
		OpenAIAPIKey:  getEnvString("OPENAI_API_KEY", ""),
		OpenAIBaseURL: getEnvString("OPENAI_BASE_URL", ""),

		// Qdrant (use 127.0.0.1 to avoid IPv6 timeout when Docker only binds IPv4)
		QdrantHost:       getEnvString("QDRANT_HOST", "127.0.0.1"),
		QdrantPort:       getEnvInt("QDRANT_PORT", 6334),
		QdrantCollection: getEnvString("QDRANT_COLLECTION", "image_analyses"),
		QdrantAPIKey:     getEnvString("QDRANT_API_KEY", ""),

		// S3
		S3Bucket: getEnvString("S3_BUCKET", ""),
		S3Region: getEnvString("S3_REGION", "us-west-2"),
		S3Prefix: getEnvString("S3_PREFIX", "analyses/v1"),

		// Response behavior
		DefaultMinCached:   getEnvInt("DEFAULT_MIN_CACHED", 5),
		DefaultMaxWaitSecs: getEnvInt("DEFAULT_MAX_WAIT_SECONDS", 30),
		MinRelevanceScore:  getEnvFloat32("MIN_RELEVANCE_SCORE", 0.5),

		// SSO
		SSOHost: getEnvString("SSO_HOST", "sso.godaddy.com"),

		// APM
		APMServerURL:   getEnvString("ELASTIC_APM_SERVER_URL", ""),
		APMServiceName: getEnvString("ELASTIC_APM_SERVICE_NAME", "image-search-service"),
		APMEnvironment: getEnvString("ELASTIC_APM_ENVIRONMENT", "dev"),
	}
}

// getEnvString returns the value of the environment variable key, or defaultValue if not set or empty.
func getEnvString(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvInt returns the integer value of the environment variable key, or defaultValue if not set,
// empty, or not a valid integer.
func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}

// getEnvFloat32 returns the float32 value of the environment variable key, or defaultValue if not set,
// empty, or not a valid float.
func getEnvFloat32(key string, defaultValue float32) float32 {
	if value := os.Getenv(key); value != "" {
		if floatVal, err := strconv.ParseFloat(value, 32); err == nil {
			return float32(floatVal)
		}
	}
	return defaultValue
}

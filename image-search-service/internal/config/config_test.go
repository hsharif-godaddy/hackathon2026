package config

import (
	"os"
	"testing"
)

// testedEnvVars lists all environment variables used by the config package.
// Tests save and restore these to avoid affecting other tests or parallel test runs.
var testedEnvVars = []string{
	"PORT",
	"LOG_LEVEL",
	"GETTY_UPSTREAM",
	"GETTY_APP_KEY",
	"GETTY_RATE_LIMIT_RPS",
	"GETTY_CONCURRENCY",
	"ANTHROPIC_API_URL",
	"HAIKU_RATE_LIMIT_RPS",
	"HAIKU_CONCURRENCY",
	"QDRANT_HOST",
	"QDRANT_PORT",
	"QDRANT_COLLECTION",
	"QDRANT_API_KEY",
	"S3_BUCKET",
	"S3_REGION",
	"S3_PREFIX",
	"DEFAULT_MIN_CACHED",
	"DEFAULT_MAX_WAIT_SECONDS",
	"SSO_HOST",
	"ELASTIC_APM_SERVER_URL",
	"ELASTIC_APM_SERVICE_NAME",
	"ELASTIC_APM_ENVIRONMENT",
}

// saveEnvVars saves the current values of the specified environment variables
// and returns a function to restore them.
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
	// Save and restore env vars to avoid affecting other tests
	restore := saveEnvVars(testedEnvVars)
	defer restore()

	// Clear only the env vars we test
	for _, key := range testedEnvVars {
		_ = os.Unsetenv(key)
	}

	cfg := LoadConfig()

	if cfg.Port != 8080 {
		t.Errorf("expected default port 8080, got %d", cfg.Port)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("expected default log level info, got %s", cfg.LogLevel)
	}
	if cfg.QdrantCollection != "image_analyses_v3" {
		t.Errorf("expected default collection image_analyses_v3, got %s", cfg.QdrantCollection)
	}
}

func TestLoadConfig_FromEnv(t *testing.T) {
	// Save and restore env vars to avoid affecting other tests
	restore := saveEnvVars(testedEnvVars)
	defer restore()

	_ = os.Setenv("PORT", "9090")
	_ = os.Setenv("LOG_LEVEL", "debug")
	_ = os.Setenv("QDRANT_HOST", "qdrant.example.com")

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
}

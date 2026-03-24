package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
)

// Config holds the environment-based configuration for the Go agent.
type Config struct {
	Port             string // HTTP server port. Default: "4000".
	AnthropicAPIKey  string // Required. Anthropic API key.
	DatabasePath     string // SQLite database path. Default: "data/agents.db".
	AppRootPath      string // Root path for app workspaces. Default: "/tmp/airo-app-builder".
	BridgeSocketPath string // Unix socket for TS bridge. Default: "/tmp/ts-bridge.sock".
	LogLevel         string // Log level (debug, info, warn, error). Default: "info".
	MultiTenant      bool   // Enable multi-tenant mode. Default: false.
}

// ErrMissingRequired is returned when a required config value is not set.
var ErrMissingRequired = errors.New("missing required config")

// Load reads configuration from environment variables, applies defaults,
// and validates required fields.
func Load() (*Config, error) {
	cfg := &Config{
		Port:             envOr("PORT", "4000"),
		AnthropicAPIKey:  os.Getenv("ANTHROPIC_API_KEY"),
		DatabasePath:     envOr("DATABASE_PATH", "data/agents.db"),
		AppRootPath:      envOr("APP_ROOT_PATH", "/tmp/airo-app-builder"),
		BridgeSocketPath: envOr("TS_BRIDGE_SOCKET_PATH", "/tmp/ts-bridge.sock"),
		LogLevel:         envOr("LOG_LEVEL", "info"),
		MultiTenant:      envBool("MULTI_TENANT"),
	}

	if cfg.AnthropicAPIKey == "" {
		return nil, fmt.Errorf("ANTHROPIC_API_KEY: %w", ErrMissingRequired)
	}

	return cfg, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envBool(key string) bool {
	v, _ := strconv.ParseBool(os.Getenv(key))
	return v
}

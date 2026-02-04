package httpproxy

import (
	"log/slog"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
)

// NewHTTPProxy creates a new HTTP proxy instance.
func NewHTTPProxy(cfg Config) *HTTPProxy {
	// Set defaults for retry configuration from environment variables or use hardcoded defaults
	if cfg.MaxRetries == 0 {
		envMaxRetries := config.GetEnvIntWithDefault("DEV_SUPERVISOR_PROXY_MAX_RETRIES", 5)
		if envMaxRetries <= 0 {
			slog.Warn("invalid DEV_SUPERVISOR_PROXY_MAX_RETRIES value, using default", "invalid_value", envMaxRetries)
			cfg.MaxRetries = 5
		} else {
			cfg.MaxRetries = envMaxRetries
		}
	}

	if cfg.InitialBackoff == 0 {
		envInitialBackoffMs := config.GetEnvIntWithDefault("DEV_SUPERVISOR_PROXY_INITIAL_BACKOFF_MS", 100)
		if envInitialBackoffMs <= 0 {
			slog.Warn(
				"invalid DEV_SUPERVISOR_PROXY_INITIAL_BACKOFF_MS value, using default",
				"invalid_value",
				envInitialBackoffMs,
			)
			envInitialBackoffMs = 100
		}
		cfg.InitialBackoff = time.Duration(envInitialBackoffMs) * time.Millisecond
	}

	if cfg.MaxBackoff == 0 {
		envMaxBackoffMs := config.GetEnvIntWithDefault("DEV_SUPERVISOR_PROXY_MAX_BACKOFF_MS", 2000)
		if envMaxBackoffMs <= 0 {
			slog.Warn(
				"invalid DEV_SUPERVISOR_PROXY_MAX_BACKOFF_MS value, using default",
				"invalid_value",
				envMaxBackoffMs,
			)
			envMaxBackoffMs = 2000
		}
		cfg.MaxBackoff = time.Duration(envMaxBackoffMs) * time.Millisecond
	}

	slog.Info("HTTP proxy retry configuration",
		slog.GroupAttrs("retry",
			slog.Int("max", cfg.MaxRetries),
			slog.Duration("initial_backoff", cfg.InitialBackoff),
			slog.Duration("max_backoff", cfg.MaxBackoff),
		),
	)

	return &HTTPProxy{
		config:  cfg,
		running: false,
	}
}

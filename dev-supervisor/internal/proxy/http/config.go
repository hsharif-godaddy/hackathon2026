package httpproxy

import (
	"log/slog"
	"os"
	"strconv"
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

	// Connection-flood / abuse protection knobs. These are env-only (the caller
	// in main.go does not set them), so we read unconditionally: an explicit 0
	// (or 0s) intentionally disables that layer, while a negative value is
	// invalid and falls back to the default.
	// 90s default: anchored just under Cloudflare's ~100s origin timeout (the
	// edge returns a 524 past that, so a larger value would never fire) while
	// still accommodating legitimate synchronous endpoints that compute for up
	// to ~60s before flushing response headers. The connection caps below are
	// the primary exhaustion defense; this timeout is a secondary mechanism that
	// recycles stuck sockets faster than the edge cancel.
	cfg.ResponseHeaderTimeout = durationEnvWithDefault(
		"DEV_SUPERVISOR_PROXY_RESPONSE_HEADER_TIMEOUT", 90*time.Second)
	cfg.ReadHeaderTimeout = durationEnvWithDefault(
		"DEV_SUPERVISOR_PROXY_READ_HEADER_TIMEOUT", 15*time.Second)
	cfg.MaxHeaderBytes = nonNegIntEnvWithDefault(
		"DEV_SUPERVISOR_PROXY_MAX_HEADER_BYTES", 1<<20)
	cfg.MaxConnections = nonNegIntEnvWithDefault(
		"DEV_SUPERVISOR_PROXY_MAX_CONNECTIONS", 4096)
	cfg.MaxConnsPerIP = nonNegIntEnvWithDefault(
		"DEV_SUPERVISOR_PROXY_MAX_CONNS_PER_IP", 100)

	slog.Info("HTTP proxy protection configuration",
		slog.GroupAttrs("protection",
			slog.Duration("response_header_timeout", cfg.ResponseHeaderTimeout),
			slog.Duration("read_header_timeout", cfg.ReadHeaderTimeout),
			slog.Int("max_header_bytes", cfg.MaxHeaderBytes),
			slog.Int("max_connections", cfg.MaxConnections),
			slog.Int("max_conns_per_ip", cfg.MaxConnsPerIP),
		),
	)

	return &HTTPProxy{
		config:  cfg,
		running: false,
	}
}

// durationEnvWithDefault reads a duration env var, preserving an explicit 0
// (which disables the associated timeout) but rejecting negative values. Unlike
// config.GetEnvDurationWithDefault it does not silently swallow parse errors: a
// set-but-unparseable value (e.g. "90" missing the unit suffix) is the common
// operator typo, so it is logged with the raw value before falling back.
func durationEnvWithDefault(key string, defaultValue time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return defaultValue
	}

	value, err := time.ParseDuration(raw)
	if err != nil {
		slog.Warn("unparseable proxy protection duration, using default",
			"env", key, "raw_value", raw, "default", defaultValue, "error", err.Error())
		return defaultValue
	}
	if value < 0 {
		slog.Warn("negative proxy protection duration, using default",
			"env", key, "raw_value", raw, "default", defaultValue)
		return defaultValue
	}
	return value
}

// nonNegIntEnvWithDefault reads an int env var, preserving an explicit 0 (which
// disables the associated limit) but rejecting negative values. Like
// durationEnvWithDefault it logs a set-but-unparseable value rather than
// silently using the default, so a typo'd tuning value is not invisible.
func nonNegIntEnvWithDefault(key string, defaultValue int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return defaultValue
	}

	value, err := strconv.Atoi(raw)
	if err != nil {
		slog.Warn("unparseable proxy protection limit, using default",
			"env", key, "raw_value", raw, "default", defaultValue, "error", err.Error())
		return defaultValue
	}
	if value < 0 {
		slog.Warn("negative proxy protection limit, using default",
			"env", key, "raw_value", raw, "default", defaultValue)
		return defaultValue
	}
	return value
}

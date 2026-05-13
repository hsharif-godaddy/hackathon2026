// Package config reads env for cmd/server.
package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

// Environment is the Airo env this process is running in. Surfaced in /health.
type Environment string

const (
	EnvLocal Environment = "local"
	EnvDev   Environment = "dev"
	EnvTest  Environment = "test"
	EnvProd  Environment = "prod"
)

// Config is process env for the HTTP server.
type Config struct {
	Addr             string
	Environment      Environment
	LogLevel         string
	LogFormat        string
	HTTPReadTimeout  time.Duration
	HTTPWriteTimeout time.Duration
	HTTPIdleTimeout  time.Duration
	ShutdownTimeout  time.Duration
	TLSCertPath      string
	TLSKeyPath       string
	AuthType         string // "jwt" (default) or "none" (local dev bypass)
	SSOHost          string // GoDaddy SSO hostname; required when AuthType=jwt

	// MHPAiro groups config for the outbound mhp-airo control-plane client
	// (see internal/mhpairo). Kept as a sub-struct so future additions
	// (health-probe path, per-endpoint overrides) don't sprawl at the top.
	MHPAiro MHPAiroConfig
}

// MHPAiroConfig is the env-driven config for internal/mhpairo.Client.
type MHPAiroConfig struct {
	// BaseURL is the mhp-airo API root, up to and including "/api/airo/v1".
	// Required when AuthType=jwt; defaults to local-control-plane when unset.
	BaseURL string

	// Timeout is the per-request HTTP timeout passed to the client.
	Timeout time.Duration

	// Auth is "awsiam" (mint an AWS-IAM JWT via gd-auth-lib) or "none"
	// (attach no Authorization header; for local-control-plane dev, which
	// runs with AUTH_TYPE=none). Defaults mirror the top-level AuthType:
	// jwt→awsiam, none→none.
	Auth string
}

// ResourceNames holds the fully-qualified AWS resource names for this env,
// mirroring what AiroStripeServiceStack provisions. Kept out of handlers so
// the naming convention has one source of truth.
type ResourceNames struct {
	SandboxesTable       string
	EventsTable          string
	PlatformKeySecret    string
	WebhookSigningSecret string
	ManagedKeysAlias     string
}

// ResourceNames returns the AWS resource names for this env. Environment=local
// maps to the dev account's names so SSO'd devs can probe real dev resources.
func (c Config) ResourceNames() ResourceNames {
	env := string(c.Environment)
	if c.Environment == EnvLocal {
		env = string(EnvDev)
	}
	return ResourceNames{
		SandboxesTable:       env + "-airo-stripe-sandboxes",
		EventsTable:          env + "-airo-stripe-events",
		PlatformKeySecret:    env + "-airo-stripe-platform-key",
		WebhookSigningSecret: env + "-airo-stripe-webhook-signing",
		ManagedKeysAlias:     "alias/" + env + "-airo-stripe-managed-keys",
	}
}

// Load reads env, applies defaults, validates. Returns error on any invalid
// value. Unset env vars fall back to documented defaults; vars that are set but
// unparseable (bad enum, bad duration, bad port) produce a descriptive error.
func Load() (Config, error) {
	cfg := Config{
		Addr:        getEnv("STRIPE_SERVICE_ADDR", ":8443"),
		TLSCertPath: os.Getenv("SERVER_CERT_PATH"),
		TLSKeyPath:  os.Getenv("SERVER_KEY_PATH"),
	}

	var err error
	if cfg.HTTPReadTimeout, err = getEnvDuration("HTTP_READ_TIMEOUT", 30*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.HTTPWriteTimeout, err = getEnvDuration("HTTP_WRITE_TIMEOUT", 60*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.HTTPIdleTimeout, err = getEnvDuration("HTTP_IDLE_TIMEOUT", 120*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.ShutdownTimeout, err = getEnvDuration("SHUTDOWN_TIMEOUT", 15*time.Second); err != nil {
		return Config{}, err
	}

	if cfg.Environment, err = parseEnvironment(getEnv("ENVIRONMENT", "local")); err != nil {
		return Config{}, err
	}
	if cfg.LogLevel, err = parseLogLevel(getEnv("LOG_LEVEL", "info")); err != nil {
		return Config{}, err
	}
	if cfg.LogFormat, err = parseLogFormat(getEnv("LOG_FORMAT", "json")); err != nil {
		return Config{}, err
	}
	if err := validateAddr(cfg.Addr); err != nil {
		return Config{}, err
	}
	if (cfg.TLSCertPath != "") != (cfg.TLSKeyPath != "") {
		return Config{}, fmt.Errorf("SERVER_CERT_PATH and SERVER_KEY_PATH must both be set or both empty")
	}
	if cfg.AuthType, err = parseAuthType(getEnv("AUTH_TYPE", "jwt")); err != nil {
		return Config{}, err
	}
	cfg.SSOHost = strings.TrimSpace(os.Getenv("SSO_HOST"))
	if cfg.AuthType == "jwt" && cfg.SSOHost == "" {
		return Config{}, fmt.Errorf("SSO_HOST must be set when AUTH_TYPE=jwt")
	}

	if cfg.MHPAiro, err = loadMHPAiroConfig(cfg.AuthType); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

// loadMHPAiroConfig reads the MHP_AIRO_* env vars. Defaults are env-aware:
// with AUTH_TYPE=none we assume local-control-plane on :4100; with
// AUTH_TYPE=jwt a BaseURL must be set explicitly (no sane default to guess
// between dev/test/prod mhp-airo hosts).
func loadMHPAiroConfig(authType string) (MHPAiroConfig, error) {
	out := MHPAiroConfig{
		BaseURL: strings.TrimSpace(os.Getenv("MHP_AIRO_BASE_URL")),
		Auth:    strings.ToLower(strings.TrimSpace(os.Getenv("MHP_AIRO_AUTH"))),
	}

	timeout, err := getEnvDuration("MHP_AIRO_TIMEOUT", 30*time.Second)
	if err != nil {
		return MHPAiroConfig{}, err
	}
	out.Timeout = timeout

	if out.BaseURL == "" {
		if authType == "none" {
			out.BaseURL = "http://localhost:4100/api/airo/v1"
		} else {
			return MHPAiroConfig{}, fmt.Errorf("MHP_AIRO_BASE_URL must be set when AUTH_TYPE=jwt")
		}
	}

	if out.Auth == "" {
		// Mirror the top-level auth type: jwt→awsiam (mint real tokens),
		// none→none (skip auth; matches local-control-plane).
		if authType == "jwt" {
			out.Auth = "awsiam"
		} else {
			out.Auth = "none"
		}
	}
	switch out.Auth {
	case "awsiam", "none":
		// ok
	default:
		return MHPAiroConfig{}, fmt.Errorf("MHP_AIRO_AUTH must be one of awsiam|none; got %q", out.Auth)
	}

	return out, nil
}

func parseAuthType(s string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(s))
	switch normalized {
	case "jwt", "none":
		return normalized, nil
	default:
		return "", fmt.Errorf("AUTH_TYPE must be one of jwt|none; got %q", s)
	}
}

// Enum parsers trim surrounding whitespace (and lowercase where the value is
// case-insensitive) and return the normalized form so downstream code can rely
// on exact-string comparisons.

func parseEnvironment(s string) (Environment, error) {
	trimmed := strings.TrimSpace(s)
	switch Environment(trimmed) {
	case EnvLocal, EnvDev, EnvTest, EnvProd:
		return Environment(trimmed), nil
	default:
		return "", fmt.Errorf("ENVIRONMENT must be one of local|dev|test|prod; got %q", s)
	}
}

func parseLogLevel(s string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(s))
	switch normalized {
	case "debug", "info", "warn", "warning", "error":
		return normalized, nil
	default:
		return "", fmt.Errorf("LOG_LEVEL must be one of debug|info|warn|error; got %q", s)
	}
}

func parseLogFormat(s string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(s))
	switch normalized {
	case "json", "text":
		return normalized, nil
	default:
		return "", fmt.Errorf("LOG_FORMAT must be one of json|text; got %q", s)
	}
}

// validateAddr checks that the listen address has a numeric port in [1,65535].
// Accepts ":8443" or "0.0.0.0:8443". Empty host is fine.
func validateAddr(addr string) error {
	idx := strings.LastIndex(addr, ":")
	if idx < 0 {
		return fmt.Errorf("STRIPE_SERVICE_ADDR must include a port (e.g. :8443); got %q", addr)
	}
	portStr := addr[idx+1:]
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return fmt.Errorf("STRIPE_SERVICE_ADDR port must be numeric; got %q", portStr)
	}
	if port < 1 || port > 65535 {
		return fmt.Errorf("STRIPE_SERVICE_ADDR port must be between 1 and 65535; got %d", port)
	}
	return nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// getEnvDuration returns fallback when the env var is unset or empty, parses
// the value otherwise, and returns a descriptive error if the value is present
// but cannot be parsed (e.g. "30" instead of "30s") so misconfiguration fails
// fast rather than silently reverting to the default.
func getEnvDuration(key string, fallback time.Duration) (time.Duration, error) {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("%s must be a Go duration (e.g. 30s, 2m); got %q: %w", key, v, err)
	}
	return d, nil
}

// SlogLevel maps the validated LogLevel string to slog.Level.
func SlogLevel(s string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

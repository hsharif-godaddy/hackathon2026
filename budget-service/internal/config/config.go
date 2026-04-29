// Package config reads env for cmd/server.
package config

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is process env for the HTTP server and DB pool.
type Config struct {
	Addr             string
	LocalAuthDisable bool
	SSOHost          string

	DatabaseURL        string
	MigrateDatabaseURL string
	AutoMigrate        bool
	DBMaxOpenConns     int
	DBMaxIdleConns     int
	DBConnMaxLifetime  time.Duration

	TLSCertPath string
	TLSKeyPath  string

	HTTPReadTimeout  time.Duration
	HTTPWriteTimeout time.Duration
	HTTPIdleTimeout  time.Duration

	// LogLevel controls slog level for the whole process (JSON logs). From LOG_LEVEL, default "info".
	LogLevel string

	// LogRequestBodies adds requestBody to http.request.complete for POST/PATCH when true (LOG_REQUEST_BODIES). Default false.
	LogRequestBodies bool

	// Background worker settings
	WorkerEnabled   bool
	WorkerInterval  time.Duration
	WorkerBatchSize int

	// Outbox settings
	OutboxMaxAttempts    int
	OutboxDrainBatchSize int
	OutboxRetentionDays  int

	// AuthAllowedRoles is a list of allowed AWS IAM role ARN patterns.
	// Supports exact match and trailing wildcard (e.g. "arn:aws:iam::123:role/airo-*").
	// When JWT auth is enabled (!LocalAuthDisable), must be non-empty or Load fails.
	// When LOCAL_AUTH_DISABLE=true, unset/empty is allowed (local open API).
	AuthAllowedRoles []string

	// AuthAllowedCerts is a list of allowed cert CommonName patterns.
	// Supports exact match and trailing wildcard (e.g. "airo-builder.godaddy.com/*").
	// When JWT auth is enabled (!LocalAuthDisable), must be non-empty or Load fails.
	// When LOCAL_AUTH_DISABLE=true, unset/empty is allowed (local open API).
	AuthAllowedCerts []string
}

// Load reads env and checks LOCAL_AUTH_DISABLE / SSO_HOST / TLS pair consistency.
func Load() (Config, error) {
	cfg := Config{
		Addr:                 getEnv("BUDGET_SERVICE_ADDR", ":8080"),
		LocalAuthDisable:     getEnvBool("LOCAL_AUTH_DISABLE"),
		SSOHost:              os.Getenv("SSO_HOST"),
		DatabaseURL:          os.Getenv("DATABASE_URL"),
		MigrateDatabaseURL:   strings.TrimSpace(os.Getenv("MIGRATE_DATABASE_URL")),
		DBMaxOpenConns:       getEnvInt("DB_MAX_OPEN_CONNS", 50),
		DBMaxIdleConns:       getEnvInt("DB_MAX_IDLE_CONNS", 25),
		DBConnMaxLifetime:    getEnvDuration("DB_CONN_MAX_LIFETIME", 5*time.Minute),
		TLSCertPath:          os.Getenv("SERVER_CERT_PATH"),
		TLSKeyPath:           os.Getenv("SERVER_KEY_PATH"),
		HTTPReadTimeout:      getEnvDuration("HTTP_READ_TIMEOUT", 30*time.Second),
		HTTPWriteTimeout:     getEnvDuration("HTTP_WRITE_TIMEOUT", 60*time.Second),
		HTTPIdleTimeout:      getEnvDuration("HTTP_IDLE_TIMEOUT", 120*time.Second),
		LogLevel:             getEnv("LOG_LEVEL", "info"),
		LogRequestBodies:     getEnvBool("LOG_REQUEST_BODIES"),
		WorkerEnabled:        getEnvBoolDefault("WORKER_ENABLED", true),
		WorkerInterval:       getEnvDuration("WORKER_INTERVAL", 1*time.Minute),
		WorkerBatchSize:      getEnvInt("WORKER_BATCH_SIZE", 500),
		OutboxMaxAttempts:    getEnvInt("OUTBOX_MAX_ATTEMPTS", 7),
		OutboxDrainBatchSize: getEnvInt("OUTBOX_DRAIN_BATCH_SIZE", 100),
		OutboxRetentionDays:  getEnvInt("OUTBOX_RETENTION_DAYS", 7),
	}
	var err error
	if cfg.AuthAllowedRoles, err = parseJSONStringSlice("AUTH_ALLOWED_ROLES"); err != nil {
		return Config{}, err
	}
	if cfg.AuthAllowedCerts, err = parseJSONStringSlice("AUTH_ALLOWED_CERTS"); err != nil {
		return Config{}, err
	}

	if cfg.MigrateDatabaseURL != "" && cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("MIGRATE_DATABASE_URL requires DATABASE_URL")
	}
	cfg.AutoMigrate = autoMigrateFromEnv(cfg.DatabaseURL)
	if !cfg.LocalAuthDisable && cfg.SSOHost == "" {
		return Config{}, fmt.Errorf("SSO_HOST is required unless LOCAL_AUTH_DISABLE is true")
	}
	if (cfg.TLSCertPath != "") != (cfg.TLSKeyPath != "") {
		return Config{}, fmt.Errorf("SERVER_CERT_PATH and SERVER_KEY_PATH must both be set or both empty")
	}
	if !cfg.LocalAuthDisable && cfg.TLSCertPath == "" {
		return Config{}, fmt.Errorf("SERVER_CERT_PATH and SERVER_KEY_PATH are required unless LOCAL_AUTH_DISABLE is true")
	}
	if !cfg.LocalAuthDisable {
		if len(cfg.AuthAllowedRoles) == 0 {
			return Config{}, fmt.Errorf("AUTH_ALLOWED_ROLES is required (non-empty JSON array) unless LOCAL_AUTH_DISABLE is true")
		}
		if len(cfg.AuthAllowedCerts) == 0 {
			return Config{}, fmt.Errorf("AUTH_ALLOWED_CERTS is required (non-empty JSON array) unless LOCAL_AUTH_DISABLE is true")
		}
		if err := validateAllowlistNoBlankEntries("AUTH_ALLOWED_ROLES", cfg.AuthAllowedRoles); err != nil {
			return Config{}, err
		}
		if err := validateAllowlistNoBlankEntries("AUTH_ALLOWED_CERTS", cfg.AuthAllowedCerts); err != nil {
			return Config{}, err
		}
		if err := validateAllowlistPatternSyntax("AUTH_ALLOWED_ROLES", cfg.AuthAllowedRoles); err != nil {
			return Config{}, err
		}
		if err := validateAllowlistPatternSyntax("AUTH_ALLOWED_CERTS", cfg.AuthAllowedCerts); err != nil {
			return Config{}, err
		}
	}
	// Validate worker settings are positive (defaults in getEnvInt/getEnvDuration ensure this normally)
	if cfg.WorkerInterval <= 0 {
		return Config{}, fmt.Errorf("WORKER_INTERVAL must be positive")
	}
	if cfg.WorkerBatchSize <= 0 {
		return Config{}, fmt.Errorf("WORKER_BATCH_SIZE must be positive")
	}
	if cfg.OutboxMaxAttempts <= 0 {
		return Config{}, fmt.Errorf("OUTBOX_MAX_ATTEMPTS must be positive")
	}
	if cfg.OutboxDrainBatchSize <= 0 {
		return Config{}, fmt.Errorf("OUTBOX_DRAIN_BATCH_SIZE must be positive")
	}
	if cfg.OutboxRetentionDays <= 0 {
		return Config{}, fmt.Errorf("OUTBOX_RETENTION_DAYS must be positive")
	}
	return cfg, nil
}

func validateAllowlistNoBlankEntries(key string, entries []string) error {
	for _, e := range entries {
		if strings.TrimSpace(e) == "" {
			return fmt.Errorf("%s must not contain empty or whitespace-only entries", key)
		}
		if e != strings.TrimSpace(e) {
			return fmt.Errorf("%s: entry %q must not have leading or trailing whitespace", key, e)
		}
	}
	return nil
}

// validateAllowlistPatternSyntax rejects patterns that start with '*' after trim.
// Only trailing-wildcard prefix match is implemented (see auth.matchesAllowlist); leading '*' would never match.
func validateAllowlistPatternSyntax(key string, entries []string) error {
	for _, e := range entries {
		if strings.HasPrefix(strings.TrimSpace(e), "*") {
			return fmt.Errorf("%s: pattern %q must not start with '*'; use exact match or a trailing '*' wildcard only", key, e)
		}
	}
	return nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func autoMigrateFromEnv(databaseURL string) bool {
	if databaseURL == "" {
		return false
	}
	if _, set := os.LookupEnv("AUTO_MIGRATE"); !set {
		return true
	}
	return getEnvBool("AUTO_MIGRATE")
}

func getEnvBool(key string) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return false
	}
	switch strings.ToLower(v) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func getEnvBoolDefault(key string, fallback bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	switch strings.ToLower(v) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func parseJSONStringSlice(key string) ([]string, error) {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return nil, nil
	}
	result, err := unmarshalStringSlice(v)
	if err != nil {
		return nil, fmt.Errorf("%s: invalid allowlist (use a JSON string array, optional outer single quotes, or ['a','b'] only when every value is free of a single quote): %w", key, err)
	}
	return result, nil
}

func unmarshalStringSlice(v string) ([]string, error) {
	var result []string
	err := json.Unmarshal([]byte(v), &result)
	if err == nil {
		return result, nil
	}
	first := err
	// Value wrapped in shell / Katana / YAML style: entire JSON in single quotes.
	if len(v) >= 2 && v[0] == '\'' && v[len(v)-1] == '\'' {
		inner := strings.TrimSpace(v[1 : len(v)-1])
		if err := json.Unmarshal([]byte(inner), &result); err == nil {
			return result, nil
		}
	}
	if out, isForm, errP := tryParseSingleQuotedStringArrayForm(v); errP != nil {
		return nil, errP
	} else if isForm {
		return out, nil
	}
	return nil, first
}

// tryParseSingleQuotedStringArrayForm parses a bracketed list whose string entries use
// '...' and no " characters, e.g. ['arn:...','arn:...']. Values with an interior single
// quote are rejected; use a JSON string array in double quotes for those.
func tryParseSingleQuotedStringArrayForm(v string) (out []string, isThisForm bool, err error) {
	v = strings.TrimSpace(v)
	if len(v) < 2 || v[0] != '[' || v[len(v)-1] != ']' {
		return nil, false, nil
	}
	if strings.Contains(v, `"`) {
		return nil, false, nil
	}
	if !strings.Contains(v, `'`) {
		return nil, false, nil
	}
	inner := strings.TrimSpace(v[1 : len(v)-1])
	if inner == "" {
		return nil, true, nil
	}
	rest := inner
	for {
		rest = strings.TrimLeft(rest, " \t\n,")
		if rest == "" {
			return out, true, nil
		}
		if rest[0] != '\'' {
			return nil, true, fmt.Errorf("not a valid 'entry','entry' list: expected ' before %q", firstRestSnippet(rest))
		}
		rest = rest[1:]
		closing := strings.IndexByte(rest, '\'')
		if closing < 0 {
			return nil, true, fmt.Errorf("unclosed single-quoted value in %q", v)
		}
		out = append(out, rest[:closing])
		rest = rest[closing+1:]
	}
}

func firstRestSnippet(s string) string {
	if len(s) <= 24 {
		return s
	}
	return s[:24] + "..."
}

// SlogLevel maps config strings (debug, warn, error, info) to slog.Level.
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

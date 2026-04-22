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

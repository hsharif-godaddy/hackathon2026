// Package config reads env for cmd/server.
package config

import (
	"fmt"
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

	DatabaseURL       string
	DBMaxOpenConns    int
	DBMaxIdleConns    int
	DBConnMaxLifetime time.Duration

	TLSCertPath string
	TLSKeyPath  string

	HTTPReadTimeout  time.Duration
	HTTPWriteTimeout time.Duration
	HTTPIdleTimeout  time.Duration

	AuthLogLevel string

	WebhookSecret string
}

// Load reads env and checks LOCAL_AUTH_DISABLE / SSO_HOST / TLS pair consistency.
func Load() (Config, error) {
	cfg := Config{
		Addr:              getEnv("BUDGET_SERVICE_ADDR", ":8080"),
		LocalAuthDisable:  getEnvBool("LOCAL_AUTH_DISABLE"),
		SSOHost:           os.Getenv("SSO_HOST"),
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		DBMaxOpenConns:    getEnvInt("DB_MAX_OPEN_CONNS", 25),
		DBMaxIdleConns:    getEnvInt("DB_MAX_IDLE_CONNS", 5),
		DBConnMaxLifetime: getEnvDuration("DB_CONN_MAX_LIFETIME", 5*time.Minute),
		TLSCertPath:       os.Getenv("SERVER_CERT_PATH"),
		TLSKeyPath:        os.Getenv("SERVER_KEY_PATH"),
		HTTPReadTimeout:   getEnvDuration("HTTP_READ_TIMEOUT", 30*time.Second),
		HTTPWriteTimeout:  getEnvDuration("HTTP_WRITE_TIMEOUT", 60*time.Second),
		HTTPIdleTimeout:   getEnvDuration("HTTP_IDLE_TIMEOUT", 120*time.Second),
		AuthLogLevel:      getEnv("AUTH_LOG_LEVEL", "info"),
		WebhookSecret:     strings.TrimSpace(os.Getenv("WEBHOOK_SECRET")),
	}
	if !cfg.LocalAuthDisable && cfg.SSOHost == "" {
		return Config{}, fmt.Errorf("SSO_HOST is required unless LOCAL_AUTH_DISABLE is true")
	}
	if (cfg.TLSCertPath != "") != (cfg.TLSKeyPath != "") {
		return Config{}, fmt.Errorf("SERVER_CERT_PATH and SERVER_KEY_PATH must both be set or both empty")
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

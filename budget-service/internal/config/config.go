// internal/config/config.go
package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	// Service
	Port            int
	LogLevel        string
	ShutdownTimeout time.Duration

	// HTTP Server
	HTTPReadTimeout  time.Duration
	HTTPWriteTimeout time.Duration
	HTTPIdleTimeout  time.Duration

	// Database
	DatabaseURL       string
	DBMaxOpenConns    int
	DBMaxIdleConns    int
	DBConnMaxLifetime time.Duration

	// Auth
	AuthMode               string // "test" or "jwt" (default: jwt)
	AuthJWKSURL            string // JWKS endpoint for production JWT validation
	AuthTestSigningKey     string // HMAC key for test mode JWT signing/validation
	AuthAdminAllowlist     string // Comma-separated CNAMEs/IAM identities
	AuthAdminAllowlistFile string // Path to JSON file with additional identities

	// Logging
	AuditLogPath string
	AuditLogSync bool

	// Alerts
	AlertWarningThreshold  int
	AlertCriticalThreshold int
}

func LoadConfig() *Config {
	return &Config{
		Port:                   getEnvInt("PORT", 8080),
		LogLevel:               getEnvString("LOG_LEVEL", "info"),
		ShutdownTimeout:        getEnvDuration("SHUTDOWN_TIMEOUT", 30*time.Second),
		HTTPReadTimeout:        getEnvDuration("HTTP_READ_TIMEOUT", 30*time.Second),
		HTTPWriteTimeout:       getEnvDuration("HTTP_WRITE_TIMEOUT", 60*time.Second),
		HTTPIdleTimeout:        getEnvDuration("HTTP_IDLE_TIMEOUT", 120*time.Second),
		DatabaseURL:            getEnvString("DATABASE_URL", ""),
		DBMaxOpenConns:         getEnvInt("DB_MAX_OPEN_CONNS", 25),
		DBMaxIdleConns:         getEnvInt("DB_MAX_IDLE_CONNS", 5),
		DBConnMaxLifetime:      getEnvDuration("DB_CONN_MAX_LIFETIME", 5*time.Minute),
		AuthMode:               getEnvString("AUTH_MODE", "jwt"),
		AuthJWKSURL:            getEnvString("AUTH_JWKS_URL", ""),
		AuthTestSigningKey:     getEnvString("AUTH_TEST_SIGNING_KEY", ""),
		AuthAdminAllowlist:     getEnvString("AUTH_ADMIN_ALLOWLIST", ""),
		AuthAdminAllowlistFile: getEnvString("AUTH_ADMIN_ALLOWLIST_FILE", ""),
		AuditLogPath:           getEnvString("AUDIT_LOG_PATH", "/var/log/budget-service/audit.log"),
		AuditLogSync:           getEnvBool("AUDIT_LOG_SYNC", true),
		AlertWarningThreshold:  getEnvInt("ALERT_WARNING_THRESHOLD", 20),
		AlertCriticalThreshold: getEnvInt("ALERT_CRITICAL_THRESHOLD", 10),
	}
}

func getEnvString(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if duration, err := time.ParseDuration(value); err == nil {
			return duration
		}
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolValue, err := strconv.ParseBool(value); err == nil {
			return boolValue
		}
	}
	return defaultValue
}

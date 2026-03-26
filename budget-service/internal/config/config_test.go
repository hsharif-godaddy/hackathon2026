// internal/config/config_test.go
package config

import (
	"os"
	"testing"
	"time"
)

func TestLoadConfig_Defaults(t *testing.T) {
	// Clear relevant env vars
	envVars := []string{
		"PORT", "LOG_LEVEL", "SHUTDOWN_TIMEOUT",
		"HTTP_READ_TIMEOUT", "HTTP_WRITE_TIMEOUT", "HTTP_IDLE_TIMEOUT",
		"SERVER_CERT_PATH", "SERVER_KEY_PATH",
		"DATABASE_URL", "DB_MAX_OPEN_CONNS", "DB_MAX_IDLE_CONNS", "DB_CONN_MAX_LIFETIME",
		"AUTH_JWKS_URL",
		"AUTH_MODE", "AUTH_TEST_SIGNING_KEY", "AUTH_ADMIN_ALLOWLIST", "AUTH_ADMIN_ALLOWLIST_FILE",
		"AUDIT_LOG_PATH", "AUDIT_LOG_SYNC",
		"ALERT_WARNING_THRESHOLD", "ALERT_CRITICAL_THRESHOLD",
	}
	for _, v := range envVars {
		os.Unsetenv(v)
	}

	cfg := LoadConfig()

	tests := []struct {
		name     string
		got      any
		expected any
	}{
		{"Port", cfg.Port, 8080},
		{"LogLevel", cfg.LogLevel, "info"},
		{"ShutdownTimeout", cfg.ShutdownTimeout, 30 * time.Second},
		{"HTTPReadTimeout", cfg.HTTPReadTimeout, 30 * time.Second},
		{"HTTPWriteTimeout", cfg.HTTPWriteTimeout, 60 * time.Second},
		{"HTTPIdleTimeout", cfg.HTTPIdleTimeout, 120 * time.Second},
		{"TLSCertPath", cfg.TLSCertPath, ""},
		{"TLSKeyPath", cfg.TLSKeyPath, ""},
		{"DatabaseURL", cfg.DatabaseURL, ""},
		{"DBMaxOpenConns", cfg.DBMaxOpenConns, 25},
		{"DBMaxIdleConns", cfg.DBMaxIdleConns, 5},
		{"DBConnMaxLifetime", cfg.DBConnMaxLifetime, 5 * time.Minute},
		{"AuthMode", cfg.AuthMode, "jwt"},
		{"AuthJWKSURL", cfg.AuthJWKSURL, ""},
		{"AuthTestSigningKey", cfg.AuthTestSigningKey, ""},
		{"AuthAdminAllowlist", cfg.AuthAdminAllowlist, ""},
		{"AuthAdminAllowlistFile", cfg.AuthAdminAllowlistFile, ""},
		{"AuditLogPath", cfg.AuditLogPath, "/var/log/budget-service/audit.log"},
		{"AuditLogSync", cfg.AuditLogSync, true},
		{"AlertWarningThreshold", cfg.AlertWarningThreshold, 20},
		{"AlertCriticalThreshold", cfg.AlertCriticalThreshold, 10},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, tt.got)
			}
		})
	}
}

func TestGetEnvString(t *testing.T) {
	tests := []struct {
		name         string
		envKey       string
		envValue     string
		defaultValue string
		expected     string
	}{
		{"returns default when unset", "TEST_STRING_UNSET", "", "default", "default"},
		{"returns env value when set", "TEST_STRING_SET", "custom", "default", "custom"},
		{"returns empty string when set to empty", "TEST_STRING_EMPTY", "", "default", "default"},
		{"handles special characters", "TEST_STRING_SPECIAL", "value with spaces & symbols!", "default", "value with spaces & symbols!"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Unsetenv(tt.envKey)
			if tt.envValue != "" {
				os.Setenv(tt.envKey, tt.envValue)
				defer os.Unsetenv(tt.envKey)
			}

			result := getEnvString(tt.envKey, tt.defaultValue)
			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestGetEnvInt(t *testing.T) {
	tests := []struct {
		name         string
		envKey       string
		envValue     string
		defaultValue int
		expected     int
	}{
		{"returns default when unset", "TEST_INT_UNSET", "", 42, 42},
		{"returns env value when valid", "TEST_INT_VALID", "100", 42, 100},
		{"returns default for invalid value", "TEST_INT_INVALID", "not-a-number", 42, 42},
		{"returns default for float value", "TEST_INT_FLOAT", "3.14", 42, 42},
		{"handles zero", "TEST_INT_ZERO", "0", 42, 0},
		{"handles negative", "TEST_INT_NEGATIVE", "-10", 42, -10},
		{"returns default for empty string", "TEST_INT_EMPTY", "", 42, 42},
		{"returns default for whitespace", "TEST_INT_WHITESPACE", "  ", 42, 42},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Unsetenv(tt.envKey)
			if tt.envValue != "" {
				os.Setenv(tt.envKey, tt.envValue)
				defer os.Unsetenv(tt.envKey)
			}

			result := getEnvInt(tt.envKey, tt.defaultValue)
			if result != tt.expected {
				t.Errorf("expected %d, got %d", tt.expected, result)
			}
		})
	}
}

func TestGetEnvDuration(t *testing.T) {
	tests := []struct {
		name         string
		envKey       string
		envValue     string
		defaultValue time.Duration
		expected     time.Duration
	}{
		{"returns default when unset", "TEST_DUR_UNSET", "", 30 * time.Second, 30 * time.Second},
		{"parses seconds", "TEST_DUR_SEC", "45s", 30 * time.Second, 45 * time.Second},
		{"parses minutes", "TEST_DUR_MIN", "5m", 30 * time.Second, 5 * time.Minute},
		{"parses hours", "TEST_DUR_HOUR", "2h", 30 * time.Second, 2 * time.Hour},
		{"parses milliseconds", "TEST_DUR_MS", "500ms", 30 * time.Second, 500 * time.Millisecond},
		{"parses complex duration", "TEST_DUR_COMPLEX", "1h30m", 30 * time.Second, 90 * time.Minute},
		{"returns default for invalid", "TEST_DUR_INVALID", "invalid", 30 * time.Second, 30 * time.Second},
		{"returns default for number without unit", "TEST_DUR_NO_UNIT", "100", 30 * time.Second, 30 * time.Second},
		{"handles zero", "TEST_DUR_ZERO", "0s", 30 * time.Second, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Unsetenv(tt.envKey)
			if tt.envValue != "" {
				os.Setenv(tt.envKey, tt.envValue)
				defer os.Unsetenv(tt.envKey)
			}

			result := getEnvDuration(tt.envKey, tt.defaultValue)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestGetEnvBool(t *testing.T) {
	tests := []struct {
		name         string
		envKey       string
		envValue     string
		defaultValue bool
		expected     bool
	}{
		{"returns default when unset", "TEST_BOOL_UNSET", "", true, true},
		{"parses true", "TEST_BOOL_TRUE", "true", false, true},
		{"parses false", "TEST_BOOL_FALSE", "false", true, false},
		{"parses 1 as true", "TEST_BOOL_ONE", "1", false, true},
		{"parses 0 as false", "TEST_BOOL_ZERO", "0", true, false},
		{"parses TRUE uppercase", "TEST_BOOL_UPPER", "TRUE", false, true},
		{"parses False mixed case", "TEST_BOOL_MIXED", "False", true, false},
		{"returns default for invalid", "TEST_BOOL_INVALID", "yes", false, false},
		{"returns default for invalid string", "TEST_BOOL_STRING", "enabled", true, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Unsetenv(tt.envKey)
			if tt.envValue != "" {
				os.Setenv(tt.envKey, tt.envValue)
				defer os.Unsetenv(tt.envKey)
			}

			result := getEnvBool(tt.envKey, tt.defaultValue)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestLoadConfig_FromEnv(t *testing.T) {
	// Set all env vars
	envValues := map[string]string{
		"PORT":                      "9090",
		"LOG_LEVEL":                 "debug",
		"SHUTDOWN_TIMEOUT":          "45s",
		"HTTP_READ_TIMEOUT":         "15s",
		"HTTP_WRITE_TIMEOUT":        "30s",
		"HTTP_IDLE_TIMEOUT":         "60s",
		"SERVER_CERT_PATH":          "/tls/cert.pem",
		"SERVER_KEY_PATH":           "/tls/key.pem",
		"DATABASE_URL":              "postgres://localhost/test",
		"DB_MAX_OPEN_CONNS":         "50",
		"DB_MAX_IDLE_CONNS":         "10",
		"DB_CONN_MAX_LIFETIME":      "10m",
		"AUTH_JWKS_URL":             "https://auth.example.com/.well-known/jwks.json",
		"AUTH_MODE":                 "test",
		"AUTH_TEST_SIGNING_KEY":     "test-secret-key-for-signing",
		"AUTH_ADMIN_ALLOWLIST":      "admin1.example.com,admin2.example.com",
		"AUTH_ADMIN_ALLOWLIST_FILE": "/etc/budget-service/admin-allowlist.json",
		"AUDIT_LOG_PATH":            "/custom/path/audit.log",
		"AUDIT_LOG_SYNC":            "false",
		"ALERT_WARNING_THRESHOLD":   "25",
		"ALERT_CRITICAL_THRESHOLD":  "15",
	}

	for k, v := range envValues {
		os.Setenv(k, v)
	}
	defer func() {
		for k := range envValues {
			os.Unsetenv(k)
		}
	}()

	cfg := LoadConfig()

	tests := []struct {
		name     string
		got      any
		expected any
	}{
		{"Port", cfg.Port, 9090},
		{"LogLevel", cfg.LogLevel, "debug"},
		{"ShutdownTimeout", cfg.ShutdownTimeout, 45 * time.Second},
		{"HTTPReadTimeout", cfg.HTTPReadTimeout, 15 * time.Second},
		{"HTTPWriteTimeout", cfg.HTTPWriteTimeout, 30 * time.Second},
		{"HTTPIdleTimeout", cfg.HTTPIdleTimeout, 60 * time.Second},
		{"TLSCertPath", cfg.TLSCertPath, "/tls/cert.pem"},
		{"TLSKeyPath", cfg.TLSKeyPath, "/tls/key.pem"},
		{"DatabaseURL", cfg.DatabaseURL, "postgres://localhost/test"},
		{"DBMaxOpenConns", cfg.DBMaxOpenConns, 50},
		{"DBMaxIdleConns", cfg.DBMaxIdleConns, 10},
		{"DBConnMaxLifetime", cfg.DBConnMaxLifetime, 10 * time.Minute},
		{"AuthMode", cfg.AuthMode, "test"},
		{"AuthJWKSURL", cfg.AuthJWKSURL, "https://auth.example.com/.well-known/jwks.json"},
		{"AuthTestSigningKey", cfg.AuthTestSigningKey, "test-secret-key-for-signing"},
		{"AuthAdminAllowlist", cfg.AuthAdminAllowlist, "admin1.example.com,admin2.example.com"},
		{"AuthAdminAllowlistFile", cfg.AuthAdminAllowlistFile, "/etc/budget-service/admin-allowlist.json"},
		{"AuditLogPath", cfg.AuditLogPath, "/custom/path/audit.log"},
		{"AuditLogSync", cfg.AuditLogSync, false},
		{"AlertWarningThreshold", cfg.AlertWarningThreshold, 25},
		{"AlertCriticalThreshold", cfg.AlertCriticalThreshold, 15},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, tt.got)
			}
		})
	}
}

func TestLoadConfig_InvalidValues_FallbackToDefaults(t *testing.T) {
	// Set invalid values that should trigger fallback to defaults
	envValues := map[string]string{
		"PORT":                     "not-a-port",
		"SHUTDOWN_TIMEOUT":         "invalid-duration",
		"HTTP_READ_TIMEOUT":        "30", // missing unit
		"HTTP_WRITE_TIMEOUT":       "abc",
		"HTTP_IDLE_TIMEOUT":        "1.5", // float without unit
		"DB_MAX_OPEN_CONNS":        "many",
		"DB_MAX_IDLE_CONNS":        "3.14",
		"DB_CONN_MAX_LIFETIME":     "forever",
		"AUDIT_LOG_SYNC":           "yes", // not a valid bool
		"ALERT_WARNING_THRESHOLD":  "high",
		"ALERT_CRITICAL_THRESHOLD": "",
	}

	for k, v := range envValues {
		os.Setenv(k, v)
	}
	defer func() {
		for k := range envValues {
			os.Unsetenv(k)
		}
	}()

	cfg := LoadConfig()

	tests := []struct {
		name     string
		got      any
		expected any
	}{
		{"Port falls back", cfg.Port, 8080},
		{"ShutdownTimeout falls back", cfg.ShutdownTimeout, 30 * time.Second},
		{"HTTPReadTimeout falls back", cfg.HTTPReadTimeout, 30 * time.Second},
		{"HTTPWriteTimeout falls back", cfg.HTTPWriteTimeout, 60 * time.Second},
		{"HTTPIdleTimeout falls back", cfg.HTTPIdleTimeout, 120 * time.Second},
		{"DBMaxOpenConns falls back", cfg.DBMaxOpenConns, 25},
		{"DBMaxIdleConns falls back", cfg.DBMaxIdleConns, 5},
		{"DBConnMaxLifetime falls back", cfg.DBConnMaxLifetime, 5 * time.Minute},
		{"AuditLogSync falls back", cfg.AuditLogSync, true},
		{"AlertWarningThreshold falls back", cfg.AlertWarningThreshold, 20},
		{"AlertCriticalThreshold falls back", cfg.AlertCriticalThreshold, 10},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, tt.got)
			}
		})
	}
}

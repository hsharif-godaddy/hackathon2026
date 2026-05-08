package config

import (
	"strings"
	"testing"
)

func clearEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"STRIPE_SERVICE_ADDR", "ENVIRONMENT", "LOG_LEVEL", "LOG_FORMAT",
		"HTTP_READ_TIMEOUT", "HTTP_WRITE_TIMEOUT", "HTTP_IDLE_TIMEOUT", "SHUTDOWN_TIMEOUT",
		"SERVER_CERT_PATH", "SERVER_KEY_PATH",
	} {
		t.Setenv(k, "")
	}
}

func TestLoadDefaults(t *testing.T) {
	clearEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Addr != ":8443" {
		t.Errorf("Addr: want :8443, got %q", cfg.Addr)
	}
	if cfg.Environment != EnvLocal {
		t.Errorf("Environment: want local, got %q", cfg.Environment)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel: want info, got %q", cfg.LogLevel)
	}
	if cfg.LogFormat != "json" {
		t.Errorf("LogFormat: want json, got %q", cfg.LogFormat)
	}
}

func TestLoadRejectsInvalidEnvironment(t *testing.T) {
	clearEnv(t)
	t.Setenv("ENVIRONMENT", "production")
	_, err := Load()
	if err == nil {
		t.Fatal("want error for ENVIRONMENT=production")
	}
	if !strings.Contains(err.Error(), "ENVIRONMENT") {
		t.Errorf("error should mention ENVIRONMENT; got %q", err)
	}
}

func TestLoadRejectsInvalidLogLevel(t *testing.T) {
	clearEnv(t)
	t.Setenv("LOG_LEVEL", "loud")
	_, err := Load()
	if err == nil {
		t.Fatal("want error for LOG_LEVEL=loud")
	}
	if !strings.Contains(err.Error(), "LOG_LEVEL") {
		t.Errorf("error should mention LOG_LEVEL; got %q", err)
	}
}

func TestLoadRejectsInvalidLogFormat(t *testing.T) {
	clearEnv(t)
	t.Setenv("LOG_FORMAT", "pretty")
	_, err := Load()
	if err == nil {
		t.Fatal("want error for LOG_FORMAT=pretty")
	}
	if !strings.Contains(err.Error(), "LOG_FORMAT") {
		t.Errorf("error should mention LOG_FORMAT; got %q", err)
	}
}

func TestLoadRejectsNonNumericPort(t *testing.T) {
	clearEnv(t)
	t.Setenv("STRIPE_SERVICE_ADDR", ":abc")
	_, err := Load()
	if err == nil {
		t.Fatal("want error for non-numeric port")
	}
	if !strings.Contains(err.Error(), "port") {
		t.Errorf("error should mention port; got %q", err)
	}
}

func TestLoadRejectsOutOfRangePort(t *testing.T) {
	clearEnv(t)
	t.Setenv("STRIPE_SERVICE_ADDR", ":99999")
	_, err := Load()
	if err == nil {
		t.Fatal("want error for out-of-range port")
	}
}

func TestLoadRejectsAddrWithoutPort(t *testing.T) {
	clearEnv(t)
	t.Setenv("STRIPE_SERVICE_ADDR", "0.0.0.0")
	_, err := Load()
	if err == nil {
		t.Fatal("want error for addr without port")
	}
}

func TestLoadNormalizesEnumWhitespaceAndCase(t *testing.T) {
	clearEnv(t)
	t.Setenv("ENVIRONMENT", "  dev  ")
	t.Setenv("LOG_LEVEL", " DEBUG ")
	t.Setenv("LOG_FORMAT", " Text ")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Environment != EnvDev {
		t.Errorf("Environment: want %q, got %q", EnvDev, cfg.Environment)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel: want debug, got %q", cfg.LogLevel)
	}
	if cfg.LogFormat != "text" {
		t.Errorf("LogFormat: want text, got %q", cfg.LogFormat)
	}
}

func TestLoadRejectsUnparseableDuration(t *testing.T) {
	clearEnv(t)
	t.Setenv("HTTP_READ_TIMEOUT", "30") // missing unit
	_, err := Load()
	if err == nil {
		t.Fatal("want error for HTTP_READ_TIMEOUT=30 (missing unit)")
	}
	if !strings.Contains(err.Error(), "HTTP_READ_TIMEOUT") {
		t.Errorf("error should mention HTTP_READ_TIMEOUT; got %q", err)
	}
}

func TestLoadRejectsTLSOnlyOnePathSet(t *testing.T) {
	clearEnv(t)
	t.Setenv("SERVER_CERT_PATH", "/tmp/cert.pem")
	_, err := Load()
	if err == nil {
		t.Fatal("want error when SERVER_CERT_PATH is set but SERVER_KEY_PATH is not")
	}
}

func TestLoadAcceptsBothTLSPaths(t *testing.T) {
	clearEnv(t)
	t.Setenv("SERVER_CERT_PATH", "/tmp/cert.pem")
	t.Setenv("SERVER_KEY_PATH", "/tmp/key.pem")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.TLSCertPath != "/tmp/cert.pem" || cfg.TLSKeyPath != "/tmp/key.pem" {
		t.Errorf("TLS paths: cert=%q key=%q", cfg.TLSCertPath, cfg.TLSKeyPath)
	}
}

func TestLoadAcceptsValidDurations(t *testing.T) {
	clearEnv(t)
	t.Setenv("HTTP_READ_TIMEOUT", "45s")
	t.Setenv("SHUTDOWN_TIMEOUT", "20s")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.HTTPReadTimeout.Seconds() != 45 {
		t.Errorf("HTTPReadTimeout: want 45s, got %s", cfg.HTTPReadTimeout)
	}
	if cfg.ShutdownTimeout.Seconds() != 20 {
		t.Errorf("ShutdownTimeout: want 20s, got %s", cfg.ShutdownTimeout)
	}
}

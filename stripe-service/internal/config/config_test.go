package config

import (
	"strings"
	"testing"
	"time"
)

func clearEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"STRIPE_SERVICE_ADDR", "ENVIRONMENT", "LOG_LEVEL", "LOG_FORMAT",
		"HTTP_READ_TIMEOUT", "HTTP_WRITE_TIMEOUT", "HTTP_IDLE_TIMEOUT", "SHUTDOWN_TIMEOUT",
		"SERVER_CERT_PATH", "SERVER_KEY_PATH",
		"AUTH_TYPE", "SSO_HOST",
		"MHP_AIRO_BASE_URL", "MHP_AIRO_TIMEOUT", "MHP_AIRO_AUTH",
	} {
		t.Setenv(k, "")
	}
	// Default to AUTH_TYPE=none for tests that don't care about auth, so
	// Load() doesn't fail the SSO_HOST-required check. Tests exercising auth
	// config explicitly override these.
	t.Setenv("AUTH_TYPE", "none")
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

func TestLoadAuthTypeEmptyFallsToJwtRequiresSSOHost(t *testing.T) {
	clearEnv(t)
	// Override default-AuthType-none and leave SSO_HOST empty — should fail
	// since AUTH_TYPE defaults to jwt and SSO_HOST has no default.
	t.Setenv("AUTH_TYPE", "")
	_, err := Load()
	if err == nil {
		t.Fatal("want error when AUTH_TYPE defaults to jwt and SSO_HOST is unset")
	}
	if !strings.Contains(err.Error(), "SSO_HOST") {
		t.Errorf("error should mention SSO_HOST; got %q", err)
	}
}

func TestLoadAuthTypeJwtWithSSOHost(t *testing.T) {
	clearEnv(t)
	t.Setenv("AUTH_TYPE", "jwt")
	t.Setenv("SSO_HOST", "sso.dev-godaddy.com")
	t.Setenv("MHP_AIRO_BASE_URL", "https://mgmt.nstk.net/api/airo/v1") // required when AUTH_TYPE=jwt
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.AuthType != "jwt" {
		t.Errorf("AuthType: want jwt, got %q", cfg.AuthType)
	}
	if cfg.SSOHost != "sso.dev-godaddy.com" {
		t.Errorf("SSOHost: want sso.dev-godaddy.com, got %q", cfg.SSOHost)
	}
}

func TestLoadAuthTypeNoneSkipsSSOHost(t *testing.T) {
	clearEnv(t)
	t.Setenv("AUTH_TYPE", "none")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.AuthType != "none" {
		t.Errorf("AuthType: want none, got %q", cfg.AuthType)
	}
}

func TestLoadRejectsInvalidAuthType(t *testing.T) {
	clearEnv(t)
	t.Setenv("AUTH_TYPE", "basic")
	_, err := Load()
	if err == nil {
		t.Fatal("want error for AUTH_TYPE=basic")
	}
	if !strings.Contains(err.Error(), "AUTH_TYPE") {
		t.Errorf("error should mention AUTH_TYPE; got %q", err)
	}
}

func TestLoadRejectsJwtWithoutSSOHost(t *testing.T) {
	clearEnv(t)
	t.Setenv("AUTH_TYPE", "jwt")
	t.Setenv("SSO_HOST", "")
	_, err := Load()
	if err == nil {
		t.Fatal("want error for AUTH_TYPE=jwt without SSO_HOST")
	}
	if !strings.Contains(err.Error(), "SSO_HOST") {
		t.Errorf("error should mention SSO_HOST; got %q", err)
	}
}

func TestResourceNames(t *testing.T) {
	tests := []struct {
		name    string
		env     Environment
		envPart string
	}{
		{"local maps to dev", EnvLocal, "dev"},
		{"dev", EnvDev, "dev"},
		{"test", EnvTest, "test"},
		{"prod", EnvProd, "prod"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Config{Environment: tt.env}.ResourceNames()
			want := ResourceNames{
				SandboxesTable:       tt.envPart + "-airo-stripe-sandboxes",
				EventsTable:          tt.envPart + "-airo-stripe-events",
				PlatformKeySecret:    tt.envPart + "-airo-stripe-platform-key",
				WebhookSigningSecret: tt.envPart + "-airo-stripe-webhook-signing",
				ManagedKeysAlias:     "alias/" + tt.envPart + "-airo-stripe-managed-keys",
			}
			if got != want {
				t.Errorf("ResourceNames:\n  got  %+v\n  want %+v", got, want)
			}
			if !strings.HasPrefix(got.ManagedKeysAlias, "alias/") {
				t.Errorf("ManagedKeysAlias must be prefixed with alias/, got %q", got.ManagedKeysAlias)
			}
		})
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

func TestLoadMHPAiroDefaultsWithAuthNone(t *testing.T) {
	clearEnv(t) // sets AUTH_TYPE=none
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got, want := cfg.MHPAiro.BaseURL, "http://localhost:4100/api/airo/v1"; got != want {
		t.Errorf("MHPAiro.BaseURL: want %q, got %q", want, got)
	}
	if got, want := cfg.MHPAiro.Auth, "none"; got != want {
		t.Errorf("MHPAiro.Auth: want %q, got %q", want, got)
	}
	if cfg.MHPAiro.Timeout != 30*time.Second {
		t.Errorf("MHPAiro.Timeout: want 30s, got %s", cfg.MHPAiro.Timeout)
	}
}

func TestLoadMHPAiroRequiresBaseURLWhenAuthJwt(t *testing.T) {
	clearEnv(t)
	t.Setenv("AUTH_TYPE", "jwt")
	t.Setenv("SSO_HOST", "sso.dev-godaddy.com")
	// MHP_AIRO_BASE_URL deliberately unset.
	_, err := Load()
	if err == nil {
		t.Fatal("want error when AUTH_TYPE=jwt and MHP_AIRO_BASE_URL is unset")
	}
	if !strings.Contains(err.Error(), "MHP_AIRO_BASE_URL") {
		t.Errorf("error should mention MHP_AIRO_BASE_URL; got %q", err)
	}
}

func TestLoadMHPAiroAuthDefaultsToAwsIamWhenJwt(t *testing.T) {
	clearEnv(t)
	t.Setenv("AUTH_TYPE", "jwt")
	t.Setenv("SSO_HOST", "sso.dev-godaddy.com")
	t.Setenv("MHP_AIRO_BASE_URL", "https://mgmt.nstk.net/api/airo/v1")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got, want := cfg.MHPAiro.Auth, "awsiam"; got != want {
		t.Errorf("MHPAiro.Auth: want %q, got %q", want, got)
	}
}

func TestLoadMHPAiroRejectsInvalidAuth(t *testing.T) {
	clearEnv(t)
	t.Setenv("MHP_AIRO_AUTH", "bearer") // not a valid option
	_, err := Load()
	if err == nil {
		t.Fatal("want error for invalid MHP_AIRO_AUTH")
	}
	if !strings.Contains(err.Error(), "MHP_AIRO_AUTH") {
		t.Errorf("error should mention MHP_AIRO_AUTH; got %q", err)
	}
}

func TestLoadMHPAiroRespectsExplicitOverrides(t *testing.T) {
	clearEnv(t)
	t.Setenv("AUTH_TYPE", "jwt")
	t.Setenv("SSO_HOST", "sso.dev-godaddy.com")
	t.Setenv("MHP_AIRO_BASE_URL", "https://custom.example/api/airo/v1")
	t.Setenv("MHP_AIRO_AUTH", "none") // override default mapping
	t.Setenv("MHP_AIRO_TIMEOUT", "7s")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.MHPAiro.BaseURL != "https://custom.example/api/airo/v1" {
		t.Errorf("MHPAiro.BaseURL: want override, got %q", cfg.MHPAiro.BaseURL)
	}
	if cfg.MHPAiro.Auth != "none" {
		t.Errorf("MHPAiro.Auth: want none (override), got %q", cfg.MHPAiro.Auth)
	}
	if cfg.MHPAiro.Timeout.Seconds() != 7 {
		t.Errorf("MHPAiro.Timeout: want 7s, got %s", cfg.MHPAiro.Timeout)
	}
}

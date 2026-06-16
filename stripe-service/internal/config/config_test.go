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
		"MGMT_API_BASE_URL", "MGMT_API_TIMEOUT", "MGMT_API_AUTH",
		"CLIENT_CERTIFICATE_CRT", "CLIENT_CERTIFICATE_KEY",
		"STRIPE_CLIENT", "STRIPE_API_BASE_URL", "STRIPE_API_VERSION",
	} {
		t.Setenv(k, "")
	}
	// Default to AUTH_TYPE=none for tests that don't care about auth, so
	// Load() doesn't fail the SSO_HOST-required check. Tests exercising auth
	// config explicitly override these.
	t.Setenv("AUTH_TYPE", "none")
}

// setDeployedEnv sets ENVIRONMENT plus the TLS paths Load() now requires for
// any non-local environment (security-review: no plain-HTTP fallback in
// deployed envs). Tests focused on unrelated config can call this instead of
// repeating the cert/key boilerplate.
func setDeployedEnv(t *testing.T, env string) {
	t.Helper()
	t.Setenv("ENVIRONMENT", env)
	t.Setenv("SERVER_CERT_PATH", "/tmp/cert.pem")
	t.Setenv("SERVER_KEY_PATH", "/tmp/key.pem")
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
	// "  dev  " trims to a deployed env; satisfy the TLS-required check.
	t.Setenv("SERVER_CERT_PATH", "/tmp/cert.pem")
	t.Setenv("SERVER_KEY_PATH", "/tmp/key.pem")
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

// TestLoadRequiresTLSInDeployedEnvs locks in the security-review contract
// (no plain-HTTP fallback in deployed environments). Local stays
// plain-HTTP-allowed for dev convenience; dev/test/prod must error out at
// startup if SERVER_CERT_PATH / SERVER_KEY_PATH aren't set, so a build or
// env-var passthrough regression can't silently produce a non-TLS prod task.
func TestLoadRequiresTLSInDeployedEnvs(t *testing.T) {
	for _, env := range []string{"dev", "test", "prod"} {
		t.Run(env, func(t *testing.T) {
			clearEnv(t)
			t.Setenv("ENVIRONMENT", env)
			// dev/test/prod also require SSO_HOST when AUTH_TYPE=jwt; clearEnv
			// sets AUTH_TYPE=none so the TLS check is what fails first.
			_, err := Load()
			if err == nil {
				t.Fatalf("ENVIRONMENT=%s: want error when TLS paths unset, got nil", env)
			}
			if !strings.Contains(err.Error(), "SERVER_CERT_PATH") {
				t.Errorf("ENVIRONMENT=%s: error should mention SERVER_CERT_PATH; got %q", env, err)
			}
		})
	}
}

// TestLoadAllowsPlainHTTPOnlyForLocal complements the deployed-env test:
// Environment=local with TLS unset must succeed (the documented local-dev
// path). Together these two tests pin the policy boundary.
func TestLoadAllowsPlainHTTPOnlyForLocal(t *testing.T) {
	clearEnv(t)
	t.Setenv("ENVIRONMENT", "local")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.TLSCertPath != "" || cfg.TLSKeyPath != "" {
		t.Errorf("local TLS paths should default empty; got cert=%q key=%q", cfg.TLSCertPath, cfg.TLSKeyPath)
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
				SandboxesTable:        tt.envPart + "-airo-stripe-sandboxes",
				EventsTable:           tt.envPart + "-airo-stripe-events",
				PlatformKeyTestSecret: tt.envPart + "-airo-stripe-platform-key-test",
				PlatformKeyLiveSecret: tt.envPart + "-airo-stripe-platform-key-live",
				WebhookSigningSecret:  tt.envPart + "-airo-stripe-webhook-signing",
				ManagedKeysAlias:      "alias/" + tt.envPart + "-airo-stripe-managed-keys",
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

func TestLoadHostingDefaultsWithAuthNone(t *testing.T) {
	clearEnv(t) // sets AUTH_TYPE=none
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got, want := cfg.Hosting.BaseURL, "http://localhost:4100"; got != want {
		t.Errorf("Hosting.BaseURL: want %q, got %q", want, got)
	}
	if got, want := cfg.Hosting.Auth, "none"; got != want {
		t.Errorf("Hosting.Auth: want %q, got %q", want, got)
	}
	if cfg.Hosting.Timeout != 30*time.Second {
		t.Errorf("Hosting.Timeout: want 30s, got %s", cfg.Hosting.Timeout)
	}
}

func TestLoadHostingRequiresBaseURLWhenAuthJwt(t *testing.T) {
	clearEnv(t)
	t.Setenv("AUTH_TYPE", "jwt")
	t.Setenv("SSO_HOST", "sso.dev-godaddy.com")
	// MGMT_API_BASE_URL deliberately unset.
	_, err := Load()
	if err == nil {
		t.Fatal("want error when AUTH_TYPE=jwt and MGMT_API_BASE_URL is unset")
	}
	if !strings.Contains(err.Error(), "MGMT_API_BASE_URL") {
		t.Errorf("error should mention MGMT_API_BASE_URL; got %q", err)
	}
}

func TestLoadHostingAuthDefaultsToAwsIamWhenJwt(t *testing.T) {
	clearEnv(t)
	t.Setenv("AUTH_TYPE", "jwt")
	t.Setenv("SSO_HOST", "sso.dev-godaddy.com")
	t.Setenv("MGMT_API_BASE_URL", "http://api.mgmt")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got, want := cfg.Hosting.Auth, "awsiam"; got != want {
		t.Errorf("Hosting.Auth: want %q, got %q", want, got)
	}
}

func TestLoadHostingRejectsInvalidAuth(t *testing.T) {
	clearEnv(t)
	t.Setenv("MGMT_API_AUTH", "bearer") // not a valid option
	_, err := Load()
	if err == nil {
		t.Fatal("want error for invalid MGMT_API_AUTH")
	}
	if !strings.Contains(err.Error(), "MGMT_API_AUTH") {
		t.Errorf("error should mention MGMT_API_AUTH; got %q", err)
	}
}

func TestLoadHostingRespectsExplicitOverrides(t *testing.T) {
	clearEnv(t)
	t.Setenv("AUTH_TYPE", "jwt")
	t.Setenv("SSO_HOST", "sso.dev-godaddy.com")
	t.Setenv("MGMT_API_BASE_URL", "https://custom.example")
	t.Setenv("MGMT_API_AUTH", "none") // override default mapping
	t.Setenv("MGMT_API_TIMEOUT", "7s")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Hosting.BaseURL != "https://custom.example" {
		t.Errorf("Hosting.BaseURL: want override, got %q", cfg.Hosting.BaseURL)
	}
	if cfg.Hosting.Auth != "none" {
		t.Errorf("Hosting.Auth: want none (override), got %q", cfg.Hosting.Auth)
	}
	if cfg.Hosting.Timeout.Seconds() != 7 {
		t.Errorf("Hosting.Timeout: want 7s, got %s", cfg.Hosting.Timeout)
	}
}

// TestLoadHostingFallsBackToLegacyMHPAiroEnvVars exercises the
// backward-compat branch in firstEnv: deployments migrating one env var at
// a time still resolve correctly when only the legacy name is set.
func TestLoadHostingFallsBackToLegacyMHPAiroEnvVars(t *testing.T) {
	clearEnv(t)
	t.Setenv("AUTH_TYPE", "jwt")
	t.Setenv("SSO_HOST", "sso.dev-godaddy.com")
	// MGMT_API_BASE_URL unset; MHP_AIRO_BASE_URL set instead.
	t.Setenv("MHP_AIRO_BASE_URL", "https://legacy.example")
	t.Setenv("MHP_AIRO_AUTH", "none")
	t.Setenv("MHP_AIRO_TIMEOUT", "9s")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Hosting.BaseURL != "https://legacy.example" {
		t.Errorf("Hosting.BaseURL: want legacy fallback, got %q", cfg.Hosting.BaseURL)
	}
	if cfg.Hosting.Auth != "none" {
		t.Errorf("Hosting.Auth: want legacy fallback, got %q", cfg.Hosting.Auth)
	}
	if cfg.Hosting.Timeout.Seconds() != 9 {
		t.Errorf("Hosting.Timeout: want 9s legacy fallback, got %s", cfg.Hosting.Timeout)
	}
}

func TestLoadHostingCertAuthRequiresPEM(t *testing.T) {
	cases := []struct {
		name string
		cert string
		key  string
	}{
		{"both unset", "", ""},
		{"cert only", "-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----\n", ""},
		{"key only", "", "-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----\n"},
		{"cert whitespace-only", "   \t\n", "-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----\n"},
		{"key whitespace-only", "-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----\n", "   \t\n"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			clearEnv(t)
			t.Setenv("AUTH_TYPE", "jwt")
			t.Setenv("SSO_HOST", "sso.dev-godaddy.com")
			t.Setenv("MGMT_API_BASE_URL", "https://mgmt.nstk.net")
			t.Setenv("MGMT_API_AUTH", "cert")
			t.Setenv("CLIENT_CERTIFICATE_CRT", c.cert)
			t.Setenv("CLIENT_CERTIFICATE_KEY", c.key)
			_, err := Load()
			if err == nil {
				t.Fatal("want error when MGMT_API_AUTH=cert and PEM env vars are missing/whitespace")
			}
			if !strings.Contains(err.Error(), "CLIENT_CERTIFICATE_CRT") {
				t.Errorf("error should mention CLIENT_CERTIFICATE_CRT; got %q", err)
			}
		})
	}
}

func TestLoadHostingCertAuthAcceptsBothPEM(t *testing.T) {
	clearEnv(t)
	t.Setenv("AUTH_TYPE", "jwt")
	t.Setenv("SSO_HOST", "sso.dev-godaddy.com")
	t.Setenv("MGMT_API_BASE_URL", "https://mgmt.nstk.net")
	t.Setenv("MGMT_API_AUTH", "cert")
	// PEM contents are passed through verbatim; config doesn't parse them.
	// Validity is enforced at hosting.NewCertSSOAuth construction time.
	t.Setenv("CLIENT_CERTIFICATE_CRT", "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n")
	t.Setenv("CLIENT_CERTIFICATE_KEY", "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Hosting.Auth != "cert" {
		t.Errorf("Hosting.Auth: want cert, got %q", cfg.Hosting.Auth)
	}
	if !strings.Contains(cfg.Hosting.ClientCert, "BEGIN CERTIFICATE") {
		t.Errorf("Hosting.ClientCert: PEM contents lost in load; got %q", cfg.Hosting.ClientCert)
	}
	if !strings.Contains(cfg.Hosting.ClientKey, "BEGIN RSA PRIVATE KEY") {
		t.Errorf("Hosting.ClientKey: PEM contents lost in load; got %q", cfg.Hosting.ClientKey)
	}
}

func TestLoadStripeClientDefaultsToFake(t *testing.T) {
	clearEnv(t)
	setDeployedEnv(t, "dev")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.StripeClient != "fake" {
		t.Errorf("StripeClient: want fake (default), got %q", cfg.StripeClient)
	}
}

// TestLoadStripeClientAcceptsReal: STRIPE_CLIENT=real no longer requires any
// prefill env vars — email is resolved at request time from the PIE API using
// the caller's customerId, and country comes from the request body.
func TestLoadStripeClientAcceptsReal(t *testing.T) {
	clearEnv(t)
	setDeployedEnv(t, "dev")
	t.Setenv("STRIPE_CLIENT", "real")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.StripeClient != "real" {
		t.Errorf("StripeClient: want real, got %q", cfg.StripeClient)
	}
}

func TestLoadStripeClientNormalizesCaseAndWhitespace(t *testing.T) {
	cases := []struct {
		raw  string
		want StripeClientKind
	}{
		{"  REAL  ", StripeClientReal},
		{"Real", StripeClientReal},
		{"  FAKE  ", StripeClientFake},
		{"Fake", StripeClientFake},
	}
	for _, c := range cases {
		t.Run(c.raw, func(t *testing.T) {
			clearEnv(t)
			setDeployedEnv(t, "dev")
			t.Setenv("STRIPE_CLIENT", c.raw)
			// real client no longer requires prefill env vars
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load(%q): %v", c.raw, err)
			}
			if cfg.StripeClient != c.want {
				t.Errorf("StripeClient(%q): want %q, got %q", c.raw, c.want, cfg.StripeClient)
			}
		})
	}
}

func TestLoadStripeClientRejectsInvalidEnum(t *testing.T) {
	clearEnv(t)
	setDeployedEnv(t, "dev")
	t.Setenv("STRIPE_CLIENT", "mock")
	_, err := Load()
	if err == nil {
		t.Fatal("want error for STRIPE_CLIENT=mock")
	}
	if !strings.Contains(err.Error(), "STRIPE_CLIENT") {
		t.Errorf("error should mention STRIPE_CLIENT; got %q", err)
	}
}

func TestLoadStripeClientForcesFakeInLocalEnv(t *testing.T) {
	// Safety belt: even if the env var says "real", local env coerces
	// to fake so a stale .env file doesn't accidentally hit Stripe.
	clearEnv(t)
	t.Setenv("ENVIRONMENT", "local")
	t.Setenv("STRIPE_CLIENT", "real")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.StripeClient != "fake" {
		t.Errorf("StripeClient (local): want fake (forced), got %q", cfg.StripeClient)
	}
}

func TestLoadStripeAPIBaseURLAndVersionPassThrough(t *testing.T) {
	clearEnv(t)
	setDeployedEnv(t, "dev")
	t.Setenv("STRIPE_API_BASE_URL", "https://api.stripe.test")
	t.Setenv("STRIPE_API_VERSION", "2024-12-01.preview")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.StripeAPIBaseURL != "https://api.stripe.test" {
		t.Errorf("StripeAPIBaseURL: got %q", cfg.StripeAPIBaseURL)
	}
	if cfg.StripeAPIVersion != "2024-12-01.preview" {
		t.Errorf("StripeAPIVersion: got %q", cfg.StripeAPIVersion)
	}
}

func TestLoadStripeAPIDefaultsAreEmpty(t *testing.T) {
	// Empty defaults so the wiring layer falls back to stripeapi's
	// own defaults (https://api.stripe.com, pinned preview version).
	clearEnv(t)
	setDeployedEnv(t, "dev")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.StripeAPIBaseURL != "" {
		t.Errorf("StripeAPIBaseURL: want empty default, got %q", cfg.StripeAPIBaseURL)
	}
	if cfg.StripeAPIVersion != "" {
		t.Errorf("StripeAPIVersion: want empty default, got %q", cfg.StripeAPIVersion)
	}
}

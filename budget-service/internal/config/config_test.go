package config

import (
	"log/slog"
	"os"
	"strings"
	"testing"
)

func restoreAutoMigrateEnv(t *testing.T, prev string, had bool) {
	t.Helper()
	t.Cleanup(func() {
		if had {
			_ = os.Setenv("AUTO_MIGRATE", prev)
		} else {
			_ = os.Unsetenv("AUTO_MIGRATE")
		}
	})
}

// unsetMigrateDatabaseURLForTest avoids leaking MIGRATE_DATABASE_URL from the shell into JWT-auth Load() tests (would fail with DATABASE_URL empty).
func unsetMigrateDatabaseURLForTest(t *testing.T) {
	t.Helper()
	t.Setenv("MIGRATE_DATABASE_URL", "")
}

func TestLoadAutoMigrateDefaultTrueWhenDATABASEURLSetAndAutoMigrateUnset(t *testing.T) {
	prev, had := os.LookupEnv("AUTO_MIGRATE")
	restoreAutoMigrateEnv(t, prev, had)
	_ = os.Unsetenv("AUTO_MIGRATE")
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "postgres://localhost:5432/budget?sslmode=disable")
	t.Setenv("MIGRATE_DATABASE_URL", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.AutoMigrate {
		t.Fatal("AutoMigrate: want true when DATABASE_URL is set and AUTO_MIGRATE is unset")
	}
}

func TestLoadAutoMigrateFalseWhenExplicitlyOff(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "postgres://localhost:5432/budget?sslmode=disable")
	t.Setenv("MIGRATE_DATABASE_URL", "")
	t.Setenv("AUTO_MIGRATE", "false")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.AutoMigrate {
		t.Fatal("AutoMigrate: want false when AUTO_MIGRATE=false")
	}
}

func TestLoadAutoMigrateFalseWhenDATABASEURLEmpty(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("MIGRATE_DATABASE_URL", "")
	t.Setenv("AUTO_MIGRATE", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.AutoMigrate {
		t.Fatal("AutoMigrate: want false when DATABASE_URL is empty")
	}
}

func TestLoadLogLevelFromEnv(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("LOG_LEVEL", "debug")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.LogLevel != "debug" {
		t.Fatalf("LogLevel: want debug, got %q", cfg.LogLevel)
	}
}

func TestLoadLogRequestBodiesFromEnv(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("LOG_REQUEST_BODIES", "true")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.LogRequestBodies {
		t.Fatal("LogRequestBodies: want true")
	}
}

func TestLoadLogLevelDefaultInfo(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("LOG_LEVEL", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.LogLevel != "info" {
		t.Fatalf("LogLevel: want default info, got %q", cfg.LogLevel)
	}
}

func TestSlogLevel(t *testing.T) {
	if SlogLevel("debug") != slog.LevelDebug {
		t.Fatal("debug")
	}
	if SlogLevel("WARN") != slog.LevelWarn {
		t.Fatal("warn")
	}
	if SlogLevel("") != slog.LevelInfo {
		t.Fatal("default info")
	}
}

func TestLoadMigrateDatabaseURLRequiresDatabaseURL(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("MIGRATE_DATABASE_URL", "postgres://x:y@localhost:5432/db?sslmode=disable")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "MIGRATE_DATABASE_URL") {
		t.Fatalf("error %q should mention MIGRATE_DATABASE_URL", err.Error())
	}
}

func TestLoadRejectsInvalidAllowedRolesJSON(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("AUTH_ALLOWED_ROLES", `["malformed`)
	t.Setenv("AUTH_ALLOWED_CERTS", "")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for malformed AUTH_ALLOWED_ROLES")
	}
	if !strings.Contains(err.Error(), "AUTH_ALLOWED_ROLES") {
		t.Fatalf("error %q should mention AUTH_ALLOWED_ROLES", err.Error())
	}
}

func TestLoadRejectsInvalidAllowedCertsJSON(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("AUTH_ALLOWED_ROLES", "")
	t.Setenv("AUTH_ALLOWED_CERTS", `not-json`)
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for malformed AUTH_ALLOWED_CERTS")
	}
	if !strings.Contains(err.Error(), "AUTH_ALLOWED_CERTS") {
		t.Fatalf("error %q should mention AUTH_ALLOWED_CERTS", err.Error())
	}
}

func TestLoadAcceptsValidAllowlistJSON(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("AUTH_ALLOWED_ROLES", `["arn:aws:iam::123:role/airo-*"]`)
	t.Setenv("AUTH_ALLOWED_CERTS", `["*.airo-builder.godaddy.com"]`)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.AuthAllowedRoles) != 1 {
		t.Fatalf("AuthAllowedRoles: want 1 entry, got %d", len(cfg.AuthAllowedRoles))
	}
	if len(cfg.AuthAllowedCerts) != 1 {
		t.Fatalf("AuthAllowedCerts: want 1 entry, got %d", len(cfg.AuthAllowedCerts))
	}
}

func TestLoadAllowlistSingleQuotedStringLiterals(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("AUTH_ALLOWED_ROLES", "['arn:aws:iam::123:role/airo-*']")
	t.Setenv("AUTH_ALLOWED_CERTS", "['*.airo-builder.godaddy.com']")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.AuthAllowedRoles) != 1 || cfg.AuthAllowedRoles[0] != "arn:aws:iam::123:role/airo-*" {
		t.Fatalf("AuthAllowedRoles: got %#v", cfg.AuthAllowedRoles)
	}
	if len(cfg.AuthAllowedCerts) != 1 || cfg.AuthAllowedCerts[0] != "*.airo-builder.godaddy.com" {
		t.Fatalf("AuthAllowedCerts: got %#v", cfg.AuthAllowedCerts)
	}
}

func TestLoadAllowlistJSONWrappedInSingleQuotes(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("AUTH_ALLOWED_ROLES", `'["arn:aws:iam::123:role/x"]'`)
	t.Setenv("AUTH_ALLOWED_CERTS", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.AuthAllowedRoles) != 1 || cfg.AuthAllowedRoles[0] != "arn:aws:iam::123:role/x" {
		t.Fatalf("AuthAllowedRoles: got %#v", cfg.AuthAllowedRoles)
	}
}

func TestLoadAllowlistKatanaStyleOuterQuotesMultiARN(t *testing.T) {
	// Some Katana/secret UIs let you paste a shell-style quoted string; the
	// value includes leading/trailing ' around valid JSON.
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("AUTH_ALLOWED_ROLES", `'`+
		`["arn:aws:iam::694282668781:role/GD-AWS-USA-GD-AiroBuilde-*",`+
		`"arn:aws:iam::018115330368:role/caasai-custom-KatanaEnvironment5327GlobalEcsTaskRole3B5499FC"]`+
		`'`)
	t.Setenv("AUTH_ALLOWED_CERTS", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.AuthAllowedRoles) != 2 {
		t.Fatalf("AuthAllowedRoles: want 2 entries, got %d: %#v", len(cfg.AuthAllowedRoles), cfg.AuthAllowedRoles)
	}
}

func TestLoadRequiresTLSWhenAuthEnabled(t *testing.T) {
	unsetMigrateDatabaseURLForTest(t)
	t.Setenv("LOCAL_AUTH_DISABLE", "false")
	t.Setenv("SSO_HOST", "sso.godaddy.com")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SERVER_CERT_PATH", "")
	t.Setenv("SERVER_KEY_PATH", "")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error when TLS paths empty and auth enabled")
	}
	if !strings.Contains(err.Error(), "SERVER_CERT_PATH") {
		t.Fatalf("error %q should mention SERVER_CERT_PATH", err.Error())
	}
}

func TestLoadRequiresAllowlistsWhenAuthEnabled(t *testing.T) {
	unsetMigrateDatabaseURLForTest(t)
	t.Setenv("LOCAL_AUTH_DISABLE", "false")
	t.Setenv("SSO_HOST", "sso.godaddy.com")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SERVER_CERT_PATH", "/tmp/cert.pem")
	t.Setenv("SERVER_KEY_PATH", "/tmp/key.pem")
	t.Setenv("AUTH_ALLOWED_ROLES", "")
	t.Setenv("AUTH_ALLOWED_CERTS", "")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error when auth enabled and allowlists empty")
	}
	if !strings.Contains(err.Error(), "AUTH_ALLOWED_ROLES") {
		t.Fatalf("error %q should mention AUTH_ALLOWED_ROLES", err.Error())
	}
}

func TestLoadRequiresAuthAllowedCertsWhenAuthEnabled(t *testing.T) {
	unsetMigrateDatabaseURLForTest(t)
	t.Setenv("LOCAL_AUTH_DISABLE", "false")
	t.Setenv("SSO_HOST", "sso.godaddy.com")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SERVER_CERT_PATH", "/tmp/cert.pem")
	t.Setenv("SERVER_KEY_PATH", "/tmp/key.pem")
	t.Setenv("AUTH_ALLOWED_ROLES", `["arn:aws:iam::123:role/x"]`)
	t.Setenv("AUTH_ALLOWED_CERTS", "")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error when AUTH_ALLOWED_CERTS empty")
	}
	if !strings.Contains(err.Error(), "AUTH_ALLOWED_CERTS") {
		t.Fatalf("error %q should mention AUTH_ALLOWED_CERTS", err.Error())
	}
}

func TestLoadRejectsEmptyJSONAllowlistWhenAuthEnabled(t *testing.T) {
	unsetMigrateDatabaseURLForTest(t)
	t.Setenv("LOCAL_AUTH_DISABLE", "false")
	t.Setenv("SSO_HOST", "sso.godaddy.com")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SERVER_CERT_PATH", "/tmp/cert.pem")
	t.Setenv("SERVER_KEY_PATH", "/tmp/key.pem")
	t.Setenv("AUTH_ALLOWED_ROLES", "[]")
	t.Setenv("AUTH_ALLOWED_CERTS", `["*.example.com"]`)
	_, err := Load()
	if err == nil {
		t.Fatal("expected error when AUTH_ALLOWED_ROLES is empty JSON array")
	}
	if !strings.Contains(err.Error(), "AUTH_ALLOWED_ROLES") {
		t.Fatalf("error %q should mention AUTH_ALLOWED_ROLES", err.Error())
	}
}

func TestLoadRejectsEmptyJSONAuthAllowedCertsWhenAuthEnabled(t *testing.T) {
	unsetMigrateDatabaseURLForTest(t)
	t.Setenv("LOCAL_AUTH_DISABLE", "false")
	t.Setenv("SSO_HOST", "sso.godaddy.com")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SERVER_CERT_PATH", "/tmp/cert.pem")
	t.Setenv("SERVER_KEY_PATH", "/tmp/key.pem")
	t.Setenv("AUTH_ALLOWED_ROLES", `["arn:aws:iam::123:role/x"]`)
	t.Setenv("AUTH_ALLOWED_CERTS", "[]")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error when AUTH_ALLOWED_CERTS is empty JSON array")
	}
	if !strings.Contains(err.Error(), "AUTH_ALLOWED_CERTS") {
		t.Fatalf("error %q should mention AUTH_ALLOWED_CERTS", err.Error())
	}
}

func TestLoadSucceedsWhenJWTAuthEnabledWithTLSAndAllowlists(t *testing.T) {
	unsetMigrateDatabaseURLForTest(t)
	t.Setenv("LOCAL_AUTH_DISABLE", "false")
	t.Setenv("SSO_HOST", "sso.godaddy.com")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SERVER_CERT_PATH", "/tmp/cert.pem")
	t.Setenv("SERVER_KEY_PATH", "/tmp/key.pem")
	t.Setenv("AUTH_ALLOWED_ROLES", `["arn:aws:iam::123:role/x"]`)
	t.Setenv("AUTH_ALLOWED_CERTS", `["airo-builder.godaddy.com/*"]`)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.LocalAuthDisable {
		t.Fatal("LocalAuthDisable should be false")
	}
	if len(cfg.AuthAllowedRoles) != 1 || len(cfg.AuthAllowedCerts) != 1 {
		t.Fatalf("allowlists: roles=%#v certs=%#v", cfg.AuthAllowedRoles, cfg.AuthAllowedCerts)
	}
}

func TestLoadRejectsBlankAllowlistEntryWhenAuthEnabled(t *testing.T) {
	unsetMigrateDatabaseURLForTest(t)
	t.Setenv("LOCAL_AUTH_DISABLE", "false")
	t.Setenv("SSO_HOST", "sso.godaddy.com")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SERVER_CERT_PATH", "/tmp/cert.pem")
	t.Setenv("SERVER_KEY_PATH", "/tmp/key.pem")
	t.Setenv("AUTH_ALLOWED_ROLES", `[""]`)
	t.Setenv("AUTH_ALLOWED_CERTS", `["cn.example.com"]`)
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for empty string entry in AUTH_ALLOWED_ROLES")
	}
	if !strings.Contains(err.Error(), "AUTH_ALLOWED_ROLES") {
		t.Fatalf("error %q should mention AUTH_ALLOWED_ROLES", err.Error())
	}
}

func TestLoadRejectsAllowlistEntryWithPadding(t *testing.T) {
	unsetMigrateDatabaseURLForTest(t)
	t.Setenv("LOCAL_AUTH_DISABLE", "false")
	t.Setenv("SSO_HOST", "sso.godaddy.com")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SERVER_CERT_PATH", "/tmp/cert.pem")
	t.Setenv("SERVER_KEY_PATH", "/tmp/key.pem")
	t.Setenv("AUTH_ALLOWED_ROLES", `[" arn:aws:iam::123:role/airo-*"]`)
	t.Setenv("AUTH_ALLOWED_CERTS", `["cn.example.com"]`)
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for leading whitespace in allowlist entry")
	}
	if !strings.Contains(err.Error(), "AUTH_ALLOWED_ROLES") || !strings.Contains(err.Error(), "whitespace") {
		t.Fatalf("error %q should mention AUTH_ALLOWED_ROLES and whitespace", err.Error())
	}
}

func TestLoadRejectsLeadingWildcardAllowlistPattern(t *testing.T) {
	unsetMigrateDatabaseURLForTest(t)
	t.Setenv("LOCAL_AUTH_DISABLE", "false")
	t.Setenv("SSO_HOST", "sso.godaddy.com")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SERVER_CERT_PATH", "/tmp/cert.pem")
	t.Setenv("SERVER_KEY_PATH", "/tmp/key.pem")
	t.Setenv("AUTH_ALLOWED_ROLES", `["arn:aws:iam::123:role/airo-*"]`)
	t.Setenv("AUTH_ALLOWED_CERTS", `["*.airo-builder.godaddy.com"]`)
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for leading-* cert pattern (not supported by matchesAllowlist)")
	}
	if !strings.Contains(err.Error(), "AUTH_ALLOWED_CERTS") || !strings.Contains(err.Error(), "*") {
		t.Fatalf("error %q should mention AUTH_ALLOWED_CERTS and unsupported leading *", err.Error())
	}
}

func TestLoadAllowsHTTPWhenAuthDisabled(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SERVER_CERT_PATH", "")
	t.Setenv("SERVER_KEY_PATH", "")
	_, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadRejectsHalfConfiguredTLS(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SERVER_CERT_PATH", "/tmp/cert.pem")
	t.Setenv("SERVER_KEY_PATH", "")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error when only SERVER_CERT_PATH is set")
	}
	if !strings.Contains(err.Error(), "SERVER_CERT_PATH") {
		t.Fatalf("error %q should mention SERVER_CERT_PATH", err.Error())
	}
}

func TestLoadRejectsHalfConfiguredTLSKeyOnly(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SERVER_CERT_PATH", "")
	t.Setenv("SERVER_KEY_PATH", "/tmp/key.pem")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error when only SERVER_KEY_PATH is set")
	}
	if !strings.Contains(err.Error(), "SERVER_KEY_PATH") {
		t.Fatalf("error %q should mention SERVER_KEY_PATH", err.Error())
	}
}

func TestLoadRejectsSingleQuotedArrayWithApostropheInValue(t *testing.T) {
	t.Setenv("LOCAL_AUTH_DISABLE", "true")
	t.Setenv("SSO_HOST", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("AUTH_ALLOWED_ROLES", "['O'Reilly']")
	t.Setenv("AUTH_ALLOWED_CERTS", "")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error: interior single quote is not a valid 'a','b' list")
	}
	if !strings.Contains(err.Error(), "AUTH_ALLOWED_ROLES") {
		t.Fatalf("error: %v", err)
	}
}

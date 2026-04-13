package config

import (
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

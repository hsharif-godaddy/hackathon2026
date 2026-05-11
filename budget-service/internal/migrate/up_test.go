package migrate

import (
	"os"
	"testing"
)

func TestUpSuccess(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set (integration)")
	}

	// Up is idempotent — running on an already-migrated DB returns nil (ErrNoChange handled).
	if err := Up(dsn); err != nil {
		t.Fatalf("Up: %v", err)
	}
}

func TestUpInvalidDSN(t *testing.T) {
	err := Up("postgres://invalid:invalid@localhost:1/nonexistent?sslmode=disable&connect_timeout=1")
	if err == nil {
		t.Fatal("expected error for invalid DSN")
	}
}

package checks

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestDevCACheck_Present(t *testing.T) {
	root := t.TempDir()
	caDir := filepath.Join(root, ".dev-ca")
	if err := os.MkdirAll(caDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"ca-cert.pem", "ca-key.pem"} {
		if err := os.WriteFile(filepath.Join(caDir, f), []byte("test"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	result := (&DevCACheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestDevCACheck_Missing(t *testing.T) {
	root := t.TempDir()

	result := (&DevCACheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn for missing CA, got %v: %s", result.Status, result.Message)
	}
	if result.InstallHint == "" {
		t.Error("expected InstallHint")
	}
}

func TestDevCACheck_PartialMissing(t *testing.T) {
	root := t.TempDir()
	caDir := filepath.Join(root, ".dev-ca")
	if err := os.MkdirAll(caDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(caDir, "ca-cert.pem"), []byte("test"), 0o600); err != nil {
		t.Fatal(err)
	}
	// ca-key.pem intentionally missing

	result := (&DevCACheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn for partial CA, got %v: %s", result.Status, result.Message)
	}
}

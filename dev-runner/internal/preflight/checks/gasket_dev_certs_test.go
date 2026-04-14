package checks

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestGasketDevCertsCheck_Present(t *testing.T) {
	root := t.TempDir()
	certsDir := filepath.Join(root, "app", "node_modules", "@godaddy",
		"gasket-plugin-dev-certs", "certs")
	if err := os.MkdirAll(certsDir, 0755); err != nil {
		t.Fatal(err)
	}

	for _, f := range []string{
		"_.gasket.dev-godaddy.com.crt",
		"_.gasket.dev-godaddy.com.key",
		"_.gasket.dev-godaddy.com_intermediate_chain.crt",
	} {
		if err := os.WriteFile(filepath.Join(certsDir, f), []byte("test"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	result := (&GasketDevCertsCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Errorf("expected pass, got %v: %s", result.Status, result.Message)
	}
}

func TestGasketDevCertsCheck_Missing(t *testing.T) {
	root := t.TempDir()

	result := (&GasketDevCertsCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusFail {
		t.Errorf("expected fail, got %v: %s", result.Status, result.Message)
	}
}

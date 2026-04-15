package checks

import (
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestCheckEnvFile_Missing(t *testing.T) {
	dir := t.TempDir()
	// Use a project root where the env file definitely does not exist.
	result := checkEnvFile(dir, "app/.env", []string{"NODE_ENV"}, "Test Check", "Environment")

	if result.Status != preflight.StatusFail {
		t.Errorf("expected StatusFail for missing file, got %v", result.Status)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true for missing file")
	}
}

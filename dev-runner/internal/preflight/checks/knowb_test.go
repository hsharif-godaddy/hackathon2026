package checks

import (
	"context"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestKnowBCheck_NotConfigured(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "NODE_ENV=development\n")

	result := (&KnowBCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn for missing config, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable to be true")
	}
}

func TestKnowBCheck_ConfiguredMissingSSO(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "NODE_ENV=development\n")

	result := (&KnowBCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn, got %v: %s", result.Status, result.Message)
	}
}

func TestKnowBCheck_MissingEnvFile(t *testing.T) {
	root := t.TempDir()

	result := (&KnowBCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn for missing .env, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable to be true")
	}
}

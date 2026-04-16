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

func TestKnowBCheck_S2SAuth(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "GOCODE_USE_S2S_AUTH=true\n")

	result := (&KnowBCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass with S2S auth, got %v: %s", result.Status, result.Message)
	}
}

func TestKnowBCheck_WithSSOJWT(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "SSO_JWT=some-token\n")

	result := (&KnowBCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass with SSO_JWT set, got %v: %s", result.Status, result.Message)
	}
}

package checks

import (
	"context"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestJWTKeysCheck_BothConfigured(t *testing.T) {
	root := t.TempDir()
	writeAppEnv(t, root, "JWT_PRIVATE_KEY=\"priv\"\nJWT_PUBLIC_KEY=\"pub\"\n")
	writeAgentsEnv(t, root, "JWT_PUBLIC_KEY=\"pub\"\n")

	result := (&JWTKeysCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestJWTKeysCheck_MissingAll(t *testing.T) {
	root := t.TempDir()
	writeAppEnv(t, root, "NODE_ENV=development\n")
	writeAgentsEnv(t, root, "NODE_ENV=development\n")

	result := (&JWTKeysCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true")
	}
}

func TestJWTKeysCheck_MissingAgentsPublicKey(t *testing.T) {
	root := t.TempDir()
	writeAppEnv(t, root, "JWT_PRIVATE_KEY=\"priv\"\nJWT_PUBLIC_KEY=\"pub\"\n")
	writeAgentsEnv(t, root, "NODE_ENV=development\n")

	result := (&JWTKeysCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn, got %v: %s", result.Status, result.Message)
	}
}

func TestJWTKeysCheck_NoEnvFiles(t *testing.T) {
	root := t.TempDir()

	result := (&JWTKeysCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusSkip {
		t.Errorf("expected Skip, got %v: %s", result.Status, result.Message)
	}
}

func TestJWTKeysCheck_OnlyAppEnvExists(t *testing.T) {
	root := t.TempDir()
	writeAppEnv(t, root, "NODE_ENV=development\n")
	// agents/.env missing - should still warn about app keys, not about missing file

	result := (&JWTKeysCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn, got %v: %s", result.Status, result.Message)
	}
}

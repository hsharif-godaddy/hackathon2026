package checks

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestArtifactoryCheck_WithAuth(t *testing.T) {
	// Create a temporary home dir with a valid .npmrc
	tmpHome := t.TempDir()
	npmrc := filepath.Join(tmpHome, ".npmrc")
	content := "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=abc123\n"
	if err := os.WriteFile(npmrc, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	// Override HOME for this test
	origHome := os.Getenv("HOME")
	t.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	result := (&ArtifactoryCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestArtifactoryCheck_MissingNpmrc(t *testing.T) {
	tmpHome := t.TempDir()

	origHome := os.Getenv("HOME")
	t.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	result := (&ArtifactoryCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail, got %v: %s", result.Status, result.Message)
	}
	if result.InstallHint == "" {
		t.Error("expected InstallHint")
	}
}

func TestArtifactoryCheck_NpmrcWithoutArtifactory(t *testing.T) {
	tmpHome := t.TempDir()
	npmrc := filepath.Join(tmpHome, ".npmrc")
	if err := os.WriteFile(npmrc, []byte("registry=https://registry.npmjs.org/\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	origHome := os.Getenv("HOME")
	t.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	result := (&ArtifactoryCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail, got %v: %s", result.Status, result.Message)
	}
}

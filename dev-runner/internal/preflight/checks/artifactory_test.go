package checks

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/jfrog"
)

func TestArtifactoryCheck_ValidToken(t *testing.T) {
	stubProbe(t, http.StatusOK)

	tmpHome := t.TempDir()
	npmrc := filepath.Join(tmpHome, ".npmrc")
	content := "//gdartifactory1.jfrog.io/artifactory/api/npm/:_authToken=abc123\n"
	if err := os.WriteFile(npmrc, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", tmpHome)

	result := (&ArtifactoryCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestArtifactoryCheck_ExpiredToken(t *testing.T) {
	stubProbe(t, http.StatusUnauthorized)

	tmpHome := t.TempDir()
	npmrc := filepath.Join(tmpHome, ".npmrc")
	content := "//gdartifactory1.jfrog.io/artifactory/api/npm/:_authToken=expired-jwt\n"
	if err := os.WriteFile(npmrc, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", tmpHome)

	result := (&ArtifactoryCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusFail {
		t.Fatalf("expected Fail for rejected token, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true so dev-runner offers pnpm login")
	}
	if result.InstallHint == "" {
		t.Error("expected InstallHint pointing at pnpm login")
	}
}

func TestArtifactoryCheck_RevokedToken(t *testing.T) {
	stubProbe(t, http.StatusForbidden)

	tmpHome := t.TempDir()
	npmrc := filepath.Join(tmpHome, ".npmrc")
	content := "//gdartifactory1.jfrog.io/artifactory/api/npm/:_authToken=revoked\n"
	if err := os.WriteFile(npmrc, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", tmpHome)

	result := (&ArtifactoryCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail for 403, got %v", result.Status)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true")
	}
}

func TestArtifactoryCheck_OfflinePasses(t *testing.T) {
	// Closed local listener -> connection refused (deterministic non-auth
	// failure). Avoids TEST-NET-1, which transparent proxies in some corp
	// environments intercept and turn into real HTTP responses.
	stubProbeUnreachable(t)

	prevTimeout := jfrog.ProbeTimeout
	jfrog.ProbeTimeout = 100 * time.Millisecond
	t.Cleanup(func() { jfrog.ProbeTimeout = prevTimeout })

	tmpHome := t.TempDir()
	npmrc := filepath.Join(tmpHome, ".npmrc")
	content := "//gdartifactory1.jfrog.io/artifactory/api/npm/:_authToken=offline\n"
	if err := os.WriteFile(npmrc, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", tmpHome)

	result := (&ArtifactoryCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass when offline (inconclusive probe), got %v: %s", result.Status, result.Message)
	}
}

func TestArtifactoryCheck_MissingNpmrc(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

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
	t.Setenv("HOME", tmpHome)

	result := (&ArtifactoryCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true")
	}
}

func TestArtifactoryCheck_NarrowNpmScope(t *testing.T) {
	// Token is valid at Artifactory but scoped to a single repo path.
	// pnpm install for packages in other jfrog npm repos will 401, so this
	// is treated as a fixable failure even though the probe succeeds.
	stubProbe(t, http.StatusOK)

	tmpHome := t.TempDir()
	npmrc := filepath.Join(tmpHome, ".npmrc")
	content := "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=abc123\n"
	if err := os.WriteFile(npmrc, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", tmpHome)

	result := (&ArtifactoryCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusFail {
		t.Fatalf("expected Fail for narrow npm scope, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true so dev-runner offers auto-broaden")
	}
	if !strings.Contains(result.Message, "node-virt") {
		t.Errorf("expected message to mention the narrow prefix, got %q", result.Message)
	}
}

func TestArtifactoryCheck_NpmrcWithoutToken(t *testing.T) {
	tmpHome := t.TempDir()
	npmrc := filepath.Join(tmpHome, ".npmrc")
	content := "registry=https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/\n"
	if err := os.WriteFile(npmrc, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", tmpHome)

	result := (&ArtifactoryCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail when _authToken missing, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true")
	}
}

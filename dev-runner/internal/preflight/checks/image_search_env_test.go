package checks

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func writeImageSearchEnv(t *testing.T, projectRoot, content string) {
	t.Helper()
	dir := filepath.Join(projectRoot, "image-search-service")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir image-search-service/: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(content), 0o600); err != nil {
		t.Fatalf("write image-search-service/.env: %v", err)
	}
}

func TestImageSearchEnvCheck_MissingEnvFile(t *testing.T) {
	root := t.TempDir()

	result := (&ImageSearchEnvCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail for missing file, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true")
	}
}

func TestImageSearchEnvCheck_EnvExistsRequiredKeysPresent(t *testing.T) {
	root := t.TempDir()
	writeImageSearchEnv(t, root, "AWS_PROFILE=airobuild-dev-private-sso\nGETTY_AUTH_TYPE=oauth2\nANTHROPIC_API_URL=https://example.com\n")

	result := (&ImageSearchEnvCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestImageSearchEnvCheck_SSOJWTWithCertsPresent(t *testing.T) {
	root := t.TempDir()
	certsDir := filepath.Join(root, "image-search-service", "certs")
	if err := os.MkdirAll(certsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	certFile := filepath.Join(certsDir, "client.crt")
	keyFile := filepath.Join(certsDir, "client.key")
	os.WriteFile(certFile, []byte("fake cert"), 0o600)
	os.WriteFile(keyFile, []byte("fake key"), 0o600)

	writeImageSearchEnv(t, root, "AWS_PROFILE=airobuild-dev-private-sso\nGETTY_AUTH_TYPE=sso-jwt\nANTHROPIC_API_URL=https://example.com\nGETTY_CERT_PATH="+certFile+"\nGETTY_KEY_PATH="+keyFile+"\n")

	result := (&ImageSearchEnvCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass with certs present, got %v: %s", result.Status, result.Message)
	}
}

func TestImageSearchEnvCheck_SSOJWTMissingCertPaths(t *testing.T) {
	root := t.TempDir()
	writeImageSearchEnv(t, root, "AWS_PROFILE=airobuild-dev-private-sso\nGETTY_AUTH_TYPE=sso-jwt\nANTHROPIC_API_URL=https://example.com\n")

	result := (&ImageSearchEnvCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail when cert paths not set, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true")
	}
}

func TestImageSearchEnvCheck_SSOJWTCertFileMissing(t *testing.T) {
	root := t.TempDir()
	writeImageSearchEnv(t, root, "AWS_PROFILE=airobuild-dev-private-sso\nGETTY_AUTH_TYPE=sso-jwt\nANTHROPIC_API_URL=https://example.com\nGETTY_CERT_PATH=/nonexistent/client.crt\nGETTY_KEY_PATH=/nonexistent/client.key\n")

	result := (&ImageSearchEnvCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail when cert file missing from disk, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true")
	}
}

func TestImageSearchEnvCheck_SSOJWTKeyFileMissing(t *testing.T) {
	root := t.TempDir()
	certsDir := filepath.Join(root, "image-search-service", "certs")
	if err := os.MkdirAll(certsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	certFile := filepath.Join(certsDir, "client.crt")
	os.WriteFile(certFile, []byte("fake cert"), 0o600)

	writeImageSearchEnv(t, root, "AWS_PROFILE=airobuild-dev-private-sso\nGETTY_AUTH_TYPE=sso-jwt\nANTHROPIC_API_URL=https://example.com\nGETTY_CERT_PATH="+certFile+"\nGETTY_KEY_PATH=/nonexistent/client.key\n")

	result := (&ImageSearchEnvCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail when key file missing from disk, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true")
	}
}

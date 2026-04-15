package fixers

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestJWTKeysFixer_GeneratesValidKeys(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "app", "NODE_ENV=development\n")
	writeEnv(t, root, "agents", "NODE_ENV=development\n")

	fixer := &JWTKeysFixer{}
	if err := fixer.Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	// Verify app/.env has both keys
	appEnv := readEnvMap(t, filepath.Join(root, "app", ".env"))
	privRaw := appEnv["JWT_PRIVATE_KEY"]
	pubRaw := appEnv["JWT_PUBLIC_KEY"]

	if privRaw == "" {
		t.Fatal("JWT_PRIVATE_KEY missing from app/.env")
	}
	if pubRaw == "" {
		t.Fatal("JWT_PUBLIC_KEY missing from app/.env")
	}

	// Verify agents/.env has public key only
	agentsEnv := readEnvMap(t, filepath.Join(root, "agents", ".env"))
	if agentsEnv["JWT_PUBLIC_KEY"] == "" {
		t.Fatal("JWT_PUBLIC_KEY missing from agents/.env")
	}
	if agentsEnv["JWT_PRIVATE_KEY"] != "" {
		t.Error("JWT_PRIVATE_KEY should not be in agents/.env")
	}

	// Verify the keys are valid PEM and parse as RSA
	privPEM := strings.ReplaceAll(privRaw, "\\n", "\n")
	block, _ := pem.Decode([]byte(privPEM))
	if block == nil {
		t.Fatal("private key is not valid PEM")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("private key does not parse as PKCS8: %v", err)
	}
	if key == nil {
		t.Fatal("parsed private key is nil")
	}

	pubPEM := strings.ReplaceAll(pubRaw, "\\n", "\n")
	pubBlock, _ := pem.Decode([]byte(pubPEM))
	if pubBlock == nil {
		t.Fatal("public key is not valid PEM")
	}
	_, err = x509.ParsePKIXPublicKey(pubBlock.Bytes)
	if err != nil {
		t.Fatalf("public key does not parse as PKIX: %v", err)
	}
}

func TestJWTKeysFixer_ReusesExistingKeys(t *testing.T) {
	root := t.TempDir()

	// Generate keys once
	writeEnv(t, root, "app", "NODE_ENV=development\n")
	writeEnv(t, root, "agents", "NODE_ENV=development\n")

	fixer := &JWTKeysFixer{}
	if err := fixer.Fix(context.Background(), root); err != nil {
		t.Fatalf("first Fix() failed: %v", err)
	}

	appEnv1 := readEnvMap(t, filepath.Join(root, "app", ".env"))
	privKey1 := appEnv1["JWT_PRIVATE_KEY"]

	// Remove agents public key to trigger fixer again
	agentsPath := filepath.Join(root, "agents", ".env")
	content, _ := os.ReadFile(agentsPath)
	filtered := ""
	for _, line := range strings.Split(string(content), "\n") {
		if !strings.HasPrefix(line, "JWT_PUBLIC_KEY=") {
			filtered += line + "\n"
		}
	}
	os.WriteFile(agentsPath, []byte(filtered), 0o600)

	// Run fixer again - should reuse existing private key
	if err := fixer.Fix(context.Background(), root); err != nil {
		t.Fatalf("second Fix() failed: %v", err)
	}

	appEnv2 := readEnvMap(t, filepath.Join(root, "app", ".env"))
	if appEnv2["JWT_PRIVATE_KEY"] != privKey1 {
		t.Error("fixer generated a new private key instead of reusing the existing one")
	}
}

// writeEnv creates a .env file under root/service/.env.
func writeEnv(t *testing.T, root, service, content string) {
	t.Helper()
	dir := filepath.Join(root, service)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", service, err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(content), 0o600); err != nil {
		t.Fatalf("write %s/.env: %v", service, err)
	}
}

// readEnvMap reads a .env file and returns a key-value map.
func readEnvMap(t *testing.T, path string) map[string]string {
	t.Helper()
	env, err := preflight.ParseEnvFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	return env
}

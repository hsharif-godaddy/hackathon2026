package fixers

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type JWTFixer struct{}

func (f *JWTFixer) Fix(ctx context.Context, projectRoot string) error {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return fmt.Errorf("generating RSA key: %w", err)
	}

	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	})

	pubBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return fmt.Errorf("marshaling public key: %w", err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubBytes,
	})

	// Escape newlines so PEM values are single-line in .env files
	privStr := strings.ReplaceAll(strings.TrimSpace(string(privPEM)), "\n", "\\n")
	pubStr := strings.ReplaceAll(strings.TrimSpace(string(pubPEM)), "\n", "\\n")

	// Update app/.env with both keys
	appEnvPath := filepath.Join(projectRoot, "app/.env")
	if err := upsertEnvVar(appEnvPath, "JWT_PRIVATE_KEY", privStr); err != nil {
		return fmt.Errorf("updating app/.env: %w", err)
	}
	if err := upsertEnvVar(appEnvPath, "JWT_PUBLIC_KEY", pubStr); err != nil {
		return fmt.Errorf("updating app/.env: %w", err)
	}

	// Update agents/.env with public key only
	agentsEnvPath := filepath.Join(projectRoot, "agents/.env")
	if err := upsertEnvVar(agentsEnvPath, "JWT_PUBLIC_KEY", pubStr); err != nil {
		return fmt.Errorf("updating agents/.env: %w", err)
	}

	return nil
}

// upsertEnvVar adds or replaces a key in a .env file.
// Uses atomic temp-file + rename to avoid partial writes.
func upsertEnvVar(path string, key string, value string) error {
	content, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	quotedValue := `"` + value + `"`
	newLine := key + "=" + quotedValue

	lines := strings.Split(string(content), "\n")
	found := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, key+"=") {
			lines[i] = newLine
			found = true
			break
		}
	}

	if !found {
		lines = append(lines, "", newLine)
	}

	// Atomic write: temp file in same dir, then rename
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("creating directory %s: %w", dir, err)
	}

	tmp, err := os.CreateTemp(dir, ".env.tmp.*")
	if err != nil {
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmp.Name()

	if _, err := tmp.WriteString(strings.Join(lines, "\n")); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmp.Chmod(0600); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("chmod temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("closing temp file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("renaming temp file: %w", err)
	}

	return nil
}

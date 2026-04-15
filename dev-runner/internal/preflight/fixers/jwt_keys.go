package fixers

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// JWTKeysFixer generates an RSA 2048-bit keypair and writes the keys to
// app/.env (private + public) and agents/.env (public only).
type JWTKeysFixer struct{}

func (f *JWTKeysFixer) Fix(_ context.Context, projectRoot string) error {
	appEnvPath := filepath.Join(projectRoot, "app", ".env")
	agentsEnvPath := filepath.Join(projectRoot, "agents", ".env")

	privStr, pubStr, err := f.resolveKeys(appEnvPath)
	if err != nil {
		return err
	}

	// app/.env gets both keys
	if err := upsertEnvVar(appEnvPath, "JWT_PRIVATE_KEY", privStr); err != nil {
		return fmt.Errorf("writing JWT_PRIVATE_KEY to app/.env: %w", err)
	}
	if err := upsertEnvVar(appEnvPath, "JWT_PUBLIC_KEY", pubStr); err != nil {
		return fmt.Errorf("writing JWT_PUBLIC_KEY to app/.env: %w", err)
	}

	// agents/.env gets public key only
	if err := upsertEnvVar(agentsEnvPath, "JWT_PUBLIC_KEY", pubStr); err != nil {
		return fmt.Errorf("writing JWT_PUBLIC_KEY to agents/.env: %w", err)
	}

	return nil
}

// resolveKeys returns the private and public key strings to write. If app/.env
// already has a valid private key, it reuses it (and derives the public key)
// rather than generating a new keypair that would rotate existing tokens.
func (f *JWTKeysFixer) resolveKeys(appEnvPath string) (privStr, pubStr string, err error) {
	privStr, pubStr, err = readExistingKeys(appEnvPath)
	if err == nil {
		return privStr, pubStr, nil
	}

	// No usable existing key - generate a fresh keypair.
	return generateKeyPair()
}

// readExistingKeys reads JWT_PRIVATE_KEY from an env file, parses the RSA key,
// and derives the public key from it. Returns encoded strings ready for .env.
func readExistingKeys(envPath string) (privStr, pubStr string, err error) {
	env, err := preflight.ParseEnvFile(envPath)
	if err != nil {
		return "", "", err
	}

	raw := strings.TrimSpace(env["JWT_PRIVATE_KEY"])
	if raw == "" {
		return "", "", fmt.Errorf("no JWT_PRIVATE_KEY")
	}

	// Unescape literal \n back to newlines for PEM decoding.
	pemData := strings.ReplaceAll(raw, "\\n", "\n")
	block, _ := pem.Decode([]byte(pemData))
	if block == nil {
		return "", "", fmt.Errorf("invalid PEM in JWT_PRIVATE_KEY")
	}

	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", "", fmt.Errorf("parsing private key: %w", err)
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return "", "", fmt.Errorf("private key is not RSA")
	}

	privStr = strings.ReplaceAll(strings.TrimSpace(pemData), "\n", "\\n")
	pubStr, err = encodePublicKey(&rsaKey.PublicKey)
	if err != nil {
		return "", "", err
	}
	return privStr, pubStr, nil
}

func generateKeyPair() (privStr, pubStr string, err error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return "", "", fmt.Errorf("generating RSA key: %w", err)
	}

	privDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return "", "", fmt.Errorf("marshaling private key: %w", err)
	}
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER})

	pubStr, err = encodePublicKey(&privateKey.PublicKey)
	if err != nil {
		return "", "", err
	}

	// Encode newlines as literal \n for .env storage (matches generate-jwt-keys.js).
	privStr = strings.ReplaceAll(strings.TrimSpace(string(privPEM)), "\n", "\\n")
	return privStr, pubStr, nil
}

func encodePublicKey(pub *rsa.PublicKey) (string, error) {
	pubDER, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return "", fmt.Errorf("marshaling public key: %w", err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})
	return strings.ReplaceAll(strings.TrimSpace(string(pubPEM)), "\n", "\\n"), nil
}

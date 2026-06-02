// Package testkeys generates ephemeral RSA key material + a self-signed
// non-CA leaf certificate at test time. Used by every test in the
// signing pipeline that needs a working signer.
//
// Why this exists: committing a real RSA private key — even one labeled
// "test" — trips GitHub Push Protection (and any other secret scanner)
// and leaks fixture material into git history. Generating fresh keys at
// test time costs ~30ms per test binary and produces an unambiguous
// "this is a test artifact" signal.
//
// The generated cert is non-CA (BasicConstraints CA:FALSE) so the
// signing package's leaf-cert detection picks it up on the leaf branch
// and not the fallback path.
package testkeys

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Material holds an ephemeral key pair + cert + key-id, in both PEM
// bytes and on-disk paths. The on-disk paths are useful for tests that
// exercise signing.Load (which reads from env-named files); in-memory
// PEMs are useful for signing.NewForTesting.
type Material struct {
	KeyPEM    []byte
	CertPEM   []byte
	KeyIDPath string
	KeyPath   string
	CertPath  string
	KeyID     string
}

// Generate produces fresh test material rooted in t.TempDir(). All
// files are auto-cleaned by the testing framework when the test ends.
//
// Use the returned Material's PEM bytes with signing.NewForTesting for
// most tests; use the *Path fields when exercising signing.Load via
// env vars.
func Generate(t testing.TB) Material {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			Organization:       []string{"AiroTest"},
			OrganizationalUnit: []string{"signing-tests"},
			CommonName:         "test-cell-smtp-signing",
		},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  false, // critical: leaf, not CA — signing package's leaf-detection branch
	}
	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create self-signed cert: %v", err)
	}

	keyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})
	certPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: certDER,
	})

	dir := t.TempDir()
	keyPath := filepath.Join(dir, "test_key.pem")
	certPath := filepath.Join(dir, "test_cert.pem")
	keyIDPath := filepath.Join(dir, "test_key_id")
	keyID := fmt.Sprintf("test-cell-%d", time.Now().UnixNano())

	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		t.Fatalf("write test key: %v", err)
	}
	if err := os.WriteFile(certPath, certPEM, 0o644); err != nil { //nolint:gosec // test fixture
		t.Fatalf("write test cert: %v", err)
	}
	if err := os.WriteFile(keyIDPath, []byte(keyID+"\n"), 0o644); err != nil { //nolint:gosec // test fixture
		t.Fatalf("write test key id: %v", err)
	}

	return Material{
		KeyPEM:    keyPEM,
		CertPEM:   certPEM,
		KeyIDPath: keyIDPath,
		KeyPath:   keyPath,
		CertPath:  certPath,
		KeyID:     keyID,
	}
}

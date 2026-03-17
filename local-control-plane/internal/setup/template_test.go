package setup

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"testing"
	"time"
)

func TestSanitizeForDB(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"lowercase kept", "abcxyz", "abcxyz"},
		{"digits kept", "012789", "012789"},
		{"mixed kept", "abc123", "abc123"},
		{"uppercase stripped", "AbCdEf", "bdf"},
		{"special chars stripped", "app-id_123!@#", "appid123"},
		{"empty string", "", ""},
		{"all stripped", "ABC!@#", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sanitizeForDB(tt.input)
			if got != tt.expected {
				t.Errorf("sanitizeForDB(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestCreateCertificate(t *testing.T) {
	// Use a TemplateSetup with a non-existent CA dir so it falls back to self-signed
	ts := &TemplateSetup{
		appsBaseDir: t.TempDir(),
		templateDir: t.TempDir(),
	}
	t.Setenv("PROJECT_ROOT", t.TempDir())

	certPEM, keyPEM, err := ts.createCertificate()
	if err != nil {
		t.Fatalf("createCertificate: %v", err)
	}

	// Verify cert PEM
	certBlock, _ := pem.Decode(certPEM)
	if certBlock == nil {
		t.Fatal("failed to decode cert PEM")
	}
	if certBlock.Type != "CERTIFICATE" {
		t.Fatalf("expected CERTIFICATE block, got %s", certBlock.Type)
	}

	cert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		t.Fatalf("ParseCertificate: %v", err)
	}

	if cert.Subject.CommonName != "localhost" {
		t.Errorf("expected CN=localhost, got %s", cert.Subject.CommonName)
	}

	if len(cert.DNSNames) == 0 || cert.DNSNames[0] != "localhost" {
		t.Errorf("expected DNSNames=[localhost], got %v", cert.DNSNames)
	}

	if len(cert.IPAddresses) < 2 {
		t.Errorf("expected at least 2 IP addresses (127.0.0.1 and ::1), got %v", cert.IPAddresses)
	}

	hasLoopback := false
	for _, ip := range cert.IPAddresses {
		if ip.Equal(net.ParseIP("127.0.0.1")) {
			hasLoopback = true
		}
	}
	if !hasLoopback {
		t.Error("expected 127.0.0.1 in IPAddresses")
	}

	if cert.NotAfter.Before(time.Now().Add(364 * 24 * time.Hour)) {
		t.Error("expected cert valid for ~1 year")
	}

	// Verify key PEM
	keyBlock, _ := pem.Decode(keyPEM)
	if keyBlock == nil {
		t.Fatal("failed to decode key PEM")
	}
	if keyBlock.Type != "EC PRIVATE KEY" {
		t.Fatalf("expected EC PRIVATE KEY block, got %s", keyBlock.Type)
	}

	_, err = x509.ParseECPrivateKey(keyBlock.Bytes)
	if err != nil {
		t.Fatalf("ParseECPrivateKey: %v", err)
	}
}

func TestSignWithCA(t *testing.T) {
	// Generate a test CA
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate CA key: %v", err)
	}

	caTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Test CA"},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}

	caCertDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("create CA cert: %v", err)
	}

	caCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caCertDER})

	caKeyDER, err := x509.MarshalPKCS8PrivateKey(caKey)
	if err != nil {
		t.Fatalf("marshal CA key: %v", err)
	}
	caKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: caKeyDER})

	// Generate a leaf key and template
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate leaf key: %v", err)
	}

	leafTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "localhost"},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}

	// Sign with CA
	certDER, err := signWithCA(leafTemplate, leafKey, caCertPEM, caKeyPEM)
	if err != nil {
		t.Fatalf("signWithCA: %v", err)
	}
	if certDER == nil {
		t.Fatal("expected non-nil cert DER")
	}

	// Parse and verify
	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		t.Fatalf("ParseCertificate: %v", err)
	}

	caCert, _ := x509.ParseCertificate(caCertDER)
	pool := x509.NewCertPool()
	pool.AddCert(caCert)

	_, err = cert.Verify(x509.VerifyOptions{
		Roots: pool,
	})
	if err != nil {
		t.Fatalf("cert verification failed: %v", err)
	}
}

func TestSignWithCAInvalidPEM(t *testing.T) {
	leafKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "localhost"},
	}

	t.Run("invalid cert PEM", func(t *testing.T) {
		_, err := signWithCA(template, leafKey, []byte("not-pem"), []byte("not-pem"))
		if err == nil {
			t.Fatal("expected error for invalid PEM")
		}
	})

	t.Run("valid cert but invalid key PEM", func(t *testing.T) {
		// Generate a valid CA cert PEM
		caKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		caTemplate := &x509.Certificate{
			SerialNumber:          big.NewInt(1),
			Subject:               pkix.Name{CommonName: "Test CA"},
			NotBefore:             time.Now(),
			NotAfter:              time.Now().Add(time.Hour),
			IsCA:                  true,
			BasicConstraintsValid: true,
			KeyUsage:              x509.KeyUsageCertSign,
		}
		caCertDER, _ := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
		caCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caCertDER})

		_, err := signWithCA(template, leafKey, caCertPEM, []byte("not-pem"))
		if err == nil {
			t.Fatal("expected error for invalid key PEM")
		}
	})
}

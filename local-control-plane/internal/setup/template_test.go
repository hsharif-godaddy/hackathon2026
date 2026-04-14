package setup

import (
	"os"
	"path/filepath"
	"testing"
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

func TestGasketCertDir(t *testing.T) {
	t.Setenv("PROJECT_ROOT", "/fake/root")
	got := gasketCertDir()
	want := "/fake/root/app/node_modules/@godaddy/gasket-plugin-dev-certs/certs"
	if got != want {
		t.Errorf("gasketCertDir() = %q, want %q", got, want)
	}
}

func TestGasketCertDirDefault(t *testing.T) {
	t.Setenv("PROJECT_ROOT", "")
	got := gasketCertDir()
	want := filepath.Join("..", "app", "node_modules", "@godaddy", "gasket-plugin-dev-certs", "certs")
	if got != want {
		t.Errorf("gasketCertDir() = %q, want %q", got, want)
	}
}

func TestLoadGasketCert(t *testing.T) {
	// Create a temp dir with fake cert files
	certDir := t.TempDir()
	leafContent := []byte("-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----\n")
	chainContent := []byte("-----BEGIN CERTIFICATE-----\nchain\n-----END CERTIFICATE-----\n")
	keyContent := []byte("-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n")

	for _, f := range []struct {
		name string
		data []byte
		perm os.FileMode
	}{
		{"_.gasket.dev-godaddy.com.crt", leafContent, 0644},
		{"_.gasket.dev-godaddy.com_intermediate_chain.crt", chainContent, 0644},
		{"_.gasket.dev-godaddy.com.key", keyContent, 0600},
	} {
		if err := os.WriteFile(filepath.Join(certDir, f.name), f.data, f.perm); err != nil {
			t.Fatalf("WriteFile %s: %v", f.name, err)
		}
	}

	// Point PROJECT_ROOT so gasketCertDir() resolves to our temp dir
	// gasketCertDir = PROJECT_ROOT/app/node_modules/@godaddy/gasket-plugin-dev-certs/certs
	// So we need to create that structure
	projectRoot := t.TempDir()
	targetDir := filepath.Join(projectRoot, "app", "node_modules", "@godaddy", "gasket-plugin-dev-certs", "certs")
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	for _, f := range []struct {
		name string
		data []byte
		perm os.FileMode
	}{
		{"_.gasket.dev-godaddy.com.crt", leafContent, 0644},
		{"_.gasket.dev-godaddy.com_intermediate_chain.crt", chainContent, 0644},
		{"_.gasket.dev-godaddy.com.key", keyContent, 0600},
	} {
		if err := os.WriteFile(filepath.Join(targetDir, f.name), f.data, f.perm); err != nil {
			t.Fatalf("WriteFile %s: %v", f.name, err)
		}
	}

	t.Setenv("PROJECT_ROOT", projectRoot)

	certPEM, keyPEM, err := loadGasketCert()
	if err != nil {
		t.Fatalf("loadGasketCert: %v", err)
	}

	// cert.pem should be leaf + chain concatenated
	expectedCert := append(leafContent, chainContent...)
	if string(certPEM) != string(expectedCert) {
		t.Errorf("certPEM = %q, want %q", certPEM, expectedCert)
	}

	if string(keyPEM) != string(keyContent) {
		t.Errorf("keyPEM = %q, want %q", keyPEM, keyContent)
	}
}

func TestLoadGasketCertMissing(t *testing.T) {
	t.Setenv("PROJECT_ROOT", t.TempDir())

	_, _, err := loadGasketCert()
	if err == nil {
		t.Fatal("expected error for missing cert files")
	}
}

func TestGenerateSSLCertsSkipsExisting(t *testing.T) {
	base := t.TempDir()
	previewSSL := filepath.Join(base, "preview", ".ssl")
	allocSSL := filepath.Join(base, "alloc", ".ssl")
	for _, dir := range []string{previewSSL, allocSSL} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("MkdirAll %s: %v", dir, err)
		}
		for _, name := range []string{"cert.pem", "key.pem"} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte("existing"), 0644); err != nil {
				t.Fatalf("WriteFile %s/%s: %v", dir, name, err)
			}
		}
	}

	ts := &TemplateSetup{appsBaseDir: base, templateDir: t.TempDir()}
	err := ts.generateSSLCerts("test-app", base)
	if err != nil {
		t.Fatalf("generateSSLCerts: %v", err)
	}

	// Verify it wasn't overwritten
	content, _ := os.ReadFile(filepath.Join(previewSSL, "cert.pem"))
	if string(content) != "existing" {
		t.Error("existing cert.pem was overwritten")
	}
}

func TestGenerateSSLCertsWritesBothDirs(t *testing.T) {
	// Set up fake Gasket cert files
	projectRoot := t.TempDir()
	certDir := filepath.Join(projectRoot, "app", "node_modules", "@godaddy", "gasket-plugin-dev-certs", "certs")
	if err := os.MkdirAll(certDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	leafContent := []byte("leaf-cert\n")
	chainContent := []byte("chain-cert\n")
	keyContent := []byte("private-key\n")
	for _, f := range []struct {
		name string
		data []byte
		perm os.FileMode
	}{
		{"_.gasket.dev-godaddy.com.crt", leafContent, 0644},
		{"_.gasket.dev-godaddy.com_intermediate_chain.crt", chainContent, 0644},
		{"_.gasket.dev-godaddy.com.key", keyContent, 0600},
	} {
		if err := os.WriteFile(filepath.Join(certDir, f.name), f.data, f.perm); err != nil {
			t.Fatalf("WriteFile %s: %v", f.name, err)
		}
	}

	t.Setenv("PROJECT_ROOT", projectRoot)

	base := t.TempDir()
	ts := &TemplateSetup{appsBaseDir: base, templateDir: t.TempDir()}
	err := ts.generateSSLCerts("test-app", base)
	if err != nil {
		t.Fatalf("generateSSLCerts: %v", err)
	}

	expectedCert := string(leafContent) + string(chainContent)

	for _, dir := range []string{
		filepath.Join(base, "preview", ".ssl"),
		filepath.Join(base, "alloc", ".ssl"),
	} {
		cert, err := os.ReadFile(filepath.Join(dir, "cert.pem"))
		if err != nil {
			t.Fatalf("read cert.pem from %s: %v", dir, err)
		}
		if string(cert) != expectedCert {
			t.Errorf("%s/cert.pem = %q, want %q", dir, cert, expectedCert)
		}

		key, err := os.ReadFile(filepath.Join(dir, "key.pem"))
		if err != nil {
			t.Fatalf("read key.pem from %s: %v", dir, err)
		}
		if string(key) != string(keyContent) {
			t.Errorf("%s/key.pem = %q, want %q", dir, key, keyContent)
		}
	}
}

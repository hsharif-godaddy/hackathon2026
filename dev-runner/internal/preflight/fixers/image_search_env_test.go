package fixers

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// fakeAWS writes a shell script to dir that returns canned cert/key output
// when called as `aws secretsmanager get-secret-value ...`.
func fakeAWS(t *testing.T, dir, certOutput, keyOutput string) {
	t.Helper()
	var name, content string
	certPath := "/Katana/Secrets/airobuilde/proxy/dev-private-ecs/GETTY_CERT"
	keyPath := "/Katana/Secrets/airobuilde/proxy/dev-private-ecs/GETTY_KEY"
	if runtime.GOOS == "windows" {
		name = "aws.bat"
		content = "@echo off\n" +
			"echo %* | findstr /C:\"" + certPath + "\" >nul && echo " + certOutput + " && exit /b 0\n" +
			"echo %* | findstr /C:\"" + keyPath + "\" >nul && echo " + keyOutput + " && exit /b 0\n" +
			"exit /b 1\n"
	} else {
		name = "aws"
		content = "#!/bin/sh\n" +
			"case \"$*\" in\n" +
			"  *" + certPath + "*) printf '%s\\n' '" + certOutput + "' ;;\n" +
			"  *" + keyPath + "*) printf '%s\\n' '" + keyOutput + "' ;;\n" +
			"  *) exit 1 ;;\n" +
			"esac\n"
	}
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestImageSearchEnvFixer_CreatesEnvAndCerts(t *testing.T) {
	bin := t.TempDir()
	fakeAWS(t, bin, "mock-cert-data-for-testing", "mock-key-data-for-testing")
	t.Setenv("PATH", bin)

	root := t.TempDir()
	writeEnv(t, root, "agents", "ANTHROPIC_API_KEY=test-key\nOPENAI_API_KEY=test-openai\nOPENAI_BASE_URL=https://example.com\n")
	if err := os.MkdirAll(filepath.Join(root, "image-search-service"), 0o755); err != nil {
		t.Fatal(err)
	}

	if err := (&ImageSearchEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	envContent, err := os.ReadFile(filepath.Join(root, "image-search-service", ".env"))
	if err != nil {
		t.Fatalf("reading .env: %v", err)
	}
	s := string(envContent)
	if !strings.Contains(s, "AWS_PROFILE=airobuild-dev-private-sso") {
		t.Errorf("missing AWS_PROFILE in .env:\n%s", s)
	}
	if !strings.Contains(s, "ANTHROPIC_API_KEY=test-key") {
		t.Errorf("missing ANTHROPIC_API_KEY in .env:\n%s", s)
	}
	if !strings.Contains(s, "OPENAI_API_KEY=test-openai") {
		t.Errorf("missing OPENAI_API_KEY in .env:\n%s", s)
	}
	if !strings.Contains(s, "GETTY_CERT_PATH=") {
		t.Errorf("missing GETTY_CERT_PATH in .env:\n%s", s)
	}

	certFile := filepath.Join(root, "image-search-service", "certs", "client.crt")
	keyFile := filepath.Join(root, "image-search-service", "certs", "client.key")
	if _, err := os.Stat(certFile); err != nil {
		t.Errorf("cert file not written: %v", err)
	}
	if _, err := os.Stat(keyFile); err != nil {
		t.Errorf("key file not written: %v", err)
	}

	certInfo, _ := os.Stat(certFile)
	if runtime.GOOS != "windows" && certInfo.Mode()&0o077 != 0 {
		t.Errorf("cert file permissions too open: %v", certInfo.Mode())
	}
}

func TestImageSearchEnvFixer_UpsertsCertPathsInExistingEnv(t *testing.T) {
	bin := t.TempDir()
	fakeAWS(t, bin, "mock-cert-data-for-testing", "mock-key-data-for-testing")
	t.Setenv("PATH", bin)

	root := t.TempDir()
	existing := "AWS_PROFILE=airobuild-dev-private-sso\nGETTY_AUTH_TYPE=sso-jwt\nGETTY_CERT_PATH=/old/path/client.crt\nGETTY_KEY_PATH=/old/path/client.key\nMY_CUSTOM=keepme\n"
	writeEnv(t, root, "image-search-service", existing)

	if err := (&ImageSearchEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(root, "image-search-service", ".env"))
	if err != nil {
		t.Fatalf("reading .env: %v", err)
	}
	s := string(content)
	if strings.Contains(s, "/old/path/client.crt") {
		t.Errorf("expected old cert path to be replaced, got:\n%s", s)
	}
	if !strings.Contains(s, "MY_CUSTOM=keepme") {
		t.Errorf("expected custom var preserved, got:\n%s", s)
	}
}

func TestImageSearchEnvFixer_UpsertsRequiredVarsInExistingEnv(t *testing.T) {
	bin := t.TempDir()
	fakeAWS(t, bin, "mock-cert-data-for-testing", "mock-key-data-for-testing")
	t.Setenv("PATH", bin)

	root := t.TempDir()
	// Existing env is missing AWS_PROFILE, GETTY_AUTH_TYPE, and ANTHROPIC_API_URL.
	existing := "MY_CUSTOM=keepme\n"
	writeEnv(t, root, "image-search-service", existing)

	if err := (&ImageSearchEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(root, "image-search-service", ".env"))
	if err != nil {
		t.Fatalf("reading .env: %v", err)
	}
	s := string(content)
	if !strings.Contains(s, "AWS_PROFILE=airobuild-dev-private-sso") {
		t.Errorf("expected AWS_PROFILE upserted, got:\n%s", s)
	}
	if !strings.Contains(s, "GETTY_AUTH_TYPE=sso-jwt") {
		t.Errorf("expected GETTY_AUTH_TYPE upserted, got:\n%s", s)
	}
	if !strings.Contains(s, "ANTHROPIC_API_URL=") {
		t.Errorf("expected ANTHROPIC_API_URL upserted, got:\n%s", s)
	}
	if !strings.Contains(s, "MY_CUSTOM=keepme") {
		t.Errorf("expected custom var preserved, got:\n%s", s)
	}
}

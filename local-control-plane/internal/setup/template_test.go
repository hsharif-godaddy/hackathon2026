package setup

import (
	"os"
	"os/exec"
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
		{"_.gasket.dev-godaddy.com.crt", leafContent, 0o644},
		{"_.gasket.dev-godaddy.com_intermediate_chain.crt", chainContent, 0o644},
		{"_.gasket.dev-godaddy.com.key", keyContent, 0o600},
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
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	for _, f := range []struct {
		name string
		data []byte
		perm os.FileMode
	}{
		{"_.gasket.dev-godaddy.com.crt", leafContent, 0o644},
		{"_.gasket.dev-godaddy.com_intermediate_chain.crt", chainContent, 0o644},
		{"_.gasket.dev-godaddy.com.key", keyContent, 0o600},
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
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("MkdirAll %s: %v", dir, err)
		}
		for _, name := range []string{"cert.pem", "key.pem"} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte("existing"), 0o644); err != nil {
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
	if err := os.MkdirAll(certDir, 0o755); err != nil {
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
		{"_.gasket.dev-godaddy.com.crt", leafContent, 0o644},
		{"_.gasket.dev-godaddy.com_intermediate_chain.crt", chainContent, 0o644},
		{"_.gasket.dev-godaddy.com.key", keyContent, 0o600},
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

// gitRun runs a git command with explicit git-dir/work-tree in a test repo.
func gitRun(t *testing.T, gitDir, workTree string, args ...string) {
	t.Helper()
	full := append([]string{"--git-dir=" + gitDir, "--work-tree=" + workTree}, args...)
	cmd := exec.Command("git", full...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

// makeResetTestRepo builds the git-repo/.git + preview/ layout ResetWorkspace
// expects, with one committed file, and returns the appID + committed content.
func makeResetTestRepo(t *testing.T, ts *TemplateSetup, appID string) (gitDir, workTree, committed string) {
	t.Helper()
	base := ts.GetBasePath(appID)
	gitDir = filepath.Join(base, "git-repo", ".git")
	workTree = filepath.Join(base, "preview")
	if err := os.MkdirAll(workTree, 0o755); err != nil {
		t.Fatalf("mkdir preview: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(base, "git-repo"), 0o755); err != nil {
		t.Fatalf("mkdir git-repo: %v", err)
	}

	gitRun(t, gitDir, workTree, "init", "--initial-branch=main")
	gitRun(t, gitDir, workTree, "config", "user.email", "test@airo.dev")
	gitRun(t, gitDir, workTree, "config", "user.name", "Test")

	committed = "committed content\n"
	if err := os.WriteFile(filepath.Join(workTree, "page.tsx"), []byte(committed), 0o644); err != nil {
		t.Fatalf("write page.tsx: %v", err)
	}
	gitRun(t, gitDir, workTree, "add", "-A")
	gitRun(t, gitDir, workTree, "commit", "-m", "initial")
	return gitDir, workTree, committed
}

func TestResetWorkspaceRestoresTrackedAndRemovesUntracked(t *testing.T) {
	t.Setenv("APPS_BASE_DIR", t.TempDir())
	ts := NewTemplateSetup()
	appID := "reset-app-1"
	gitDir, workTree, committed := makeResetTestRepo(t, ts, appID)

	// Agent mutates a tracked file and adds an untracked one.
	tracked := filepath.Join(workTree, "page.tsx")
	if err := os.WriteFile(tracked, []byte("agent edited this\n"), 0o644); err != nil {
		t.Fatalf("dirty tracked file: %v", err)
	}
	untracked := filepath.Join(workTree, "new-route.tsx")
	if err := os.WriteFile(untracked, []byte("agent added this\n"), 0o644); err != nil {
		t.Fatalf("write untracked file: %v", err)
	}

	if err := ts.ResetWorkspace(appID, ""); err != nil {
		t.Fatalf("ResetWorkspace: %v", err)
	}

	// Tracked file restored to the committed content.
	got, err := os.ReadFile(tracked)
	if err != nil {
		t.Fatalf("read tracked after reset: %v", err)
	}
	if string(got) != committed {
		t.Errorf("tracked file = %q, want %q", got, committed)
	}
	// Untracked file removed by clean -fd.
	if _, err := os.Stat(untracked); !os.IsNotExist(err) {
		t.Errorf("untracked file should be removed, stat err = %v", err)
	}
	_ = gitDir
}

func TestResetWorkspaceMissingRepoErrors(t *testing.T) {
	t.Setenv("APPS_BASE_DIR", t.TempDir())
	ts := NewTemplateSetup()
	if err := ts.ResetWorkspace("nonexistent-app", ""); err == nil {
		t.Fatal("expected error for missing git repo, got nil")
	}
}

func TestResetWorkspaceRejectsInvalidCommitRef(t *testing.T) {
	t.Setenv("APPS_BASE_DIR", t.TempDir())
	ts := NewTemplateSetup()
	appID := "reset-app-bad-ref"
	makeResetTestRepo(t, ts, appID)

	// Garbage and flag-shaped inputs must be rejected before exec so the target
	// can never be misread as a git flag or smuggle shell metacharacters.
	for _, bad := range []string{
		"--hard",        // leading dash → git flag
		"a; rm -rf /",   // shell metacharacters
		"branch name",   // whitespace
		"feat$(whoami)", // command substitution chars
	} {
		if err := ts.ResetWorkspace(appID, bad); err == nil {
			t.Errorf("expected ResetWorkspace to reject ref %q, got nil", bad)
		}
	}
}

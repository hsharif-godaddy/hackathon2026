package fixers

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// fakeGoBinary writes a shell script at dir/go that logs every invocation
// (one line per call, all args space-joined) to logFile, then prints
// goprivate to stdout for `go env GOPRIVATE` queries. Pass "" to simulate
// GOPRIVATE being unset; pass e.g. "github.com/gdcorp-golang/*" to exercise
// the unsetGoEnv branch.
func fakeGoBinary(t *testing.T, dir, logFile, goprivate string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake-go script uses POSIX shell syntax")
	}
	// The guard is GOPRIVATE-specific so that if Fix() ever gains a
	// read-back query for a different env var, this stub fails loudly
	// (empty stdout when the test author expected real data) instead of
	// silently producing the wrong answer.
	script := "#!/bin/sh\n" +
		"echo \"$@\" >> " + logFile + "\n" +
		"if [ \"$1\" = \"env\" ] && [ \"$2\" = \"GOPRIVATE\" ] && [ \"$#\" -eq 2 ]; then\n" +
		"  printf '%s' '" + goprivate + "'\n" +
		"fi\n" +
		"exit 0\n"
	p := filepath.Join(dir, "go")
	if err := os.WriteFile(p, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
}

// pathWithFakeGo sets PATH so that dir (containing fake go) wins over the
// real go binary for the duration of the test.
func pathWithFakeGo(t *testing.T, dir string) {
	t.Helper()
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestGoProxyFixer_FixUsesNpmrcToken(t *testing.T) {
	bin := t.TempDir()
	logFile := filepath.Join(t.TempDir(), "go.log")
	fakeGoBinary(t, bin, logFile, "")
	pathWithFakeGo(t, bin)

	home := t.TempDir()
	npmrc := "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=tok-from-npmrc\n"
	if err := os.WriteFile(filepath.Join(home, ".npmrc"), []byte(npmrc), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)

	// Clear GOPROXY so we can assert Fix() populates it via os.Setenv.
	t.Setenv("GOPROXY", "")
	t.Setenv("GONOPROXY", "")
	t.Setenv("GONOSUMDB", "")

	if err := (&GoProxyFixer{}).Fix(context.Background(), ""); err != nil {
		t.Fatalf("Fix returned error: %v", err)
	}

	log, err := os.ReadFile(logFile)
	if err != nil {
		t.Fatal(err)
	}
	logStr := string(log)

	// Persisted via `go env -w` with the npmrc token embedded.
	if !strings.Contains(logStr, "env -w GOPROXY=https://:tok-from-npmrc@gdartifactory1.jfrog.io") {
		t.Errorf("expected `go env -w GOPROXY=...tok-from-npmrc...` invocation, log:\n%s", logStr)
	}
	if !strings.Contains(logStr, "env -w GONOPROXY=none") {
		t.Errorf("expected `go env -w GONOPROXY=none`, log:\n%s", logStr)
	}
	if !strings.Contains(logStr, "env -w GONOSUMDB=github.com/gdcorp-*") {
		t.Errorf("expected `go env -w GONOSUMDB=github.com/gdcorp-*`, log:\n%s", logStr)
	}

	// Critical: dev-runner's own env must be updated so the post-fix
	// re-verify (which shells out to `go env GOPROXY`) sees the fresh
	// value even when the user has a stale GOPROXY exported in their
	// shell rc.
	if got := os.Getenv("GOPROXY"); !strings.Contains(got, "tok-from-npmrc") {
		t.Errorf("expected os.Getenv(GOPROXY) to contain fresh token; got %q", got)
	}
	if got := os.Getenv("GONOPROXY"); got != "none" {
		t.Errorf("expected GONOPROXY=none in process env, got %q", got)
	}
	if got := os.Getenv("GONOSUMDB"); got != "github.com/gdcorp-*" {
		t.Errorf("expected GONOSUMDB in process env, got %q", got)
	}
}

func TestGoProxyFixer_FixFailsWithoutToken(t *testing.T) {
	bin := t.TempDir()
	logFile := filepath.Join(t.TempDir(), "go.log")
	fakeGoBinary(t, bin, logFile, "")
	pathWithFakeGo(t, bin)

	// Empty home dir -> no ~/.npmrc -> no token available.
	t.Setenv("HOME", t.TempDir())

	err := (&GoProxyFixer{}).Fix(context.Background(), "")
	if err == nil {
		t.Fatal("expected Fix to fail when no token is available")
	}
	if !strings.Contains(err.Error(), "no Artifactory token") {
		t.Errorf("expected 'no Artifactory token' error, got %v", err)
	}

	// Must not have shelled out to `go env -w` without a token.
	log, _ := os.ReadFile(logFile)
	if strings.Contains(string(log), "env -w") {
		t.Errorf("expected no `go env -w` calls without token, log:\n%s", log)
	}
}

func TestGoProxyFixer_FixUsesFormToken(t *testing.T) {
	bin := t.TempDir()
	logFile := filepath.Join(t.TempDir(), "go.log")
	fakeGoBinary(t, bin, logFile, "")
	pathWithFakeGo(t, bin)

	t.Setenv("HOME", t.TempDir())
	t.Setenv("GOPROXY", "")

	f := &GoProxyFixer{}
	f.SetFormValues(map[string]string{"token": "tok-from-form"})

	if err := f.Fix(context.Background(), ""); err != nil {
		t.Fatalf("Fix returned error: %v", err)
	}

	if got := os.Getenv("GOPROXY"); !strings.Contains(got, "tok-from-form") {
		t.Errorf("expected form token to populate GOPROXY, got %q", got)
	}
}

func TestGoProxyFixer_FormFieldsFromNpmrc(t *testing.T) {
	home := t.TempDir()
	npmrc := "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=available\n"
	if err := os.WriteFile(filepath.Join(home, ".npmrc"), []byte(npmrc), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)

	if fields := (&GoProxyFixer{}).FormFields(); len(fields) != 0 {
		t.Errorf("expected no form fields when npmrc has a token, got %+v", fields)
	}
}

func TestGoProxyFixer_FormFieldsWhenNpmrcMissing(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	fields := (&GoProxyFixer{}).FormFields()
	if len(fields) != 1 {
		t.Fatalf("expected a single form field for token entry, got %+v", fields)
	}
	if fields[0].Key != "token" {
		t.Errorf("expected field key 'token', got %q", fields[0].Key)
	}
	if !fields[0].Password {
		t.Error("token field should be masked (Password=true)")
	}
}

func TestGoProxyFixer_FixUnsetsStaleGOPRIVATE(t *testing.T) {
	bin := t.TempDir()
	logFile := filepath.Join(t.TempDir(), "go.log")
	// fake `go env GOPRIVATE` reports a stale gdcorp pattern -- Fix should
	// shell out to `go env -u GOPRIVATE` and clear the process env var.
	fakeGoBinary(t, bin, logFile, "github.com/gdcorp-golang/*")
	pathWithFakeGo(t, bin)

	home := t.TempDir()
	npmrc := "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=tok\n"
	if err := os.WriteFile(filepath.Join(home, ".npmrc"), []byte(npmrc), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("GOPRIVATE", "github.com/gdcorp-golang/*")

	if err := (&GoProxyFixer{}).Fix(context.Background(), ""); err != nil {
		t.Fatalf("Fix returned error: %v", err)
	}

	log, err := os.ReadFile(logFile)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(log), "env -u GOPRIVATE") {
		t.Errorf("expected `go env -u GOPRIVATE` invocation, log:\n%s", log)
	}
	if got := os.Getenv("GOPRIVATE"); got != "" {
		t.Errorf("expected GOPRIVATE unset in process env, got %q", got)
	}
}

func TestGoProxyFixer_FixSurfacesNpmrcReadError(t *testing.T) {
	// chmod 000 doesn't restrict root, and Windows perms don't map cleanly.
	if os.Geteuid() == 0 {
		t.Skip("chmod 000 is ignored when running as root")
	}
	if runtime.GOOS == "windows" {
		t.Skip("POSIX file perms required to make the file unreadable")
	}

	bin := t.TempDir()
	logFile := filepath.Join(t.TempDir(), "go.log")
	fakeGoBinary(t, bin, logFile, "")
	pathWithFakeGo(t, bin)

	home := t.TempDir()
	npmrcPath := filepath.Join(home, ".npmrc")
	if err := os.WriteFile(npmrcPath, []byte("ignored\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(npmrcPath, 0o000); err != nil {
		t.Skip(err)
	}
	t.Cleanup(func() { _ = os.Chmod(npmrcPath, 0o600) })
	t.Setenv("HOME", home)

	err := (&GoProxyFixer{}).Fix(context.Background(), "")
	if err == nil {
		t.Fatal("expected Fix to fail when ~/.npmrc is unreadable")
	}
	if !strings.Contains(err.Error(), "could not read ~/.npmrc") {
		t.Errorf("expected 'could not read ~/.npmrc' error, got %v", err)
	}

	// Must not have shelled out to `go env -w` -- we never had a token
	// and the user needs to fix file perms, not run pnpm login.
	log, _ := os.ReadFile(logFile)
	if strings.Contains(string(log), "env -w") {
		t.Errorf("expected no `go env -w` calls when npmrc unreadable, log:\n%s", log)
	}
}

func TestGoProxyFixer_FixRejectsWhitespaceOnlyToken(t *testing.T) {
	bin := t.TempDir()
	logFile := filepath.Join(t.TempDir(), "go.log")
	fakeGoBinary(t, bin, logFile, "")
	pathWithFakeGo(t, bin)

	// Empty home so npmrc fallback also yields no token.
	t.Setenv("HOME", t.TempDir())

	f := &GoProxyFixer{}
	f.SetFormValues(map[string]string{"token": "   "})

	err := f.Fix(context.Background(), "")
	if err == nil {
		t.Fatal("expected Fix to fail for whitespace-only token")
	}
	if !strings.Contains(err.Error(), "no Artifactory token") {
		t.Errorf("expected 'no Artifactory token' error, got %v", err)
	}

	// Must not have written GOPROXY with embedded whitespace.
	log, _ := os.ReadFile(logFile)
	if strings.Contains(string(log), "env -w GOPROXY") {
		t.Errorf("expected no GOPROXY write for whitespace-only token, log:\n%s", log)
	}
}

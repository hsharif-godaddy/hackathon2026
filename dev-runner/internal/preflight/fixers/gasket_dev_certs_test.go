package fixers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGasketDevCertsFixer_RunsPnpmInstall(t *testing.T) {
	record := filepath.Join(t.TempDir(), "record.txt")
	bin := t.TempDir()
	pnpmFake := filepath.Join(bin, "pnpm")
	// Record args so we can assert the fixer invoked `pnpm install`. Using
	// the same fake-pnpm-on-PATH pattern as playwright_bootstrap_test.go.
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" >>\"" + record + "\"\nexit 0\n"
	if err := os.WriteFile(pnpmFake, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	if err := (&GasketDevCertsFixer{}).Fix(context.Background(), t.TempDir()); err != nil {
		t.Fatalf("Fix: %v", err)
	}

	got, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	if line := strings.TrimSpace(string(got)); line != "install" {
		t.Fatalf("recorded pnpm args = %q, want %q", line, "install")
	}
}

func TestGasketDevCertsFixer_SurfacesCommandOutput(t *testing.T) {
	bin := t.TempDir()
	pnpmFake := filepath.Join(bin, "pnpm")
	// Fail with a clearly-fake but pnpm-shaped error on stderr so we can
	// assert the fixer's error message embeds the command output (the
	// `if out != ""` branch in Fix).
	const sentinel = "FAKE_PNPM_INSTALL_FAILURE for test"
	script := "#!/bin/sh\necho '" + sentinel + "' >&2\nexit 1\n"
	if err := os.WriteFile(pnpmFake, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	err := (&GasketDevCertsFixer{}).Fix(context.Background(), t.TempDir())
	if err == nil {
		t.Fatal("expected error from failing pnpm install")
	}
	if !strings.Contains(err.Error(), sentinel) {
		t.Fatalf("error should embed command output, got: %v", err)
	}
}

func TestGasketDevCertsFixer_BareErrWhenNoOutput(t *testing.T) {
	bin := t.TempDir()
	pnpmFake := filepath.Join(bin, "pnpm")
	// Exit non-zero with no output. Confirms the empty-output branch (just
	// wraps the exec.ExitError). No assertion on exact wording — just that
	// the error reads as a pnpm install failure.
	script := "#!/bin/sh\nexit 1\n"
	if err := os.WriteFile(pnpmFake, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	err := (&GasketDevCertsFixer{}).Fix(context.Background(), t.TempDir())
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "pnpm install") {
		t.Fatalf("error should mention pnpm install, got: %v", err)
	}
}

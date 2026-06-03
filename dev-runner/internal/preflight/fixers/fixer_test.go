package fixers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestEnsurePnpmInstall_NodeModulesPresent_NoOp covers the common case:
// node_modules already exists, so no pnpm invocation should happen.
func TestEnsurePnpmInstall_NodeModulesPresent_NoOp(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}

	bin := t.TempDir()
	pnpmFake := filepath.Join(bin, "pnpm")
	// Fail loudly if pnpm runs.
	if err := os.WriteFile(pnpmFake, []byte("#!/bin/sh\necho unexpected pnpm invocation >&2\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	if err := EnsurePnpmInstall(context.Background(), root); err != nil {
		t.Fatalf("EnsurePnpmInstall on existing node_modules: %v", err)
	}
}

// TestEnsurePnpmInstall_StatError_Surfaces guards against the regression
// Copilot flagged: a non-NotExist stat error (permission denied, transient
// FS failure) used to be silently treated as "installed", causing later
// fixers to blame a missing binary on the wrong cause. Now it surfaces.
func TestEnsurePnpmInstall_StatError_Surfaces(t *testing.T) {
	root := t.TempDir()
	// Make node_modules a path that lives under an unreadable parent dir.
	// Stat'ing the child returns EACCES, not ENOENT.
	parent := filepath.Join(root, "blocked")
	if err := os.MkdirAll(parent, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(parent, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(parent, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(parent, 0o755) })

	bin := t.TempDir()
	pnpmFake := filepath.Join(bin, "pnpm")
	if err := os.WriteFile(pnpmFake, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	err := EnsurePnpmInstall(context.Background(), parent)
	if err == nil {
		t.Fatal("expected error from blocked-stat, got nil")
	}
	if !strings.Contains(err.Error(), "stat node_modules") {
		t.Errorf("expected stat error to be wrapped; got: %v", err)
	}
}

// TestEnsurePnpmInstall_RunsPnpmWhenAbsent confirms the install fires when
// node_modules really is missing.
func TestEnsurePnpmInstall_RunsPnpmWhenAbsent(t *testing.T) {
	root := t.TempDir()

	record := filepath.Join(t.TempDir(), "record.txt")
	bin := t.TempDir()
	pnpmFake := filepath.Join(bin, "pnpm")
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" >>\"" + record + "\"\nexit 0\n"
	if err := os.WriteFile(pnpmFake, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	if err := EnsurePnpmInstall(context.Background(), root); err != nil {
		t.Fatalf("EnsurePnpmInstall: %v", err)
	}
	got, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	if line := strings.TrimSpace(string(got)); line != "install" {
		t.Fatalf("recorded pnpm args = %q, want %q", line, "install")
	}
}

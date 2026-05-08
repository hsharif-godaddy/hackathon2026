package checks

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func writeFakeDirenv(t *testing.T) string {
	t.Helper()
	return writeFakeDirenvWithStatus(t, "")
}

// writeFakeDirenvWithStatus writes a fake direnv binary that emits the given
// string when invoked with `status` (and exits 0 for any other subcommand).
// Passing "" emits empty output, which is what DirenvCheck will read when it
// shells out to `direnv status`.
func writeFakeDirenvWithStatus(t *testing.T, statusOutput string) string {
	t.Helper()
	dir := t.TempDir()
	name := "direnv"
	// POSIX sh: if first arg is "status", print the output; otherwise exit 0.
	// Use printf with a single-quoted literal; escape embedded single quotes.
	escaped := strings.ReplaceAll(statusOutput, "'", "'\\''")
	content := []byte("#!/bin/sh\nif [ \"$1\" = \"status\" ]; then printf '%s' '" + escaped + "'; fi\nexit 0\n")
	mode := os.FileMode(0o755)
	if runtime.GOOS == "windows" {
		name = "direnv.bat"
		// cmd.exe: emit statusOutput (one line at a time) when first arg is
		// "status". Strip CRs and split on LF; each line becomes a separate
		// echo. Escape special cmd characters (^, &, <, >, |) but ^ must go
		// first to avoid double-escaping.
		var b strings.Builder
		b.WriteString("@echo off\r\n")
		b.WriteString("if not \"%1\"==\"status\" exit /b 0\r\n")
		normalized := strings.ReplaceAll(statusOutput, "\r", "")
		for line := range strings.SplitSeq(strings.TrimRight(normalized, "\n"), "\n") {
			esc := line
			for _, c := range []string{"^", "&", "<", ">", "|"} {
				esc = strings.ReplaceAll(esc, c, "^"+c)
			}
			if esc == "" {
				b.WriteString("echo.\r\n")
			} else {
				b.WriteString("echo " + esc + "\r\n")
			}
		}
		b.WriteString("exit /b 0\r\n")
		content = []byte(b.String())
		mode = 0o644
	}
	if err := os.WriteFile(filepath.Join(dir, name), content, mode); err != nil {
		t.Fatalf("writeFakeDirenv: %v", err)
	}
	return dir
}

func TestDirenvCheck_InstalledAndActive(t *testing.T) {
	// .envrc allowed AND DIRENV_DIR set → pass
	t.Setenv("PATH", writeFakeDirenvWithStatus(t, "Found RC allowed 0\n"))
	t.Setenv("DIRENV_DIR", "/some/path")
	result := (&DirenvCheck{}).Run(context.Background(), t.TempDir())
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

// Regression: a stale DIRENV_DIR from a prior successful load must NOT mask a
// newly-blocked .envrc. `direnv status` is the source of truth for the current
// .envrc's allowed state.
func TestDirenvCheck_BlockedEnvrcWithStaleDirenvDir_Fails(t *testing.T) {
	t.Setenv("PATH", writeFakeDirenvWithStatus(t, "Found RC allowed 1\n"))
	t.Setenv("DIRENV_DIR", "-/stale/path")
	result := (&DirenvCheck{}).Run(context.Background(), t.TempDir())
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail when .envrc blocked despite stale DIRENV_DIR, got %v: %s", result.Status, result.Message)
	}
	if !strings.Contains(result.InstallHint, "direnv allow") {
		t.Errorf("expected `direnv allow` hint, got %q", result.InstallHint)
	}
}

func TestDirenvCheck_InactiveAllowed_FailsWithHookHint(t *testing.T) {
	t.Setenv("PATH", writeFakeDirenvWithStatus(t, "Found RC allowed 0\n"))
	t.Setenv("DIRENV_DIR", "")
	result := (&DirenvCheck{}).Run(context.Background(), t.TempDir())
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail when hook missing, got %v: %s", result.Status, result.Message)
	}
	if !strings.Contains(result.Message, "hook not active") {
		t.Errorf("expected hook-not-active message, got %q", result.Message)
	}
	if !strings.Contains(result.InstallHint, "direnv hook zsh") {
		t.Errorf("expected hook install hint, got %q", result.InstallHint)
	}
}

func TestDirenvCheck_InactiveNotAllowed_FailsWithAllowHint(t *testing.T) {
	t.Setenv("PATH", writeFakeDirenvWithStatus(t, "Found RC allowed 1\n"))
	t.Setenv("DIRENV_DIR", "")
	result := (&DirenvCheck{}).Run(context.Background(), t.TempDir())
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail when .envrc not allowed, got %v: %s", result.Status, result.Message)
	}
	if !strings.Contains(result.Message, "blocked") {
		t.Errorf("expected blocked message, got %q", result.Message)
	}
	if !strings.Contains(result.InstallHint, "direnv allow") {
		t.Errorf("expected `direnv allow` hint, got %q", result.InstallHint)
	}
}

func TestDirenvCheck_InactiveUnknown_FailsWithCombinedHint(t *testing.T) {
	t.Setenv("PATH", writeFakeDirenv(t))
	t.Setenv("DIRENV_DIR", "")
	result := (&DirenvCheck{}).Run(context.Background(), t.TempDir())
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail when status unknown, got %v: %s", result.Status, result.Message)
	}
	if !strings.Contains(result.InstallHint, "direnv hook") || !strings.Contains(result.InstallHint, "direnv allow") {
		t.Errorf("expected both hook and allow instructions, got %q", result.InstallHint)
	}
}

func TestDirenvCheck_NotInstalled(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	t.Setenv("DIRENV_DIR", "")
	result := (&DirenvCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail when direnv missing, got %v: %s", result.Status, result.Message)
	}
	if !strings.Contains(result.InstallHint, "brew install direnv") {
		t.Errorf("expected brew install hint, got %q", result.InstallHint)
	}
}

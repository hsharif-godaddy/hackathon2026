package checks

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func writeFakeDirenv(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	name, content := "direnv", []byte("#!/bin/sh\nexit 0\n")
	mode := os.FileMode(0o755)
	if runtime.GOOS == "windows" {
		name, content, mode = "direnv.bat", []byte("@echo off\r\nexit /b 0\r\n"), 0o644
	}
	if err := os.WriteFile(filepath.Join(dir, name), content, mode); err != nil {
		t.Fatalf("writeFakeDirenv: %v", err)
	}
	return dir
}

func TestDirenvCheck_InstalledAndActive(t *testing.T) {
	t.Setenv("PATH", writeFakeDirenv(t))
	t.Setenv("DIRENV_DIR", "/some/path")
	result := (&DirenvCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestDirenvCheck_InstalledButInactive(t *testing.T) {
	t.Setenv("PATH", writeFakeDirenv(t))
	t.Setenv("DIRENV_DIR", "")
	result := (&DirenvCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn when DIRENV_DIR unset, got %v: %s", result.Status, result.Message)
	}
	if result.InstallHint == "" {
		t.Error("expected InstallHint")
	}
}

func TestDirenvCheck_NotInstalled(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	t.Setenv("DIRENV_DIR", "")
	result := (&DirenvCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn when direnv missing, got %v: %s", result.Status, result.Message)
	}
	if result.InstallHint == "" {
		t.Error("expected InstallHint")
	}
}

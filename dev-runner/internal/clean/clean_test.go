package clean

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestRun_NothingToClean(t *testing.T) {
	root := t.TempDir()
	var out bytes.Buffer

	if err := run(root, true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(out.String(), "Nothing to clean") {
		t.Errorf("expected 'Nothing to clean', got: %s", out.String())
	}
}

func TestRun_RemovesExistingFiles(t *testing.T) {
	root := t.TempDir()
	targets := []string{"agents/.env", "app/.env", "local-control-plane/.env"}
	for _, rel := range targets {
		writeFile(t, filepath.Join(root, rel), "KEY=value")
	}

	var out bytes.Buffer
	if err := run(root, true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for _, rel := range targets {
		if _, err := os.Stat(filepath.Join(root, rel)); !os.IsNotExist(err) {
			t.Errorf("expected %s to be removed", rel)
		}
	}
}

func TestRun_SkipsNonExistentFiles(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "agents/.env"), "KEY=value")

	var out bytes.Buffer
	if err := run(root, true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "agents/.env") {
		t.Error("expected agents/.env in output")
	}
	if strings.Contains(output, "app/.env") {
		t.Error("app/.env does not exist and should not appear in output")
	}
}

func TestRun_CancelOnNo(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "agents/.env"), "KEY=value")

	var out bytes.Buffer
	if err := run(root, false, &out, &bytes.Buffer{}, strings.NewReader("n\n")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, "agents/.env")); os.IsNotExist(err) {
		t.Error("agents/.env should not have been removed after 'n' answer")
	}
	if !strings.Contains(out.String(), "Cancelled") {
		t.Errorf("expected 'Cancelled' in output, got: %s", out.String())
	}
}

func TestRun_ConfirmOnYes(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "agents/.env"), "KEY=value")

	var out bytes.Buffer
	if err := run(root, false, &out, &bytes.Buffer{}, strings.NewReader("y\n")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, "agents/.env")); !os.IsNotExist(err) {
		t.Error("agents/.env should have been removed after 'y' answer")
	}
}

func TestRun_CancelOnEOF(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "agents/.env"), "KEY=value")

	var out bytes.Buffer
	if err := run(root, false, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, "agents/.env")); os.IsNotExist(err) {
		t.Error("agents/.env should not have been removed on EOF")
	}
	if !strings.Contains(out.String(), "Cancelled") {
		t.Errorf("expected 'Cancelled' in output on EOF, got: %s", out.String())
	}
}

func TestRun_RemovesBuildDirs(t *testing.T) {
	root := t.TempDir()
	nextDir := filepath.Join(root, "app", ".next", "dev", "cache", "fetch-cache")
	if err := os.MkdirAll(nextDir, 0755); err != nil {
		t.Fatalf("mkdir %s: %v", nextDir, err)
	}
	writeFile(t, filepath.Join(nextDir, "somecachefile"), "cached data")

	var out bytes.Buffer
	if err := run(root, true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, "app", ".next")); !os.IsNotExist(err) {
		t.Error("expected app/.next to be removed")
	}
	if !strings.Contains(out.String(), "app/.next/") {
		t.Errorf("expected app/.next/ in output, got: %s", out.String())
	}
}

func TestRun_BuildDirRemovalFailure(t *testing.T) {
	root := t.TempDir()
	// Create app/.next as a file (not a dir) — os.RemoveAll on a file succeeds,
	// so instead we make the parent unwritable to force a failure.
	nextPath := filepath.Join(root, "app", ".next")
	if err := os.MkdirAll(nextPath, 0755); err != nil {
		t.Fatalf("mkdir %s: %v", nextPath, err)
	}
	// Make app/ unwritable so RemoveAll of app/.next fails.
	appDir := filepath.Join(root, "app")
	if err := os.Chmod(appDir, 0555); err != nil {
		t.Fatalf("chmod %s: %v", appDir, err)
	}
	t.Cleanup(func() { os.Chmod(appDir, 0755) })

	var errOut bytes.Buffer
	err := run(root, true, &bytes.Buffer{}, &errOut, strings.NewReader(""))
	if err == nil {
		t.Fatal("expected error when dir removal fails")
	}
	if !strings.Contains(err.Error(), "app/.next") {
		t.Errorf("expected failed dir name in error, got: %v", err)
	}
}

func TestRun_MakeCleanSuccess(t *testing.T) {
	root := t.TempDir()
	// Create a service directory with a Makefile whose clean target succeeds.
	writeFile(t, filepath.Join(root, "dev-runner", "Makefile"), ".PHONY: clean\nclean:\n\t@echo cleaned\n")

	var out bytes.Buffer
	if err := run(root, true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(out.String(), "dev-runner") {
		t.Errorf("expected dev-runner in output, got: %s", out.String())
	}
}

func TestRun_MakeCleanFailure(t *testing.T) {
	root := t.TempDir()
	// Create a service directory with a Makefile whose clean target fails.
	writeFile(t, filepath.Join(root, "dev-runner", "Makefile"), ".PHONY: clean\nclean:\n\t@exit 1\n")

	var out, errOut bytes.Buffer
	err := run(root, true, &out, &errOut, strings.NewReader(""))
	if err == nil {
		t.Fatal("expected error when make clean fails")
	}
	if !strings.Contains(err.Error(), "dev-runner") {
		t.Errorf("expected failed service name in error, got: %v", err)
	}
}

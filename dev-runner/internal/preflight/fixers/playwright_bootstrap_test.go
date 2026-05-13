package fixers

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func msPlaywrightDirForTest(t *testing.T) string {
	t.Helper()
	base := t.TempDir()
	switch runtime.GOOS {
	case "darwin":
		home := filepath.Join(base, "home")
		t.Setenv("HOME", home)
		return filepath.Join(home, "Library", "Caches", "ms-playwright")
	case "linux":
		xdg := filepath.Join(base, "xdg")
		t.Setenv("XDG_CACHE_HOME", xdg)
		return filepath.Join(xdg, "ms-playwright")
	default:
		t.Skip("requires darwin or linux UserCacheDir layout for ms-playwright")
	}
	return ""
}

func TestEnsurePlaywrightBrowsers_noOpWhenChromiumPresent(t *testing.T) {
	pwDir := msPlaywrightDirForTest(t)
	if err := os.MkdirAll(filepath.Join(pwDir, "chromium-999"), 0755); err != nil {
		t.Fatal(err)
	}

	bin := t.TempDir()
	pnpmFake := filepath.Join(bin, "pnpm")
	script := "#!/bin/sh\necho pnpm should not run >&2\nexit 1\n"
	if err := os.WriteFile(pnpmFake, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	if err := EnsurePlaywrightBrowsers(context.Background(), t.TempDir()); err != nil {
		t.Fatalf("EnsurePlaywrightBrowsers: %v", err)
	}
}

func TestEnsurePlaywrightBrowsers_runsPnpmInstallChromium(t *testing.T) {
	_ = msPlaywrightDirForTest(t)

	record := filepath.Join(t.TempDir(), "record.txt")
	bin := t.TempDir()
	pnpmFake := filepath.Join(bin, "pnpm")
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" >>\"" + record + "\"\nexit 0\n"
	if err := os.WriteFile(pnpmFake, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	if err := EnsurePlaywrightBrowsers(context.Background(), t.TempDir()); err != nil {
		t.Fatalf("EnsurePlaywrightBrowsers: %v", err)
	}
	got, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	line := strings.TrimSpace(string(got))
	want := "exec playwright install chromium"
	if line != want {
		t.Fatalf("recorded pnpm args = %q, want %q", line, want)
	}
}

func TestEnsurePlaywrightBrowsers_surfacesCommandOutput(t *testing.T) {
	_ = msPlaywrightDirForTest(t)

	bin := t.TempDir()
	pnpmFake := filepath.Join(bin, "pnpm")
	script := "#!/bin/sh\necho boom >&2\nexit 1\n"
	if err := os.WriteFile(pnpmFake, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	err := EnsurePlaywrightBrowsers(context.Background(), t.TempDir())
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "boom") {
		t.Fatalf("error should include command output: %v", err)
	}
}

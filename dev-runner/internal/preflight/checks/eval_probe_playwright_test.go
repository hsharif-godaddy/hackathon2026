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

func msPlaywrightDirForCheckTest(t *testing.T) string {
	t.Helper()
	base := t.TempDir()
	switch runtime.GOOS {
	case "darwin":
		home := filepath.Join(base, "home")
		t.Setenv("HOME", home)
		t.Setenv("XDG_CACHE_HOME", "")
		return filepath.Join(home, "Library", "Caches", "ms-playwright")
	case "linux":
		xdg := filepath.Join(base, "xdg")
		t.Setenv("XDG_CACHE_HOME", xdg)
		t.Setenv("HOME", "")
		return filepath.Join(xdg, "ms-playwright")
	default:
		t.Skip("requires darwin or linux UserCacheDir layout for ms-playwright")
	}
	return ""
}

func TestEvalProbePlaywrightCheck_Run(t *testing.T) {
	t.Run("fails when cache dir cannot be located", func(t *testing.T) {
		switch runtime.GOOS {
		case "darwin":
			t.Setenv("HOME", "")
			t.Setenv("XDG_CACHE_HOME", "")
		case "linux":
			t.Setenv("HOME", "")
			t.Setenv("XDG_CACHE_HOME", "")
		default:
			t.Skip("requires darwin or linux UserCacheDir layout for ms-playwright")
		}

		got := (&EvalProbePlaywrightCheck{}).Run(context.Background(), t.TempDir())
		if got.Status != preflight.StatusFail {
			t.Fatalf("status = %v, want fail", got.Status)
		}
		if got.FixAvailable {
			t.Fatalf("FixAvailable = true, want false")
		}
		if !strings.Contains(got.Message, "could not locate Playwright cache dir") {
			t.Fatalf("message = %q, want cache-dir error", got.Message)
		}
	})

	t.Run("fails as fixable when chromium is missing", func(t *testing.T) {
		_ = msPlaywrightDirForCheckTest(t)

		got := (&EvalProbePlaywrightCheck{}).Run(context.Background(), t.TempDir())
		if got.Status != preflight.StatusFail {
			t.Fatalf("status = %v, want fail", got.Status)
		}
		if !got.FixAvailable {
			t.Fatalf("FixAvailable = false, want true")
		}
		if got.Message != "Playwright Chromium not installed for gosym-probe DOM capture" {
			t.Fatalf("message = %q", got.Message)
		}
	})

	t.Run("passes when chromium is installed", func(t *testing.T) {
		pwDir := msPlaywrightDirForCheckTest(t)
		if err := os.MkdirAll(filepath.Join(pwDir, "chromium-1200"), 0755); err != nil {
			t.Fatal(err)
		}

		got := (&EvalProbePlaywrightCheck{}).Run(context.Background(), t.TempDir())
		if got.Status != preflight.StatusPass {
			t.Fatalf("status = %v, want pass", got.Status)
		}
		if got.FixAvailable {
			t.Fatalf("FixAvailable = true, want false")
		}
		if got.Message != "Playwright Chromium installed for gosym-probe DOM capture" {
			t.Fatalf("message = %q", got.Message)
		}
	})
}

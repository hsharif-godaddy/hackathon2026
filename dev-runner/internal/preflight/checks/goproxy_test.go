package checks

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// fakeGo writes a shell script (or batch file on Windows) to dir that
// mimics `go env GOPROXY GONOPROXY GONOSUMDB GOPRIVATE` by printing
// the four values line-by-line.
func fakeGo(t *testing.T, dir, goproxy, gonoproxy, gonosumdb, goprivate string) {
	t.Helper()
	var name, content string
	if runtime.GOOS == "windows" {
		name = "go.bat"
		content = "@echo off\n" +
			"echo " + goproxy + "\n" +
			"echo " + gonoproxy + "\n" +
			"echo " + gonosumdb + "\n" +
			"echo " + goprivate + "\n"
	} else {
		name = "go"
		content = "#!/bin/sh\n" +
			"printf '%s\\n' " +
			"'" + goproxy + "' " +
			"'" + gonoproxy + "' " +
			"'" + gonosumdb + "' " +
			"'" + goprivate + "'\n"
	}
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestGoProxyCheck_Pass(t *testing.T) {
	bin := t.TempDir()
	fakeGo(t, bin, "https://token@gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct", "none", "github.com/gdcorp-*", "")
	t.Setenv("PATH", bin)

	r := (&GoProxyCheck{}).Run(context.Background(), "")
	if r.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", r.Status, r.Message)
	}
}

func TestGoProxyCheck_PassEmptyGONOPROXY(t *testing.T) {
	bin := t.TempDir()
	fakeGo(t, bin, "https://token@gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct", "", "github.com/gdcorp-*", "")
	t.Setenv("PATH", bin)

	r := (&GoProxyCheck{}).Run(context.Background(), "")
	if r.Status != preflight.StatusPass {
		t.Errorf("expected Pass (empty GONOPROXY is valid), got %v: %s", r.Status, r.Message)
	}
}

func TestGoProxyCheck_FailNoProxy(t *testing.T) {
	bin := t.TempDir()
	fakeGo(t, bin, "https://proxy.golang.org,direct", "none", "github.com/gdcorp-*", "")
	t.Setenv("PATH", bin)

	r := (&GoProxyCheck{}).Run(context.Background(), "")
	if r.Status != preflight.StatusFail {
		t.Errorf("expected Fail, got %v: %s", r.Status, r.Message)
	}
	if !r.FixAvailable {
		t.Error("expected FixAvailable")
	}
}

func TestGoProxyCheck_FailBadGONOPROXY(t *testing.T) {
	bin := t.TempDir()
	fakeGo(t, bin, "https://token@gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct", "github.com/gdcorp-*", "github.com/gdcorp-*", "")
	t.Setenv("PATH", bin)

	r := (&GoProxyCheck{}).Run(context.Background(), "")
	if r.Status != preflight.StatusFail {
		t.Errorf("expected Fail, got %v: %s", r.Status, r.Message)
	}
	if !r.FixAvailable {
		t.Error("expected FixAvailable")
	}
}

func TestGoProxyCheck_FailNoGONOSUMDB(t *testing.T) {
	bin := t.TempDir()
	fakeGo(t, bin, "https://token@gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct", "none", "", "")
	t.Setenv("PATH", bin)

	r := (&GoProxyCheck{}).Run(context.Background(), "")
	if r.Status != preflight.StatusFail {
		t.Errorf("expected Fail, got %v: %s", r.Status, r.Message)
	}
	if !r.FixAvailable {
		t.Error("expected FixAvailable")
	}
}

func TestGoProxyCheck_WarnGOPRIVATE(t *testing.T) {
	bin := t.TempDir()
	// GONOPROXY="" means GOPRIVATE controls proxy bypass -- warn is valid
	fakeGo(t, bin, "https://token@gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct", "", "github.com/gdcorp-*", "github.com/gdcorp-golang/*")
	t.Setenv("PATH", bin)

	r := (&GoProxyCheck{}).Run(context.Background(), "")
	if r.Status != preflight.StatusWarn {
		t.Errorf("expected Warn, got %v: %s", r.Status, r.Message)
	}
	if !r.FixAvailable {
		t.Error("expected FixAvailable")
	}
}

func TestGoProxyCheck_PassGONOPROXYNoneWithGOPRIVATE(t *testing.T) {
	bin := t.TempDir()
	// GONOPROXY="none" forces all modules through proxy, so GOPRIVATE is harmless
	fakeGo(t, bin, "https://token@gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct", "none", "github.com/gdcorp-*", "github.com/gdcorp-golang/*")
	t.Setenv("PATH", bin)

	r := (&GoProxyCheck{}).Run(context.Background(), "")
	if r.Status != preflight.StatusPass {
		t.Errorf("expected Pass (GONOPROXY=none overrides GOPRIVATE), got %v: %s", r.Status, r.Message)
	}
}

func TestGoProxyCheck_FailNoGoBinary(t *testing.T) {
	t.Setenv("PATH", t.TempDir())

	r := (&GoProxyCheck{}).Run(context.Background(), "")
	if r.Status != preflight.StatusFail {
		t.Errorf("expected Fail, got %v: %s", r.Status, r.Message)
	}
	if r.FixAvailable {
		t.Error("expected FixAvailable=false when go binary is missing")
	}
}

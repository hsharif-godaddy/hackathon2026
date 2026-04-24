package checks

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/jfrog"
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

const fakeGoProxyWithToken = "https://:tok@gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct"

func TestGoProxyCheck_Pass(t *testing.T) {
	stubProbe(t, http.StatusOK)
	bin := t.TempDir()
	fakeGo(t, bin, fakeGoProxyWithToken, "none", "github.com/gdcorp-*", "")
	t.Setenv("PATH", bin)

	r := (&GoProxyCheck{}).Run(context.Background(), "")
	if r.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", r.Status, r.Message)
	}
}

func TestGoProxyCheck_PassEmptyGONOPROXY(t *testing.T) {
	stubProbe(t, http.StatusOK)
	bin := t.TempDir()
	fakeGo(t, bin, fakeGoProxyWithToken, "", "github.com/gdcorp-*", "")
	t.Setenv("PATH", bin)

	r := (&GoProxyCheck{}).Run(context.Background(), "")
	if r.Status != preflight.StatusPass {
		t.Errorf("expected Pass (empty GONOPROXY is valid), got %v: %s", r.Status, r.Message)
	}
}

func TestGoProxyCheck_FailExpiredToken(t *testing.T) {
	stubProbe(t, http.StatusUnauthorized)
	bin := t.TempDir()
	fakeGo(t, bin, fakeGoProxyWithToken, "none", "github.com/gdcorp-*", "")
	t.Setenv("PATH", bin)

	r := (&GoProxyCheck{}).Run(context.Background(), "")
	if r.Status != preflight.StatusFail {
		t.Fatalf("expected Fail for 401, got %v: %s", r.Status, r.Message)
	}
	if !r.FixAvailable {
		t.Error("expected FixAvailable=true so dev-runner offers to rewrite GOPROXY")
	}
}

func TestGoProxyCheck_FailMissingEmbeddedToken(t *testing.T) {
	stubProbe(t, http.StatusOK)
	bin := t.TempDir()
	// Artifactory host present but no credentials section -- Go will 401.
	fakeGo(t, bin, "https://gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct", "none", "github.com/gdcorp-*", "")
	t.Setenv("PATH", bin)

	r := (&GoProxyCheck{}).Run(context.Background(), "")
	if r.Status != preflight.StatusFail {
		t.Errorf("expected Fail when GOPROXY has no token, got %v: %s", r.Status, r.Message)
	}
	if !r.FixAvailable {
		t.Error("expected FixAvailable=true")
	}
}

func TestGoProxyCheck_PassOffline(t *testing.T) {
	// See stubProbeUnreachable comment for why we don't use TEST-NET-1.
	stubProbeUnreachable(t)

	prevTimeout := jfrog.ProbeTimeout
	jfrog.ProbeTimeout = 100 * time.Millisecond
	t.Cleanup(func() { jfrog.ProbeTimeout = prevTimeout })

	bin := t.TempDir()
	fakeGo(t, bin, fakeGoProxyWithToken, "none", "github.com/gdcorp-*", "")
	t.Setenv("PATH", bin)

	r := (&GoProxyCheck{}).Run(context.Background(), "")
	if r.Status != preflight.StatusPass {
		t.Errorf("expected Pass when offline, got %v: %s", r.Status, r.Message)
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
	fakeGo(t, bin, fakeGoProxyWithToken, "github.com/gdcorp-*", "github.com/gdcorp-*", "")
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
	fakeGo(t, bin, fakeGoProxyWithToken, "none", "", "")
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
	fakeGo(t, bin, fakeGoProxyWithToken, "", "github.com/gdcorp-*", "github.com/gdcorp-golang/*")
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
	stubProbe(t, http.StatusOK)
	bin := t.TempDir()
	// GONOPROXY="none" forces all modules through proxy, so GOPRIVATE is harmless
	fakeGo(t, bin, fakeGoProxyWithToken, "none", "github.com/gdcorp-*", "github.com/gdcorp-golang/*")
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

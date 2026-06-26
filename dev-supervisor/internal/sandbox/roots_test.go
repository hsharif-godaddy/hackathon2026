package sandbox_test

import (
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
)

func TestResolveRoots_WithSharedStorage(t *testing.T) {
	roots := sandbox.ResolveRoots("/app", "/shared-storage")

	if len(roots) != 3 {
		t.Fatalf("expected 3 roots, got %d", len(roots))
	}

	app := roots[0]
	if app.Name != sandbox.RootApp || app.Path != "/app" {
		t.Errorf("app root: got name=%q path=%q", app.Name, app.Path)
	}

	pub := roots[1]
	if pub.Name != sandbox.RootPublicAssets || pub.Path != "/shared-storage/public/assets" {
		t.Errorf("public-assets root: got name=%q path=%q", pub.Name, pub.Path)
	}

	priv := roots[2]
	if priv.Name != sandbox.RootPrivate || priv.Path != "/private" {
		t.Errorf("private root: got name=%q path=%q", priv.Name, priv.Path)
	}
}

func TestResolveRoots_WithoutSharedStorage(t *testing.T) {
	roots := sandbox.ResolveRoots("/app", "")

	pub := roots[1]
	if pub.Name != sandbox.RootPublicAssets || pub.Path != "/app/public/assets" {
		t.Errorf("public-assets root without shared storage: got name=%q path=%q", pub.Name, pub.Path)
	}
}

func TestLookupRoot_Known(t *testing.T) {
	roots := sandbox.ResolveRoots("/app", "/shared-storage")

	path, ok := sandbox.LookupRoot(roots, sandbox.RootApp)
	if !ok || path != "/app" {
		t.Errorf("LookupRoot(app): ok=%v path=%q", ok, path)
	}

	path, ok = sandbox.LookupRoot(roots, sandbox.RootPublicAssets)
	if !ok || path != "/shared-storage/public/assets" {
		t.Errorf("LookupRoot(public-assets): ok=%v path=%q", ok, path)
	}

	path, ok = sandbox.LookupRoot(roots, sandbox.RootPrivate)
	if !ok || path != "/private" {
		t.Errorf("LookupRoot(private): ok=%v path=%q", ok, path)
	}
}

func TestLookupRoot_Unknown(t *testing.T) {
	roots := sandbox.ResolveRoots("/app", "/shared-storage")

	_, ok := sandbox.LookupRoot(roots, "bogus")
	if ok {
		t.Error("LookupRoot should return false for unknown root")
	}
}

func TestValidRootNames(t *testing.T) {
	names := sandbox.ValidRootNames()
	want := []sandbox.StorageRootName{sandbox.RootApp, sandbox.RootPublicAssets, sandbox.RootPrivate}
	if len(names) != len(want) {
		t.Fatalf("expected %d valid root names, got %d: %v", len(want), len(names), names)
	}
	for i, n := range names {
		if n != want[i] {
			t.Errorf("ValidRootNames()[%d] = %q, want %q", i, n, want[i])
		}
	}
}

// TestRootsCoveredByLandlock asserts the critical invariant: every storage
// root's path must be covered by the Landlock ExecPaths allow-set — otherwise
// the file API would accept writes that the kernel denies at runtime.
func TestRootsCoveredByLandlock(t *testing.T) {
	appDir := "/app"
	sharedStorageDir := "/shared-storage"
	roots := sandbox.ResolveRoots(appDir, sharedStorageDir)
	execPaths := sandbox.ExecPaths(appDir, sharedStorageDir)

	for _, root := range roots {
		covered := false
		for _, rule := range execPaths {
			if root.Path == rule.Path || strings.HasPrefix(root.Path, rule.Path+"/") {
				if !strings.Contains(rule.Mode, "w") {
					continue
				}
				covered = true
				break
			}
		}
		if !covered {
			t.Errorf("root %q (%s) not covered by writable ExecPaths rule",
				root.Name, root.Path)
		}
	}
}

// TestRootsCoveredByLandlock_NoSharedStorage verifies fallback (public-assets
// resolves to /app/public/assets, which is a subtree of /app with rwcx).
func TestRootsCoveredByLandlock_NoSharedStorage(t *testing.T) {
	appDir := "/app"
	roots := sandbox.ResolveRoots(appDir, "")
	execPaths := sandbox.ExecPaths(appDir, "")

	for _, root := range roots {
		covered := false
		for _, rule := range execPaths {
			if root.Path == rule.Path || strings.HasPrefix(root.Path, rule.Path+"/") {
				if !strings.Contains(rule.Mode, "w") {
					continue
				}
				covered = true
				break
			}
		}
		if !covered {
			t.Errorf("root %q (%s) not covered by writable ExecPaths rule (no shared storage)",
				root.Name, root.Path)
		}
	}
}

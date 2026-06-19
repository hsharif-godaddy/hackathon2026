package httpproxy //nolint:testpackage // tests the unexported buildMediaSearchPaths helper directly

import (
	"path/filepath"
	"slices"
	"testing"
)

// Chat-uploaded media is written to public/assets/media and the build mirrors it
// to dist/client/assets/media. A dist-only publish archive ships only dist/, so
// the slot handler must search the dist/ mirror of the public/ tree — including
// the assets/ subtree — or published apps 404 on uploaded media that is present
// in the archive.
const testAppDir = "/app"

func TestBuildMediaSearchPaths_IncludesDistAssetsMirror(t *testing.T) {
	appDir := testAppDir

	for _, shared := range []string{"", "/shared-storage"} {
		paths := buildMediaSearchPaths(appDir, shared)

		mustContain := []string{
			filepath.Join(appDir, "dist", "client", "assets", "media"),
			filepath.Join(appDir, "dist", "client", "assets", "images"),
			filepath.Join(appDir, "dist", "client", "assets", "uploads"),
			filepath.Join(appDir, "dist", "assets", "media"),
			// existing coverage must be preserved
			filepath.Join(appDir, "dist", "client", "media"),
			filepath.Join(appDir, "dist", "media"),
			filepath.Join(appDir, "public", "assets", "media"),
		}
		for _, want := range mustContain {
			if !slices.Contains(paths, want) {
				t.Errorf("sharedStorageDir=%q: search paths missing %q\ngot: %v", shared, want, paths)
			}
		}
	}

	// Shared-storage roots only appear when configured.
	withShared := buildMediaSearchPaths(appDir, "/shared-storage")
	if !slices.Contains(withShared, filepath.Join("/shared-storage", "public", "assets", "media")) {
		t.Errorf("expected shared-storage media path when configured; got: %v", withShared)
	}
	withoutShared := buildMediaSearchPaths(appDir, "")
	if slices.Contains(withoutShared, filepath.Join("/shared-storage", "public", "assets", "media")) {
		t.Errorf("did not expect shared-storage path when unset; got: %v", withoutShared)
	}
}

// The contract is "first match wins": a fresh upload in the live workspace
// (public/) must shadow a stale build artifact (dist/), and shared storage must
// win over both. Membership alone would still pass if the order were reversed,
// so assert the precedence explicitly.
func TestBuildMediaSearchPaths_PreviewBeforePublishOrder(t *testing.T) {
	appDir := testAppDir

	assertBefore := func(t *testing.T, paths []string, earlier, later string) {
		t.Helper()
		ei, li := slices.Index(paths, earlier), slices.Index(paths, later)
		if ei < 0 || li < 0 {
			t.Fatalf("expected both paths present: %q@%d, %q@%d\ngot: %v", earlier, ei, later, li, paths)
		}
		if ei >= li {
			t.Errorf("expected %q (idx %d) before %q (idx %d)\ngot: %v", earlier, ei, later, li, paths)
		}
	}

	paths := buildMediaSearchPaths(appDir, "")
	// public/ (preview) ahead of dist/ (publish) for every shared subdir.
	assertBefore(t, paths,
		filepath.Join(appDir, "public", "assets", "media"),
		filepath.Join(appDir, "dist", "assets", "media"))
	assertBefore(t, paths,
		filepath.Join(appDir, "public", "assets", "media"),
		filepath.Join(appDir, "dist", "client", "assets", "media"))
	assertBefore(t, paths,
		filepath.Join(appDir, "public", "media"),
		filepath.Join(appDir, "dist", "media"))

	// When configured, shared storage wins over the live workspace.
	shared := buildMediaSearchPaths(appDir, "/shared-storage")
	assertBefore(t, shared,
		filepath.Join("/shared-storage", "public", "assets", "media"),
		filepath.Join(appDir, "public", "assets", "media"))
}

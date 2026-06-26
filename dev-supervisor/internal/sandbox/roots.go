package sandbox

import "path/filepath"

// StorageRootName is the closed enum of named storage roots exposed by the
// workspace file API. The agent selects a root by name; the server resolves
// it to an absolute path. Adding a new root = one new const + one entry in
// ResolveRoots + one entry in ValidRootNames.
// Keep in sync with StorageRoot in agents/src/workspace/files.ts.
type StorageRootName string

const (
	RootApp          StorageRootName = "app"
	RootPublicAssets StorageRootName = "public-assets"
	RootPrivate      StorageRootName = "private"
)

// StorageRoot maps a named root to its resolved filesystem path and the
// Landlock mode it requires. The Mode field exists solely for the coherence
// test — it is not used at runtime by the file API.
type StorageRoot struct {
	Name StorageRootName
	Path string
	Mode string
}

// ResolveRoots returns the complete set of named storage roots for the current
// environment. The returned slice is the single source of truth consumed by
// both the file API (for per-request baseDir resolution) and the coherence
// test (which asserts every root is covered by the Landlock allow-set).
//
// appDir is Config.AppDir (default /app). sharedStorageDir is SHARED_STORAGE_DIR.
func ResolveRoots(appDir, sharedStorageDir string) []StorageRoot {
	roots := []StorageRoot{
		{Name: RootApp, Path: appDir, Mode: "rwcx"},
	}

	if sharedStorageDir != "" {
		roots = append(roots, StorageRoot{
			Name: RootPublicAssets,
			Path: filepath.Join(sharedStorageDir, "public", "assets"),
			Mode: "rwc",
		})
	} else {
		roots = append(roots, StorageRoot{
			Name: RootPublicAssets,
			Path: filepath.Join(appDir, "public", "assets"),
			Mode: "rwc",
		})
	}

	roots = append(roots, StorageRoot{
		Name: RootPrivate,
		Path: "/private",
		Mode: "rwc",
	})

	return roots
}

// LookupRoot finds a root by name and returns its absolute path.
// Returns ("", false) for unknown names — callers must reject with a
// validation error, never fall back silently.
func LookupRoot(roots []StorageRoot, name StorageRootName) (string, bool) {
	for _, r := range roots {
		if r.Name == name {
			return r.Path, true
		}
	}
	return "", false
}

// ValidRootNames returns the closed set of valid root names (for error messages).
func ValidRootNames() []StorageRootName {
	return []StorageRootName{RootApp, RootPublicAssets, RootPrivate}
}

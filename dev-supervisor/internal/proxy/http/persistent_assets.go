package httpproxy

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
)

// PersistentAssetsHandler serves files from the persistent assets directory
// (CephFS mount), falling through to the reverse proxy on miss.
type PersistentAssetsHandler struct {
	assetRoot    string       // filepath.Join(persistentDir, "assets")
	resolvedRoot atomic.Value // cached EvalSymlinks(assetRoot); empty string until resolved
	fallback     http.Handler // reverse proxy to Vite/backend
}

// NewPersistentAssetsHandler creates a handler that serves /assets/* from
// persistent storage, falling through to the proxy for misses.
func NewPersistentAssetsHandler(persistentDir string, fallback http.Handler) *PersistentAssetsHandler {
	h := &PersistentAssetsHandler{
		assetRoot: filepath.Join(persistentDir, "assets"),
		fallback:  fallback,
	}
	// Pre-resolve if mount is ready; lazy resolution on first hit otherwise.
	if resolved, err := filepath.EvalSymlinks(h.assetRoot); err == nil {
		h.resolvedRoot.Store(resolved)
	} else {
		h.resolvedRoot.Store("") // type-consistent init for atomic.Value
	}
	return h
}

// getResolvedRoot returns the cached resolved asset root, resolving lazily
// on first success if the mount was not ready at construction time.
func (h *PersistentAssetsHandler) getResolvedRoot() (string, error) {
	if cached, _ := h.resolvedRoot.Load().(string); cached != "" {
		return cached, nil
	}
	resolved, err := filepath.EvalSymlinks(h.assetRoot)
	if err != nil {
		return "", err
	}
	h.resolvedRoot.Store(resolved)
	return resolved, nil
}

func (h *PersistentAssetsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Only serve GET/HEAD from disk; other methods fall through to proxy.
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.fallback.ServeHTTP(w, r)
		return
	}

	// Strip the /assets/ prefix to get the relative path.
	relativePath := strings.TrimPrefix(r.URL.Path, "/assets/")
	if relativePath == "" || relativePath == r.URL.Path {
		h.fallback.ServeHTTP(w, r)
		return
	}

	// Build candidate disk path, resolve symlinks, and verify confinement.
	// This is the sole path-safety mechanism — no filepath.Clean security check
	// needed because EvalSymlinks + prefix verification is the real guarantee.
	diskPath := filepath.Join(h.assetRoot, relativePath)
	resolved, err := filepath.EvalSymlinks(diskPath)
	if err != nil {
		// Not found (or broken symlink) — fall through to proxy.
		h.fallback.ServeHTTP(w, r)
		return
	}

	// Verify the resolved path is still under the asset root.
	// Prevents both path traversal and symlink-based escapes.
	// resolvedRoot is cached to avoid an EvalSymlinks stat on every request.
	resolvedRoot, err := h.getResolvedRoot()
	if err != nil {
		h.fallback.ServeHTTP(w, r)
		return
	}
	if !strings.HasPrefix(resolved, resolvedRoot+string(filepath.Separator)) {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	// Open and stat in one sequence to avoid double-stat on CephFS.
	// http.ServeContent uses the open fd directly (no second stat).
	f, err := os.Open(resolved)
	if err != nil {
		h.fallback.ServeHTTP(w, r)
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil || info.IsDir() {
		// Not found or is a directory — fall through to proxy.
		h.fallback.ServeHTTP(w, r)
		return
	}

	// Tag this request as served by persistent_assets for logging.
	// Placed before any header/body writes for clarity.
	setHandler(r.Context(), "persistent_assets")

	// Serve the file with caching headers.
	slog.Debug("persistent_assets.serving",
		"path", r.URL.Path,
		"disk_path", resolved)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

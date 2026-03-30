package httpproxy

import (
	"encoding/json"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const uploadedMediaPrefix = "/airo-assets/uploads/"

// UploadedMediaHandler serves user-uploaded media files.
// Searches through configured paths to find media files.
type UploadedMediaHandler struct {
	searchPaths []string // Directories to search for media files (in order)
}

// NewUploadedMediaHandler creates a new handler for serving uploaded media.
// searchPaths are the directories to search for media files, in order of priority.
func NewUploadedMediaHandler(searchPaths []string) *UploadedMediaHandler {
	return &UploadedMediaHandler{
		searchPaths: searchPaths,
	}
}

// ServeHTTP serves uploaded media files.
func (h *UploadedMediaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	setHandler(r.Context(), "uploaded_media")

	// Only GET and HEAD allowed
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract filename from path
	filename := strings.TrimPrefix(r.URL.Path, uploadedMediaPrefix)
	if filename == "" || filename == r.URL.Path {
		slog.Debug("uploaded_media.invalid_path", "url", r.URL.Path)
		h.respondError(w, "invalid path", http.StatusBadRequest)
		return
	}

	// Security: Block path traversal, absolute paths, and null bytes
	// Note: Forward slashes for subdirectories are allowed (e.g., "pdfs/doc.pdf")
	// Deployment invariant: All production systems are Unix-like (Linux/macOS), so we only
	// need to check for Unix absolute paths (leading slash). Windows paths are not supported.
	if strings.Contains(filename, "..") || strings.HasPrefix(filename, "/") || strings.Contains(filename, "\x00") {
		slog.Warn("uploaded_media.path_traversal_attempt",
			"url", r.URL.Path,
			"filename", filename)
		h.respondError(w, "invalid path", http.StatusBadRequest)
		return
	}

	// Find the file, checking primary path and fallbacks
	cleanPath, info, err := h.findMediaFile(filename)
	if err != nil {
		if os.IsNotExist(err) {
			slog.Debug("uploaded_media.not_found", "filename", filename)
			h.respondError(w, "file not found", http.StatusNotFound)
			return
		}
		slog.Error("uploaded_media.stat_error", "filename", filename, "error", err.Error())
		h.respondError(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Don't serve directories
	if info.IsDir() {
		h.respondError(w, "not a file", http.StatusBadRequest)
		return
	}

	// Determine content type from extension
	ext := filepath.Ext(filename)
	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Set cache headers based on file location
	// Content-hashed files in media/, images/, uploads/ can use aggressive caching
	// Arbitrary files (pdfs/, documents/, etc.) use shorter cache to allow updates
	w.Header().Set("Content-Type", contentType)
	if h.isContentHashedPath(filename) {
		// Content-addressed file: safe to cache indefinitely
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		// Non-hashed file: use shorter cache (matches PersistentAssetsHandler)
		w.Header().Set("Cache-Control", "public, max-age=86400")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")

	slog.Debug("uploaded_media.serve", "path", cleanPath, "content_type", contentType)

	// Serve the file
	http.ServeFile(w, r, cleanPath)
}

func (h *UploadedMediaHandler) respondError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// isContentHashedPath determines if a filename is in a known content-addressed location.
// Returns true for:
// - Flat files (no subdirectory): legacy content-hashed files like "hero-abc123.jpg"
// - Files in media/, images/, uploads/ subdirectories: known content-hashed locations
// Returns false for:
// - Files in other subdirectories (pdfs/, documents/, etc.): may not be content-hashed
func (h *UploadedMediaHandler) isContentHashedPath(filename string) bool {
	// Flat files (no subdirectory) are content-hashed (legacy behavior)
	if !strings.Contains(filename, "/") {
		return true
	}

	// Files in known content-hashed subdirectories
	return strings.HasPrefix(filename, "media/") ||
		strings.HasPrefix(filename, "images/") ||
		strings.HasPrefix(filename, "uploads/")
}

// findMediaFile searches for the media file in configured search paths.
// Returns the cleaned path, file info, and any error.
func (h *UploadedMediaHandler) findMediaFile(filename string) (string, os.FileInfo, error) {
	var lastErr error
	for i, dir := range h.searchPaths {
		filePath := filepath.Join(dir, filename)
		cleanPath := filepath.Clean(filePath)

		// Defense-in-depth: Validate path is still under the directory after normalization
		// Use filepath.Rel to avoid edge cases with string prefix matching (e.g., /tmp/media vs /tmp/mediaevil)
		rel, err := filepath.Rel(dir, cleanPath)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue // Skip this directory, path escape attempt
		}

		// Resolve symlinks to prevent escapes (matches PersistentAssetsHandler behavior)
		resolved, err := filepath.EvalSymlinks(cleanPath)
		if err != nil {
			// File doesn't exist or symlink is broken, try next path
			lastErr = err
			continue
		}

		// Resolve the directory path as well to handle cases where the dir itself
		// contains symlinks (e.g., /tmp -> /private/tmp on macOS)
		resolvedDir, err := filepath.EvalSymlinks(dir)
		if err != nil {
			// Directory doesn't exist, skip to next path
			lastErr = err
			continue
		}

		// Verify resolved path is still under the resolved directory
		if !strings.HasPrefix(resolved, resolvedDir+string(filepath.Separator)) &&
			resolved != resolvedDir {
			slog.Warn("uploaded_media.symlink_escape_attempt",
				"requested", filename,
				"resolved", resolved,
				"allowed_dir", resolvedDir)
			continue // Skip this directory, symlink escape attempt
		}

		slog.Debug("uploaded_media.checking_path", "path", resolved)
		info, err := os.Stat(resolved)
		if err == nil {
			if i > 0 {
				slog.Debug("uploaded_media.found_in_fallback",
					"primary_path", h.searchPaths[0],
					"found_in", dir)
			}
			return resolved, info, nil
		}
		lastErr = err
	}

	// Return the last error (typically "file not found")
	if lastErr != nil {
		return "", nil, lastErr
	}
	return "", nil, os.ErrNotExist
}

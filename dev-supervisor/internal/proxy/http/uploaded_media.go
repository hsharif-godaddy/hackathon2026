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

	// Security: Block path traversal attempts
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
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

	// Set cache headers (1 year, immutable since filename includes hash)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
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

// findMediaFile searches for the media file in configured search paths.
// Returns the cleaned path, file info, and any error.
func (h *UploadedMediaHandler) findMediaFile(filename string) (string, os.FileInfo, error) {
	var lastErr error
	for i, dir := range h.searchPaths {
		filePath := filepath.Join(dir, filename)
		cleanPath := filepath.Clean(filePath)

		// Validate path is still under the directory (prevent path traversal)
		if !strings.HasPrefix(cleanPath, dir+string(filepath.Separator)) &&
			cleanPath != filepath.Join(dir, filename) {
			continue // Skip this directory, path escape attempt
		}

		slog.Debug("uploaded_media.checking_path", "path", cleanPath)
		info, err := os.Stat(cleanPath)
		if err == nil {
			if i > 0 {
				slog.Debug("uploaded_media.found_in_fallback",
					"primary_path", h.searchPaths[0],
					"found_in", dir)
			}
			return cleanPath, info, nil
		}
		lastErr = err
	}

	// Return the last error (typically "file not found")
	if lastErr != nil {
		return "", nil, lastErr
	}
	return "", nil, os.ErrNotExist
}

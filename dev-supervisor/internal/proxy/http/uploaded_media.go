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

// UploadedMediaHandler serves user-uploaded media files from /public/media/.
type UploadedMediaHandler struct {
	appRoot string
}

// NewUploadedMediaHandler creates a new handler for serving uploaded media.
// appRoot is the base path where the app is located (e.g., /app).
func NewUploadedMediaHandler(appRoot string) *UploadedMediaHandler {
	return &UploadedMediaHandler{
		appRoot: appRoot,
	}
}

// ServeHTTP serves uploaded media files.
func (h *UploadedMediaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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

	// Build full path to file
	filePath := filepath.Join(h.appRoot, "public", "media", filename)

	// Clean the path and verify it's still under media directory
	// Note: We add path separator to prevent matching sibling directories like "media-other"
	cleanPath := filepath.Clean(filePath)
	mediaDir := filepath.Join(h.appRoot, "public", "media")
	if !strings.HasPrefix(cleanPath, mediaDir+string(filepath.Separator)) {
		slog.Warn("uploaded_media.path_escape_attempt",
			"url", r.URL.Path,
			"resolved", cleanPath)
		h.respondError(w, "invalid path", http.StatusBadRequest)
		return
	}

	// Check if file exists
	info, err := os.Stat(cleanPath)
	if os.IsNotExist(err) {
		slog.Debug("uploaded_media.not_found", "path", cleanPath)
		h.respondError(w, "file not found", http.StatusNotFound)
		return
	}
	if err != nil {
		slog.Error("uploaded_media.stat_error", "path", cleanPath, "error", err.Error())
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

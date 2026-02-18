package httpproxy

import (
	"encoding/json"
	"errors"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

// ErrSlotNotFound is returned when a requested image slot does not exist in the manifest.
var ErrSlotNotFound = errors.New("image slot not found")

// ImageSize represents the requested dimensions for an image slot.
// The Fit field is stored for future use by image transformation services.
type ImageSize struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Fit    string `json:"fit"` // "cover", "contain", or "crop" - reserved for future use
}

// ImageSlot represents a single image slot entry in the manifest.
type ImageSlot struct {
	CurrentURL    string     `json:"currentUrl"`
	SearchQuery   string     `json:"searchQuery"`
	RequestedSize *ImageSize `json:"requestedSize,omitempty"`
	Alternatives  []string   `json:"alternatives,omitempty"`
	UserModified  bool       `json:"userModified"`
	CreatedAt     string     `json:"createdAt"`
	LastUpdated   string     `json:"lastUpdated"`
}

// ImageManifest maps slot paths to their slot data.
type ImageManifest map[string]ImageSlot

// ManifestCache provides thread-safe access to the image slots manifest
// with automatic reload when the file is modified.
// Supports multiple fallback paths for different deployment modes (preview vs publish).
type ManifestCache struct {
	mu            sync.RWMutex
	manifest      ImageManifest
	lastModTime   time.Time
	filePath      string
	fallbackPaths []string
	resolvedPath  string // The actual path that was successfully loaded
}

// NewManifestCache creates a new ManifestCache for the given file path.
// Additional fallback paths can be provided for different deployment modes.
func NewManifestCache(filePath string, fallbackPaths ...string) *ManifestCache {
	return &ManifestCache{
		filePath:      filePath,
		fallbackPaths: fallbackPaths,
	}
}

// Get retrieves an image slot by path. Returns ErrSlotNotFound if the slot doesn't exist.
// Returns an error if the manifest file cannot be read or parsed.
func (c *ManifestCache) Get(slotPath string) (*ImageSlot, error) {
	if err := c.ensureLoaded(); err != nil {
		return nil, err
	}

	c.mu.RLock()
	defer c.mu.RUnlock()

	if slot, ok := c.manifest[slotPath]; ok {
		return &slot, nil
	}
	return nil, ErrSlotNotFound
}

// ensureLoaded checks if the manifest needs to be reloaded and loads it if necessary.
// Tries the primary path first, then falls back to alternate paths if not found.
func (c *ManifestCache) ensureLoaded() error {
	// Try to find the manifest file, checking primary path first then fallbacks
	pathToUse, info, err := c.findManifestFile()
	if err != nil {
		return err
	}

	c.mu.RLock()
	needsReload := c.manifest == nil || info.ModTime().After(c.lastModTime) || c.resolvedPath != pathToUse
	c.mu.RUnlock()

	if needsReload {
		return c.reload(pathToUse, info.ModTime())
	}
	return nil
}

// findManifestFile tries the primary path and fallbacks to find the manifest file.
func (c *ManifestCache) findManifestFile() (string, os.FileInfo, error) {
	// If we've already resolved a path and it still exists, use it
	c.mu.RLock()
	resolvedPath := c.resolvedPath
	c.mu.RUnlock()

	if resolvedPath != "" {
		if info, err := os.Stat(resolvedPath); err == nil {
			return resolvedPath, info, nil
		}
	}

	// Try primary path
	if info, err := os.Stat(c.filePath); err == nil {
		return c.filePath, info, nil
	}

	// Try fallback paths
	for _, fallbackPath := range c.fallbackPaths {
		if info, err := os.Stat(fallbackPath); err == nil {
			slog.Debug("manifest.using_fallback_path",
				"primary_path", c.filePath,
				"fallback_path", fallbackPath)
			return fallbackPath, info, nil
		}
	}

	// Return error for primary path if no path found
	_, err := os.Stat(c.filePath)
	return "", nil, err
}

// reload reads and parses the manifest file from the given path.
func (c *ManifestCache) reload(filePath string, modTime time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check after acquiring write lock
	if c.manifest != nil && !modTime.After(c.lastModTime) && c.resolvedPath == filePath {
		return nil
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}

	var manifest ImageManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return err
	}

	c.manifest = manifest
	c.lastModTime = modTime
	c.resolvedPath = filePath
	slog.Debug("image_slot.manifest_loaded", "path", filePath, "slot_count", len(manifest))
	return nil
}

// mediaSlotHandler provides shared logic for image and video slot handlers.
type mediaSlotHandler struct {
	cache            *ManifestCache
	prefix           string
	allowedHosts     map[string]struct{}
	mediaType        string   // "image" or "video" for logging
	mediaSearchPaths []string // directories to search for local uploads
}

// serveSlot handles the common logic for serving media slots.
// Supports optional ?src= query parameter to serve a specific URL from the slot's alternatives.
func (h *mediaSlotHandler) serveSlot(w http.ResponseWriter, r *http.Request) {
	// Only GET and HEAD allowed
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract slot path - verify prefix was actually removed
	slotPath := strings.TrimPrefix(r.URL.Path, h.prefix)
	if slotPath == "" || slotPath == r.URL.Path {
		slog.Debug(h.mediaType+"_slot.invalid_path", "url", r.URL.Path)
		h.respondError(w, "invalid slot path", http.StatusBadRequest)
		return
	}

	// Look up in manifest
	slot, err := h.cache.Get(slotPath)
	if errors.Is(err, ErrSlotNotFound) {
		slog.Debug(h.mediaType+"_slot.not_found", "slot", slotPath)
		h.respondError(w, "slot not found", http.StatusNotFound)
		return
	}
	if err != nil {
		slog.Error(h.mediaType+"_slot.manifest_error", "slot", slotPath, "error", err.Error())
		h.respondError(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Determine which URL to serve: ?src= parameter or currentUrl
	targetURL := slot.CurrentURL
	if srcParam := r.URL.Query().Get("src"); srcParam != "" {
		// Validate that the requested URL is associated with this slot
		if !h.isValidSlotURL(slot, srcParam) {
			slog.Warn(h.mediaType+"_slot.invalid_src_param",
				"slot", slotPath, "src", srcParam, "reason", "not_in_slot")
			h.respondError(w, "invalid src parameter", http.StatusBadRequest)
			return
		}
		targetURL = srcParam
		slog.Debug(h.mediaType+"_slot.using_src_param", "slot", slotPath, "src", srcParam)
	}

	// Handle local uploads (serve directly instead of redirecting)
	if strings.HasPrefix(targetURL, "/airo-assets/uploads/") {
		h.serveLocalUpload(w, r, slotPath, targetURL)
		return
	}

	// Validate redirect URL against allowlist to prevent open redirect
	// Must be HTTPS with a trusted host to prevent javascript:, data:, or other scheme attacks
	redirectURL, err := url.Parse(targetURL)
	if err != nil || redirectURL.Scheme != "https" {
		slog.Error(h.mediaType+"_slot.invalid_redirect_url",
			"slot", slotPath, "url", targetURL, "reason", "invalid_scheme")
		h.respondError(w, "invalid "+h.mediaType+" URL", http.StatusInternalServerError)
		return
	}
	if _, ok := h.allowedHosts[redirectURL.Host]; !ok {
		slog.Error(h.mediaType+"_slot.invalid_redirect_url",
			"slot", slotPath, "url", targetURL, "reason", "untrusted_host")
		h.respondError(w, "invalid "+h.mediaType+" URL", http.StatusInternalServerError)
		return
	}

	slog.Debug(h.mediaType+"_slot.redirect", "slot", slotPath, "url", targetURL)
	http.Redirect(w, r, targetURL, http.StatusFound)
}

// isValidSlotURL checks if the given URL is associated with the slot (currentUrl or in alternatives).
func (h *mediaSlotHandler) isValidSlotURL(slot *ImageSlot, targetURL string) bool {
	// Check if it matches currentUrl or is in alternatives
	return slot.CurrentURL == targetURL || slices.Contains(slot.Alternatives, targetURL)
}

// findMediaFile searches for a media file in configured search paths.
func (h *mediaSlotHandler) findMediaFile(filename string) (string, os.FileInfo, error) {
	var lastErr error
	for i, dir := range h.mediaSearchPaths {
		filePath := filepath.Join(dir, filename)
		cleanPath := filepath.Clean(filePath)

		// Validate path is still under the directory (prevent path traversal)
		if !strings.HasPrefix(cleanPath, dir+string(filepath.Separator)) &&
			cleanPath != filepath.Join(dir, filename) {
			continue // Skip this directory, path escape attempt
		}

		slog.Debug(h.mediaType+"_slot.checking_path", "path", cleanPath)
		info, err := os.Stat(cleanPath)
		if err == nil {
			if i > 0 {
				slog.Debug(h.mediaType+"_slot.found_in_fallback",
					"primary_path", h.mediaSearchPaths[0],
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

// serveLocalUpload serves an uploaded file from the local filesystem.
func (h *mediaSlotHandler) serveLocalUpload(w http.ResponseWriter, r *http.Request, slotPath, uploadURL string) {
	// Extract filename from /airo-assets/uploads/filename.jpg
	filename := strings.TrimPrefix(uploadURL, "/airo-assets/uploads/")
	if filename == "" || filename == uploadURL {
		slog.Error(h.mediaType+"_slot.invalid_upload_url", "slot", slotPath, "url", uploadURL)
		h.respondError(w, "invalid upload URL", http.StatusInternalServerError)
		return
	}

	// Security: Block path traversal attempts
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		slog.Warn(h.mediaType+"_slot.path_traversal_attempt", "slot", slotPath, "filename", filename)
		h.respondError(w, "invalid filename", http.StatusBadRequest)
		return
	}

	// Find the file, checking primary path and fallbacks
	cleanPath, info, err := h.findMediaFile(filename)
	if err != nil {
		if os.IsNotExist(err) {
			slog.Debug(h.mediaType+"_slot.upload_not_found", "slot", slotPath, "filename", filename)
			h.respondError(w, "file not found", http.StatusNotFound)
			return
		}
		slog.Error(h.mediaType+"_slot.stat_error", "slot", slotPath, "filename", filename, "error", err.Error())
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

	// Set cache headers - use no-cache to force revalidation on each request.
	// http.ServeFile automatically handles ETag (based on mtime) and If-None-Match,
	// returning 304 Not Modified if the file hasn't changed. This gives equivalent
	// performance to Getty redirects (always a round-trip, but no body if unchanged).
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	slog.Debug(h.mediaType+"_slot.serve_upload", "slot", slotPath, "path", cleanPath, "content_type", contentType)

	// Serve the file
	http.ServeFile(w, r, cleanPath)
}

// respondError writes a JSON error response using proper JSON encoding.
func (h *mediaSlotHandler) respondError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

const imageSlotPrefix = "/airo-assets/images/"

// allowedImageRedirectHosts contains the trusted domains for image redirects.
// Only HTTPS URLs with these hosts are allowed as redirect targets.
var allowedImageRedirectHosts = map[string]struct{}{
	"media.gettyimages.com":                     {},
	"media.istockphoto.com":                     {},
	"oaidalleapiprodscus.blob.core.windows.net": {}, // DALL-E
	"blobby.wsimg.com":                          {}, // GoDaddy image hosting
}

// ImageSlotHandler handles requests for image slots.
type ImageSlotHandler struct {
	mediaSlotHandler
}

// NewImageSlotHandler creates a new handler with the given manifest cache and media search paths.
func NewImageSlotHandler(cache *ManifestCache, mediaSearchPaths []string) *ImageSlotHandler {
	return &ImageSlotHandler{
		mediaSlotHandler: mediaSlotHandler{
			cache:            cache,
			prefix:           imageSlotPrefix,
			allowedHosts:     allowedImageRedirectHosts,
			mediaType:        "image",
			mediaSearchPaths: mediaSearchPaths,
		},
	}
}

// ServeHTTP handles image slot requests.
func (h *ImageSlotHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.serveSlot(w, r)
}

const videoSlotPrefix = "/airo-assets/videos/"

// allowedVideoRedirectHosts contains the trusted domains for video redirects.
// Only HTTPS URLs with these hosts are allowed as redirect targets.
var allowedVideoRedirectHosts = map[string]struct{}{
	"media.gettyimages.com":  {},
	"media.istockphoto.com":  {},
	"cdn.videvo.net":         {},
	"player.vimeo.com":       {},
	"www.youtube.com":        {},
	"storage.googleapis.com": {},
}

// VideoSlotHandler handles requests for video slots.
type VideoSlotHandler struct {
	mediaSlotHandler
}

// NewVideoSlotHandler creates a new handler with the given manifest cache and media search paths.
func NewVideoSlotHandler(cache *ManifestCache, mediaSearchPaths []string) *VideoSlotHandler {
	return &VideoSlotHandler{
		mediaSlotHandler: mediaSlotHandler{
			cache:            cache,
			prefix:           videoSlotPrefix,
			allowedHosts:     allowedVideoRedirectHosts,
			mediaType:        "video",
			mediaSearchPaths: mediaSearchPaths,
		},
	}
}

// ServeHTTP handles video slot requests.
func (h *VideoSlotHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.serveSlot(w, r)
}

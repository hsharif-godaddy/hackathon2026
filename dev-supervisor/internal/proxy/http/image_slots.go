package httpproxy

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
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
type ManifestCache struct {
	mu          sync.RWMutex
	manifest    ImageManifest
	lastModTime time.Time
	filePath    string
}

// NewManifestCache creates a new ManifestCache for the given file path.
func NewManifestCache(filePath string) *ManifestCache {
	return &ManifestCache{
		filePath: filePath,
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
func (c *ManifestCache) ensureLoaded() error {
	info, err := os.Stat(c.filePath)
	if err != nil {
		return err
	}

	c.mu.RLock()
	needsReload := c.manifest == nil || info.ModTime().After(c.lastModTime)
	c.mu.RUnlock()

	if needsReload {
		return c.reload(info.ModTime())
	}
	return nil
}

// reload reads and parses the manifest file.
func (c *ManifestCache) reload(modTime time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check after acquiring write lock
	if c.manifest != nil && !modTime.After(c.lastModTime) {
		return nil
	}

	data, err := os.ReadFile(c.filePath)
	if err != nil {
		return err
	}

	var manifest ImageManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return err
	}

	c.manifest = manifest
	c.lastModTime = modTime
	slog.Debug("image_slot.manifest_loaded", "path", c.filePath, "slot_count", len(manifest))
	return nil
}

const imageSlotPrefix = "/airo-assets/images/"

// allowedRedirectHosts contains the trusted domains for image redirects.
// Only HTTPS URLs with these hosts are allowed as redirect targets.
var allowedRedirectHosts = map[string]struct{}{
	"media.gettyimages.com":                     {},
	"media.istockphoto.com":                     {},
	"oaidalleapiprodscus.blob.core.windows.net": {}, // DALL-E
}

// ImageSlotHandler handles requests for image slots.
type ImageSlotHandler struct {
	cache *ManifestCache
}

// NewImageSlotHandler creates a new handler with the given manifest cache.
func NewImageSlotHandler(cache *ManifestCache) *ImageSlotHandler {
	return &ImageSlotHandler{cache: cache}
}

// ServeHTTP handles image slot requests.
func (h *ImageSlotHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Only GET and HEAD allowed
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract slot path - verify prefix was actually removed
	slotPath := strings.TrimPrefix(r.URL.Path, imageSlotPrefix)
	if slotPath == "" || slotPath == r.URL.Path {
		slog.Debug("image_slot.invalid_path", "url", r.URL.Path)
		h.respondError(w, "invalid slot path", http.StatusBadRequest)
		return
	}

	// Look up in manifest
	slot, err := h.cache.Get(slotPath)
	if errors.Is(err, ErrSlotNotFound) {
		slog.Debug("image_slot.not_found", "slot", slotPath)
		h.respondError(w, "slot not found", http.StatusNotFound)
		return
	}
	if err != nil {
		slog.Error("image_slot.manifest_error", "slot", slotPath, "error", err.Error())
		h.respondError(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Validate redirect URL against allowlist to prevent open redirect
	// Must be HTTPS with a trusted host to prevent javascript:, data:, or other scheme attacks
	redirectURL, err := url.Parse(slot.CurrentURL)
	if err != nil || redirectURL.Scheme != "https" {
		slog.Error("image_slot.invalid_redirect_url",
			"slot", slotPath, "url", slot.CurrentURL, "reason", "invalid_scheme")
		h.respondError(w, "invalid image URL", http.StatusInternalServerError)
		return
	}
	if _, ok := allowedRedirectHosts[redirectURL.Host]; !ok {
		slog.Error("image_slot.invalid_redirect_url",
			"slot", slotPath, "url", slot.CurrentURL, "reason", "untrusted_host")
		h.respondError(w, "invalid image URL", http.StatusInternalServerError)
		return
	}

	slog.Debug("image_slot.redirect", "slot", slotPath, "url", slot.CurrentURL)
	http.Redirect(w, r, slot.CurrentURL, http.StatusFound)
}

// respondError writes a JSON error response using proper JSON encoding.
func (h *ImageSlotHandler) respondError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

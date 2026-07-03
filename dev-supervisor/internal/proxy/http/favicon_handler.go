package httpproxy

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"
)

const faviconSlotPath = "logo/favicon"

// FaviconHandler serves /favicon.ico by looking up the logo/favicon media slot.
// If the slot exists and has a valid CDN URL, it redirects. Otherwise it falls
// through to the next handler (typically the reverse proxy to Vite, which serves
// public/favicon.ico from disk — the rebuild self-host path).
type FaviconHandler struct {
	cache        *ManifestCache
	fallback     http.Handler
	allowedHosts map[string]struct{}
}

// NewFaviconHandler creates a handler that resolves /favicon.ico from the media
// manifest's logo/favicon slot, falling back to the provided handler on miss.
func NewFaviconHandler(cache *ManifestCache, allowedHosts map[string]struct{}, fallback http.Handler) *FaviconHandler {
	return &FaviconHandler{
		cache:        cache,
		fallback:     fallback,
		allowedHosts: allowedHosts,
	}
}

func (h *FaviconHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.fallback.ServeHTTP(w, r)
		return
	}

	slot, err := h.cache.Get(faviconSlotPath)
	if errors.Is(err, ErrSlotNotFound) || slot == nil {
		h.fallback.ServeHTTP(w, r)
		return
	}
	if err != nil {
		slog.Warn("favicon.manifest_read_error", "error", err)
		h.fallback.ServeHTTP(w, r)
		return
	}

	targetURL := slot.CurrentURL
	if targetURL == "" {
		h.fallback.ServeHTTP(w, r)
		return
	}

	// Local uploads: fall through (Vite can serve the file)
	if len(targetURL) > 0 && targetURL[0] == '/' {
		h.fallback.ServeHTTP(w, r)
		return
	}

	parsed, err := url.Parse(targetURL)
	if err != nil || parsed.Scheme != "https" {
		slog.Error("favicon.invalid_redirect_url", "url", targetURL, "reason", "invalid_scheme")
		h.fallback.ServeHTTP(w, r)
		return
	}
	if _, ok := h.allowedHosts[parsed.Host]; !ok {
		slog.Error("favicon.invalid_redirect_url", "url", targetURL, "reason", "untrusted_host")
		h.fallback.ServeHTTP(w, r)
		return
	}

	slog.Debug("favicon.redirect", "url", targetURL)
	w.Header().Set("Cache-Control", "no-cache")
	http.Redirect(w, r, targetURL, http.StatusFound)
}

package httpproxy

import (
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
)

// handleStaticRequest handles static file serving and SPA fallback.
// Returns true if the request was handled, false if it should fall through to proxy.
func (rr *RequestRouter) handleStaticRequest(w http.ResponseWriter, r *http.Request) bool {
	// Has file extension? Serve as static file directly.
	if path.Ext(r.URL.Path) != "" {
		slog.Debug("serving static file", "path", r.URL.Path, "method", r.Method)
		rr.staticHandler.ServeHTTP(w, r)
		return true
	}

	// No extension - first try to serve as a real file (e.g., /.well-known/apple-app-site-association).
	// If the file doesn't exist (404), fall back to SPA for GET requests or proxy for HEAD/OPTIONS.
	if rr.staticHandler != nil {
		if handled := rr.tryServeStaticFile(w, r); handled {
			return true
		}
	}

	// SPA fallback for GET requests (serve index.html with no-cache).
	if rr.spaFallback != "" && r.Method == http.MethodGet {
		slog.Debug("SPA fallback", "path", r.URL.Path)
		// Set no-cache headers for SPA shell (index.html should never be cached).
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		http.ServeFile(w, r, rr.spaFallback)
		return true
	}

	return false
}

// tryServeStaticFile attempts to serve a file from the static handler.
// Returns true if the request was handled (file found or 404 returned), false if it should fall through.
func (rr *RequestRouter) tryServeStaticFile(w http.ResponseWriter, r *http.Request) bool {
	// Use an isolated recorder to probe if the file exists without contaminating
	// the real response writer's headers (avoids Content-Type: text/plain leak).
	recorder := httptest.NewRecorder()
	rr.staticHandler.ServeHTTP(recorder, r)

	// If file was found (not 404), copy the response to the real writer.
	if recorder.Code != http.StatusNotFound {
		// Copy headers from recorder to real response.
		maps.Copy(w.Header(), recorder.Header())

		// If serving HTML (e.g., index.html from a directory request like /),
		// override with strict no-cache headers to prevent stale app shell.
		contentType := recorder.Header().Get("Content-Type")
		if strings.Contains(contentType, "text/html") {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			w.Header().Set("Pragma", "no-cache")
			w.Header().Set("Expires", "0")
		}

		w.WriteHeader(recorder.Code)
		// Safe: Static file proxy serving disk content (images, CSS, JS), not user input.
		// Semgrep G203 false positive: HTML escaping would corrupt binary/structured assets.
		if _, err := w.Write(recorder.Body.Bytes()); err != nil {
			slog.Error("failed to write response body", "error", err)
		}
		return true
	}

	// File not found - behavior depends on method and SPA mode.
	if r.Method != http.MethodGet && rr.spaFallback != "" {
		http.NotFound(w, r)
		return true
	}

	return false
}

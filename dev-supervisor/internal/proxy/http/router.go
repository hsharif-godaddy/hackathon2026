package httpproxy

import (
	"errors"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
	"time"
)

// RequestRouter handles HTTP request routing based on configuration.
// Routes requests to static file handler, SPA fallback, or backend proxy.
type RequestRouter struct {
	staticHandler         http.Handler
	proxyHandler          http.Handler
	spaFallback           string
	apiPrefix             string
	isProductionMode      bool
	allowedOrigins        []string
	procMgr               ProcessController
	startOnRequestEnabled bool
}

// handleAutoStart handles requests when the app is stopped.
// Holds the request open, starts the process, and forwards when ready.
func (rr *RequestRouter) handleAutoStart(w http.ResponseWriter, r *http.Request) {
	slog.Info("autostart.triggered",
		"path", r.URL.Path,
		"method", r.Method,
		"remote_addr", r.RemoteAddr)

	// Get current process start request.
	startReq := rr.procMgr.GetStartRequest()
	if startReq == nil {
		slog.Error("autostart.no_config")
		http.Error(w, "Service configuration error", http.StatusInternalServerError)
		return
	}

	// Start the process.
	startTime := time.Now()
	err := rr.procMgr.Start(*startReq)
	// Accept benign race conditions (already starting, already running).
	if err != nil {
		if !errors.Is(err, ErrAlreadyStarting) && !errors.Is(err, ErrAlreadyRunning) {
			slog.Error("autostart.failed", "error", err)
			http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
		// Log the benign race for observability.
		slog.Info("autostart.concurrent_race", "error", err.Error())
	}

	// Wait for process to be ready (hold the request).
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.After(60 * time.Second)

	for {
		select {
		case <-r.Context().Done():
			// Client disconnected or canceled the request.
			slog.Info("autostart.client_canceled",
				"path", r.URL.Path,
				"method", r.Method,
				"reason", r.Context().Err())
			return

		case <-timeout:
			slog.Error("autostart.timeout",
				"path", r.URL.Path,
				"method", r.Method)
			http.Error(w, "Service startup timeout", http.StatusGatewayTimeout)
			return

		case <-ticker.C:
			status := rr.procMgr.GetStatus()

			switch status.State {
			case ProcessStateStopped, ProcessStateStopping:
				// Keep waiting - these states shouldn't happen during startup
				// but handle them gracefully.
				slog.Debug("autostart.unexpected_state",
					"state", status.State,
					"path", r.URL.Path)

			case ProcessStateRunning:
				duration := time.Since(startTime)
				slog.Info("autostart.process_ready",
					"pid", status.PID,
					"startup_duration_ms", duration.Milliseconds(),
					"path", r.URL.Path,
					"method", r.Method)

				// Update activity before forwarding.
				rr.procMgr.UpdateActivity()

				// Forward the original request to backend.
				rr.proxyHandler.ServeHTTP(w, r)
				return

			case ProcessStateError:
				slog.Error("autostart.process_failed",
					"error", status.Error,
					"state", status.State,
					"path", r.URL.Path)
				http.Error(w, "Service startup failed", http.StatusBadGateway)
				return

			case ProcessStateStarting:
				// Keep waiting.
				slog.Debug("autostart.waiting",
					"pid", status.PID,
					"state", status.State)
			}
		}
	}
}

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

// ServeHTTP implements http.Handler interface for RequestRouter.
// Routes requests based on path, method, and configuration.
func (rr *RequestRouter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Check if we need to auto-start (any request can trigger it).
	if rr.procMgr != nil && rr.startOnRequestEnabled {
		status := rr.procMgr.GetStatus()
		if status.State == ProcessStateStopped || status.State == ProcessStateError {
			rr.handleAutoStart(w, r)
			return
		}
	}

	// 1. API routes - always proxy to backend.
	if strings.HasPrefix(r.URL.Path, rr.apiPrefix) {
		slog.Debug("routing to API backend", "path", r.URL.Path)
		if rr.procMgr != nil && rr.startOnRequestEnabled {
			rr.procMgr.UpdateActivity()
		}
		rr.proxyHandler.ServeHTTP(w, r)
		return
	}

	// 2. Static serving disabled - proxy everything else to backend.
	if !rr.isProductionMode {
		slog.Debug("proxying to backend (static serving disabled)", "path", r.URL.Path)
		if rr.procMgr != nil && rr.startOnRequestEnabled {
			rr.procMgr.UpdateActivity()
		}
		rr.proxyHandler.ServeHTTP(w, r)
		return
	}

	// 3. Static serving enabled - handle safe HTTP methods for static content.
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		if handled := rr.handleStaticRequest(w, r); handled {
			return
		}
	}

	// 4. Default - proxy to backend.
	if rr.procMgr != nil && rr.startOnRequestEnabled {
		rr.procMgr.UpdateActivity()
	}
	rr.proxyHandler.ServeHTTP(w, r)
}

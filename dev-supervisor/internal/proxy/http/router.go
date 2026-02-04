package httpproxy

import (
	"log/slog"
	"net/http"
	"strings"
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

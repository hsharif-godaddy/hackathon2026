package httpproxy

import (
	"log/slog"
	"net/http"
	"strings"
)

// RequestRouter handles HTTP request routing.
// Routes API requests and all other requests to the backend proxy.
type RequestRouter struct {
	proxyHandler          http.Handler
	apiPrefix             string
	allowedOrigins        []string
	procMgr               ProcessController
	startOnRequestEnabled bool
	backendAddr           string // host:port of backend for TCP readiness probes
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

	// 2. All other requests - proxy to backend.
	slog.Debug("proxying to backend", "path", r.URL.Path)
	if rr.procMgr != nil && rr.startOnRequestEnabled {
		rr.procMgr.UpdateActivity()
	}
	rr.proxyHandler.ServeHTTP(w, r)
}

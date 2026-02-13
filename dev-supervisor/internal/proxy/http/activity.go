package httpproxy

import (
	"net/http"

	"github.com/airo-ai-builder/dev-supervisor/internal/middleware"
)

func activityTrackingMiddleware(next http.Handler, procMgr ProcessController, excludedPaths []string) http.Handler {
	if procMgr == nil || !procMgr.IsStartOnRequestEnabled() {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Track request start - reject if idle shutdown is in progress
		if !procMgr.TrackRequest() {
			// Idle shutdown in progress, reject request
			http.Error(w, "Service draining", http.StatusServiceUnavailable)
			return
		}
		// Ensure cleanup always happens, even on panic
		defer procMgr.UntrackRequest()

		// Update activity at request start for non-excluded paths.
		// Skip health checks and monitoring to prevent automated probes from keeping apps alive.
		if !middleware.IsPathExcluded(r.URL.Path, excludedPaths) {
			procMgr.UpdateActivity()
		}

		next.ServeHTTP(w, r)
	})
}

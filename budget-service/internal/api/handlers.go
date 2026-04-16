package api

import (
	"net/http"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
)

// TokenProvider generates tokens for outbound webhook authentication.
// Implemented by auth.TokenGenerator; can be stubbed in tests.
type TokenProvider interface {
	GetToken() (string, error)
	Healthy() bool
	LastError() error
}

// Server holds handler dependencies.
type Server struct {
	Store            *store.Store  // nil if DATABASE_URL was unset at startup
	WebhookClient    *http.Client  // optional outbound HTTP for report webhooks (default 15s timeout)
	TokenGenerator   TokenProvider // required for webhook delivery when auth is enabled; nil in local dev
	LocalAuthDisable bool          // true when LOCAL_AUTH_DISABLE=true; relaxes webhook URL validation
	LogRequestBodies bool          // LOG_REQUEST_BODIES: log POST/PATCH bodies on http.request.complete
}

func (s *Server) getHealth(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"status": "ok"}
	status := http.StatusOK

	// Database health
	if s.Store != nil {
		if err := s.Store.Ping(r.Context()); err != nil {
			out["status"] = "degraded"
			out["database"] = map[string]any{"ok": false, "error": err.Error()}
			status = http.StatusServiceUnavailable
		} else {
			out["database"] = map[string]any{"ok": true}
		}
	} else {
		out["database"] = map[string]any{"ok": false, "configured": false}
	}

	// Token generator health (required for webhooks when auth is enabled)
	if s.TokenGenerator != nil {
		if s.TokenGenerator.Healthy() {
			out["tokenGenerator"] = map[string]any{"ok": true}
		} else {
			out["status"] = "unhealthy"
			status = http.StatusServiceUnavailable
			errDetail := map[string]any{"ok": false}
			if err := s.TokenGenerator.LastError(); err != nil {
				errDetail["error"] = err.Error()
			}
			out["tokenGenerator"] = errDetail
		}
	} else {
		// TokenGenerator is nil only in local dev with auth disabled
		out["tokenGenerator"] = map[string]any{"ok": true, "configured": false}
	}

	if r.Method == http.MethodHead {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		return
	}
	writeJSON(w, status, out)
}

package api

import (
	"log/slog"
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
	httpStatus := http.StatusOK
	outStatus := "ok"

	if s.Store != nil {
		if err := s.Store.Ping(r.Context()); err != nil {
			slog.Warn("health.database.ping", "error", err)
			outStatus = "degraded"
			httpStatus = http.StatusServiceUnavailable
		}
	}

	if s.TokenGenerator != nil && !s.TokenGenerator.Healthy() {
		if err := s.TokenGenerator.LastError(); err != nil {
			slog.Warn("health.token_generator", "error", err)
		} else {
			slog.Warn("health.token_generator", "reason", "unhealthy_no_last_error")
		}
		outStatus = "unhealthy"
		httpStatus = http.StatusServiceUnavailable
	}

	out := map[string]any{"status": outStatus}

	if r.Method == http.MethodHead {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(httpStatus)
		return
	}
	writeJSON(w, httpStatus, out)
}

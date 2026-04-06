package api

import (
	"net/http"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
)

// Server holds handler dependencies.
type Server struct {
	Store         *store.Store // nil if DATABASE_URL was unset at startup
	WebhookClient *http.Client // optional outbound HTTP for report webhooks (default 15s timeout)
}

func (s *Server) getHealth(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"status": "ok"}
	status := http.StatusOK
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
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		return
	}
	writeJSON(w, status, out)
}

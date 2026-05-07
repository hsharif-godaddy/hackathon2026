package api

import "net/http"

func (s *Server) getHealth(w http.ResponseWriter, r *http.Request) {
	body := map[string]string{
		"status":      "ok",
		"environment": s.Environment,
		"version":     s.Version,
	}
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		return
	}
	writeJSON(w, http.StatusOK, body)
}

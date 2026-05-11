// Package api wires HTTP routes and handlers for stripe-service.
package api

import (
	"net/http"

	"github.com/gorilla/mux"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/awsclients"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/config"
)

// Server holds handler dependencies. More fields land as real routes arrive
// (Stripe client, etc.).
type Server struct {
	Environment   string
	Version       string
	Prober        awsclients.Prober
	ResourceNames config.ResourceNames
}

// NewRouter returns the top-level http.Handler. /health and /v1/_probe are
// open; /api/v1 routes will be added behind auth middleware in a follow-up PR.
func NewRouter(s *Server) http.Handler {
	r := mux.NewRouter()
	r.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "resource not found")
	})
	r.MethodNotAllowedHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "method not allowed")
	})
	r.HandleFunc("/health", s.getHealth).Methods(http.MethodGet, http.MethodHead)
	r.HandleFunc("/v1/_probe", s.getProbe).Methods(http.MethodGet)
	return r
}

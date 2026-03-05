package api

import (
	"net/http"

	"github.com/gorilla/mux"
)

// setupRoutes configures all API routes with appropriate auth middleware.
func (s *Server) setupRoutes() {
	s.router = mux.NewRouter()

	// Global middleware
	s.router.Use(loggingMiddleware)

	// Apply rate limiter if enabled
	if s.rateLimiter != nil {
		s.router.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := s.rateLimiter.Acquire(r.Context()); err != nil {
					writeError(w, http.StatusTooManyRequests, "rate limit exceeded", "RATE_LIMITED")
					return
				}
				defer s.rateLimiter.Release()
				next.ServeHTTP(w, r)
			})
		})
	}

	api := s.router.PathPrefix("/api/v1").Subrouter()

	// Public routes (no auth)
	api.HandleFunc("/health", s.handleHealth).Methods("GET")
	api.HandleFunc("/stats", s.handleStats).Methods("GET")

	// JWT-protected routes (search)
	searchRoutes := api.PathPrefix("").Subrouter()
	searchRoutes.Use(s.authMiddleware.Authenticate)
	searchRoutes.HandleFunc("/search", s.handleSearch).Methods("POST")

	// API-key-protected routes (ingest)
	// TODO: Replace API key auth with GoDaddy IAM JWT auth using an IAM role allowlist.
	ingestRoutes := api.PathPrefix("").Subrouter()
	ingestRoutes.Use(s.authMiddleware.AuthenticateAPIKey(s.config.IngestAPIKey))
	ingestRoutes.HandleFunc("/ingest", s.handleIngest).Methods("POST")
}

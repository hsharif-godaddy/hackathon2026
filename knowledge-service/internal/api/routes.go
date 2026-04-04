package api

import (
	"net/http"
	"time"

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
	api.HandleFunc("/health", s.handleHealth).Methods(http.MethodGet)
	api.HandleFunc("/stats", s.handleStats).Methods(http.MethodGet)

	// JWT-protected routes (search)
	searchRoutes := api.PathPrefix("").Subrouter()
	searchRoutes.Use(s.authMiddleware.Authenticate)
	searchRoutes.Use(deadlineMiddleware(time.Duration(s.config.HTTPSearchTimeout) * time.Second))
	searchRoutes.HandleFunc("/search", s.handleSearch).Methods(http.MethodPost)

	// JWT-protected routes (ingest) — requires an AWS IAM token (service-to-service only)
	ingestRoutes := api.PathPrefix("").Subrouter()
	ingestRoutes.Use(s.authMiddleware.AuthenticateWithKind("awsiam"))
	ingestRoutes.HandleFunc("/ingest", s.handleIngest).Methods(http.MethodPost)
	ingestRoutes.HandleFunc("/collection/reset", s.handleDropCollection).Methods(http.MethodPost)
}

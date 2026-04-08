// Package api provides the HTTP API server for the image search service.
package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	goauth "github.com/gdcorp-partners/airo-app-builder/packages/go-auth"
	"github.com/gorilla/mux"

	"github.com/airo-ai-builder/image-search-service/internal/analysis"
	"github.com/airo-ai-builder/image-search-service/internal/config"
	"github.com/airo-ai-builder/image-search-service/internal/embeddings"
	"github.com/airo-ai-builder/image-search-service/internal/getty"
	"github.com/airo-ai-builder/image-search-service/internal/search"
	"github.com/airo-ai-builder/image-search-service/internal/storage/qdrant"
	"github.com/airo-ai-builder/image-search-service/internal/storage/s3"
)

// Server is the HTTP API server for the image search service.
type Server struct {
	config     *config.Config
	router     *mux.Router
	httpServer *http.Server
	version    string

	// Clients
	getty      *getty.Client
	analysis   *analysis.Client
	embeddings *embeddings.Client
	qdrant     *qdrant.Client
	s3         *s3.Client

	// Orchestrator
	orchestrator *search.Orchestrator

	// Auth
	authMiddleware *goauth.Middleware
}

// NewServer creates a new HTTP API server with the provided configuration.
func NewServer(cfg *config.Config, version string) *Server {
	s := &Server{
		config:  cfg,
		router:  mux.NewRouter(),
		version: version,
	}

	// Initialize auth middleware
	s.authMiddleware = goauth.NewMiddleware(cfg.AuthType, cfg.SSOHost)

	// Apply logging middleware to all routes
	s.router.Use(loggingMiddleware)

	s.setupRoutes()
	return s
}

// Initialize creates all client connections.
func (s *Server) Initialize(ctx context.Context) error {
	start := time.Now()
	slog.Info("server.init.start")

	// Initialize Getty client
	stepStart := time.Now()
	gettyClient, err := createGettyClient(s.config)
	if err != nil {
		return fmt.Errorf("failed to create getty client: %w", err)
	}
	s.getty = gettyClient
	slog.Info("server.init.getty", "durationMs", time.Since(stepStart).Milliseconds())

	// Initialize Analysis client
	stepStart = time.Now()
	s.analysis = analysis.New(s.config)
	slog.Info("server.init.analysis", "durationMs", time.Since(stepStart).Milliseconds())

	// Initialize Embeddings client
	stepStart = time.Now()
	s.embeddings = embeddings.New(s.config)
	slog.Info("server.init.embeddings", "durationMs", time.Since(stepStart).Milliseconds())

	// Initialize Qdrant client
	stepStart = time.Now()
	qdrantClient, err := qdrant.New(s.config)
	if err != nil {
		return fmt.Errorf("failed to create qdrant client: %w", err)
	}
	s.qdrant = qdrantClient
	slog.Info("server.init.qdrant.client", "durationMs", time.Since(stepStart).Milliseconds())

	// Ensure collection exists with correct schema
	stepStart = time.Now()
	if err := s.qdrant.EnsureCollection(ctx); err != nil {
		return fmt.Errorf("failed to ensure qdrant collection: %w", err)
	}
	slog.Info("server.init.qdrant.collection", "durationMs", time.Since(stepStart).Milliseconds())

	// Initialize S3 client (optional - only if bucket is configured)
	if s.config.S3Bucket != "" {
		stepStart = time.Now()
		s3Client, err := s3.New(ctx, s.config)
		if err != nil {
			return fmt.Errorf("failed to create s3 client: %w", err)
		}
		s.s3 = s3Client
		slog.Info("server.init.s3", "durationMs", time.Since(stepStart).Milliseconds())
	}

	// Create search orchestrator
	stepStart = time.Now()
	s.orchestrator = search.New(s.getty, s.analysis, s.embeddings, s.qdrant, s.s3, s.config.RelativeScoreRatio)
	slog.Info("server.init.orchestrator", "durationMs", time.Since(stepStart).Milliseconds())

	slog.Info("server.init.complete", "totalDurationMs", time.Since(start).Milliseconds())
	return nil
}

// Start starts the HTTP server. If TLS cert/key paths are configured, it serves HTTPS.
func (s *Server) Start() error {
	s.httpServer = &http.Server{
		Addr:         fmt.Sprintf(":%d", s.config.Port),
		Handler:      s.router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	if s.config.TLSCertPath != "" && s.config.TLSKeyPath != "" {
		slog.Info("server.start.tls", "addr", s.httpServer.Addr, "certPath", s.config.TLSCertPath)
		return s.httpServer.ListenAndServeTLS(s.config.TLSCertPath, s.config.TLSKeyPath)
	}

	slog.Info("server.start.http", "addr", s.httpServer.Addr)
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully shuts down the HTTP server.
func (s *Server) Shutdown(ctx context.Context) error {
	// Shutdown HTTP server
	if s.httpServer != nil {
		if err := s.httpServer.Shutdown(ctx); err != nil {
			return fmt.Errorf("failed to shutdown http server: %w", err)
		}
	}

	// Close Qdrant client
	if s.qdrant != nil {
		if err := s.qdrant.Close(); err != nil {
			return fmt.Errorf("failed to close qdrant client: %w", err)
		}
	}

	// Close S3 client (if initialized)
	if s.s3 != nil {
		if err := s.s3.Close(); err != nil {
			return fmt.Errorf("failed to close s3 client: %w", err)
		}
	}

	return nil
}

// createGettyClient creates a Getty client with the appropriate auth provider based on config.
func createGettyClient(cfg *config.Config) (*getty.Client, error) {
	switch cfg.GettyAuthType {
	case "sso-jwt":
		auth, err := getty.NewSSOJWTAuth(cfg.GettySSOHost, cfg.GettyCertPath, cfg.GettyKeyPath, cfg.GettyXAppKey)
		if err != nil {
			return nil, fmt.Errorf("SSO JWT auth setup: %w", err)
		}
		return getty.NewWithAuth(cfg, auth), nil
	default:
		return getty.New(cfg)
	}
}

// setupRoutes configures all HTTP routes.
func (s *Server) setupRoutes() {
	api := s.router.PathPrefix("/api/v1").Subrouter()

	// Public routes (no auth required)
	api.HandleFunc("/health", s.handleHealth).Methods(http.MethodGet)
	api.HandleFunc("/stats", s.handleStats).Methods(http.MethodGet)

	// Protected routes (auth required)
	protected := api.PathPrefix("").Subrouter()
	protected.Use(s.authMiddleware.Authenticate)
	protected.HandleFunc("/search", s.handleSearch).Methods(http.MethodPost)
	protected.HandleFunc("/images/{gettyId}", s.handleGetImage).Methods(http.MethodGet)
	protected.HandleFunc("/images/batch", s.handleBatchLookup).Methods(http.MethodPost)
}

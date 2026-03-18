package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	goauth "github.com/gdcorp-partners/airo-app-builder/packages/go-auth"
	"github.com/gorilla/mux"

	"github.com/airo-ai-builder/knowledge-service/internal/config"
	"github.com/airo-ai-builder/knowledge-service/internal/embeddings"
	"github.com/airo-ai-builder/knowledge-service/internal/ingest"
	"github.com/airo-ai-builder/knowledge-service/internal/llm"
	"github.com/airo-ai-builder/knowledge-service/internal/ratelimit"
	"github.com/airo-ai-builder/knowledge-service/internal/search"
	qdrantStorage "github.com/airo-ai-builder/knowledge-service/internal/storage/qdrant"
)

// Server is the main HTTP server for the knowledge service.
type Server struct {
	config         *config.Config
	router         *mux.Router
	httpServer     *http.Server
	qdrant         *qdrantStorage.Client
	embeddings     *embeddings.Client
	llmClient      *llm.Client
	searcher       *search.Searcher
	pipeline       *ingest.Pipeline
	authMiddleware *goauth.Middleware
	rateLimiter    *ratelimit.Limiter
}

// NewServer creates a new Server with the given configuration.
func NewServer(cfg *config.Config) *Server {
	return &Server{
		config: cfg,
	}
}

// Initialize sets up all dependencies: Qdrant, embeddings, LLM, auth, routes.
func (s *Server) Initialize(ctx context.Context) error {
	slog.Info("server.init.begin")

	// Qdrant client
	qdrantClient, err := qdrantStorage.New(s.config)
	if err != nil {
		return fmt.Errorf("failed to create qdrant client: %w", err)
	}
	s.qdrant = qdrantClient

	// Ensure collection exists
	if err := s.qdrant.EnsureCollection(ctx); err != nil {
		return fmt.Errorf("failed to ensure collection: %w", err)
	}

	// Embeddings client
	s.embeddings = embeddings.New(s.config)

	// LLM client
	s.llmClient = llm.New(s.config)

	// Search orchestrator
	s.searcher = search.New(s.config, s.embeddings, s.qdrant)

	// Ingestion pipeline
	s.pipeline = ingest.NewPipeline(s.config, s.embeddings, s.llmClient, s.qdrant)

	// Auth middleware
	s.authMiddleware = goauth.NewMiddleware(s.config.AuthType, s.config.SSOHost)

	// Rate limiter
	if s.config.RateLimitEnabled {
		s.rateLimiter = ratelimit.New(s.config.RateLimitRPS, s.config.RateLimitRPS)
	}

	// Routes
	s.setupRoutes()

	slog.Info("server.init.complete")
	return nil
}

// Start begins serving HTTP requests.
func (s *Server) Start() error {
	addr := ":" + strconv.Itoa(s.config.Port)
	s.httpServer = &http.Server{
		Addr:         addr,
		Handler:      s.router,
		ReadTimeout:  time.Duration(s.config.HTTPReadTimeout) * time.Second,
		WriteTimeout: time.Duration(s.config.HTTPWriteTimeout) * time.Second,
		IdleTimeout:  time.Duration(s.config.HTTPIdleTimeout) * time.Second,
	}

	slog.Info("server.start", "addr", addr)
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully stops the server and closes connections.
func (s *Server) Shutdown(ctx context.Context) error {
	slog.Info("server.shutdown.begin")

	if s.httpServer != nil {
		if err := s.httpServer.Shutdown(ctx); err != nil {
			slog.Error("server.shutdown.http.failed", "error", err)
		}
	}

	if s.qdrant != nil {
		if err := s.qdrant.Close(); err != nil {
			slog.Error("server.shutdown.qdrant.failed", "error", err)
		}
	}

	slog.Info("server.shutdown.complete")
	return nil
}

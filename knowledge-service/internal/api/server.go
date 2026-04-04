package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	goauth "github.com/gdcorp-partners/airo-app-builder/packages/go-auth"
	"github.com/gorilla/mux"

	"github.com/airo-ai-builder/knowledge-service/internal/config"
	"github.com/airo-ai-builder/knowledge-service/internal/embeddings"
	"github.com/airo-ai-builder/knowledge-service/internal/gocode"
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
	gocodeClient   *gocode.Client
	gocodeHTTP     *http.Client // cached S2S HTTP client, nil when gocode is not configured
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

	// GoCode S2S client (optional — only initialized when env vars are set).
	// Must be initialized before embeddings/LLM so they can use S2S auth.
	if s.config.GoCodeRoleARN != "" && s.config.GoCodeBaseURL != "" {
		if s.config.SSOHost == "" {
			return errors.New("SSO_HOST must be set when GoCode S2S is configured (GOCODE_ROLE_ARN and GOCODE_BASE_URL are set)")
		}
		gocodeClient, err := gocode.New(ctx, s.config.GoCodeRoleARN, s.config.SSOHost, s.config.GoCodeBaseURL)
		if err != nil {
			return fmt.Errorf("failed to create gocode client: %w", err)
		}
		s.gocodeClient = gocodeClient
		s.gocodeHTTP = gocodeClient.HTTPClient()
		slog.Info("server.init.gocode.s2s.enabled", "roleARN", s.config.GoCodeRoleARN)
		// When S2S is active, always route AI calls through GoCode.
		// Ensure the base URL ends with /v1 as required by the OpenAI-compatible SDK.
		base := strings.TrimRight(s.config.GoCodeBaseURL, "/")
		if !strings.HasSuffix(base, "/v1") {
			base += "/v1"
		}
		s.config.OpenAIBaseURL = base
	}

	// Embeddings client — uses S2S auth when gocode is configured, API key otherwise
	s.embeddings = embeddings.New(s.config, s.gocodeHTTP)

	// LLM client — uses S2S auth when gocode is configured, API key otherwise
	s.llmClient = llm.New(s.config, s.gocodeHTTP)

	// Query rewriter — uses its own LLM model (fast/cheap) separate from enrichment
	var rewriter *search.QueryRewriter
	if s.config.SearchLLMEnhanced {
		rewriterLLM := llm.NewWithModel(s.config, s.gocodeHTTP, s.config.SearchQueryRewriteModel)
		rewriter = search.NewQueryRewriter(
			rewriterLLM,
			s.config.SearchQueryRewriteTimeoutMs,
			s.config.SearchQueryRewriteMaxTokens,
		)
	}

	// Search orchestrator
	s.searcher = search.New(s.config, s.embeddings, s.qdrant, rewriter)

	// Ingestion pipeline
	s.pipeline = ingest.NewPipeline(s.config, s.embeddings, s.llmClient, s.qdrant)

	// Warn once if the embedding pipeline configuration has changed since the
	// last run so operators know to re-ingest before the index becomes stale.
	ingest.CheckVersion(s.config)

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

	hasCert := s.config.TLSCertPath != ""
	hasKey := s.config.TLSKeyPath != ""
	if hasCert != hasKey {
		return fmt.Errorf("SERVER_CERT_PATH and SERVER_KEY_PATH must both be set to enable TLS (got cert=%v key=%v)", hasCert, hasKey)
	}
	if hasCert {
		slog.Info("server.start.tls", "addr", addr, "certPath", s.config.TLSCertPath)
		return s.httpServer.ListenAndServeTLS(s.config.TLSCertPath, s.config.TLSKeyPath)
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

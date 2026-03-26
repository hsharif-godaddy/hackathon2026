// internal/api/server.go
package api

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/rs/cors"

	"github.com/airo-ai-builder/budget-service/internal/auth"
	"github.com/airo-ai-builder/budget-service/internal/budget"
	"github.com/airo-ai-builder/budget-service/internal/config"
	"github.com/airo-ai-builder/budget-service/internal/logging"
	"github.com/airo-ai-builder/budget-service/internal/spend"
)

// Server is the HTTP server for the budget service API.
type Server struct {
	config         *config.Config
	router         *mux.Router
	httpServer     *http.Server
	version        string
	startTime      time.Time
	db             *sql.DB
	budgetRepo     *budget.PostgresRepository
	spendEngine    *spend.Engine
	auditLog       *logging.AuditLogger
	authMiddleware *auth.Middleware
}

// NewServer creates a fully initialized server ready to start.
func NewServer(cfg *config.Config, version string, db *sql.DB, auditLog *logging.AuditLogger) *Server {
	repo := budget.NewRepository(db)

	authMiddleware, err := auth.NewMiddleware(cfg)
	if err != nil {
		slog.Error("auth.middleware.init.failed", "error", err)
		panic(fmt.Sprintf("failed to initialize auth middleware: %v", err))
	}

	s := &Server{
		config:         cfg,
		router:         mux.NewRouter(),
		version:        version,
		startTime:      time.Now(),
		db:             db,
		auditLog:       auditLog,
		budgetRepo:     repo,
		authMiddleware: authMiddleware,
		spendEngine: spend.NewEngine(
			repo,
			cfg.AlertWarningThreshold,
			cfg.AlertCriticalThreshold,
		),
	}

	s.setupRoutes()
	return s
}

func (s *Server) setupRoutes() {
	api := s.router.PathPrefix("/api/v1").Subrouter()

	// Health check (no auth)
	api.HandleFunc("/health", s.handleHealth).Methods(http.MethodGet)

	// Subscription endpoints - require matching subscriptionId
	sub := api.PathPrefix("/subscriptions/{subscriptionId}").Subrouter()
	sub.Use(s.authMiddleware.ExtractAuth)
	sub.Use(s.authMiddleware.RequireSubscription)
	sub.HandleFunc("/budgets", s.handleGetBudgets).Methods(http.MethodGet)
	sub.HandleFunc("/spend", s.handleSpend).Methods(http.MethodPost)
	sub.HandleFunc("/release", s.handleRelease).Methods(http.MethodPost)

	// Admin endpoints - require admin allowlist
	admin := api.PathPrefix("/budgets").Subrouter()
	admin.Use(s.authMiddleware.ExtractAuth)
	admin.Use(s.authMiddleware.RequireAdmin)
	admin.HandleFunc("", s.handleCreateBudget).Methods(http.MethodPost)
	admin.HandleFunc("/{budgetId}", s.handleUpdateBudget).Methods(http.MethodPut)
	admin.HandleFunc("/{budgetId}", s.handleDeleteBudget).Methods(http.MethodDelete)
}

func (s *Server) Start() error {
	// Apply middleware: logging -> CORS -> router
	handler := LoggingMiddleware(cors.Default().Handler(s.router))

	s.httpServer = &http.Server{
		Addr:         fmt.Sprintf(":%d", s.config.Port),
		Handler:      handler,
		ReadTimeout:  s.config.HTTPReadTimeout,
		WriteTimeout: s.config.HTTPWriteTimeout,
		IdleTimeout:  s.config.HTTPIdleTimeout,
	}

	if s.config.TLSCertPath != "" && s.config.TLSKeyPath != "" {
		slog.Info("server.starting.tls", "port", s.config.Port, "certPath", s.config.TLSCertPath)
		return s.httpServer.ListenAndServeTLS(s.config.TLSCertPath, s.config.TLSKeyPath)
	}

	slog.Info("server.starting", "port", s.config.Port)
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	slog.Info("server.shutdown.start")

	if s.httpServer != nil {
		if err := s.httpServer.Shutdown(ctx); err != nil {
			return fmt.Errorf("failed to shutdown http server: %w", err)
		}
	}

	if s.auditLog != nil {
		if err := s.auditLog.Close(); err != nil {
			return fmt.Errorf("failed to close audit log: %w", err)
		}
	}

	slog.Info("server.shutdown.complete")
	return nil
}

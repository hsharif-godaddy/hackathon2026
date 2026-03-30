// cmd/server/main.go
package main

import (
	"context"
	"database/sql"
	"log/slog"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"

	"github.com/airo-ai-builder/budget-service/internal/api"
	"github.com/airo-ai-builder/budget-service/internal/config"
	"github.com/airo-ai-builder/budget-service/internal/logging"
)

const version = "0.1.0"

func main() {
	logLevel := slog.LevelInfo
	if os.Getenv("LOG_LEVEL") == "debug" {
		logLevel = slog.LevelDebug
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: logLevel,
	}))
	slog.SetDefault(logger)

	slog.Info("service.starting", "version", version)

	// Load configuration
	cfg := config.LoadConfig()

	// Parse database hostname for logging
	dbHost := "unknown"
	if dbURL, err := url.Parse(cfg.DatabaseURL); err == nil && dbURL.Host != "" {
		dbHost = dbURL.Hostname()
	}

	// Connect to database
	connectStart := time.Now()
	db, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		slog.Error("database.connect.failed", "error", err, "host", dbHost)
		os.Exit(1)
	}
	defer db.Close()

	// Configure connection pool for high-volume workload (>1000 req/sec target)
	// MaxOpenConns: allows parallel queries while limiting DB resource usage
	// MaxIdleConns: keeps warm connections for quick response times
	// ConnMaxLifetime: prevents stale connections and balances load across replicas
	db.SetMaxOpenConns(cfg.DBMaxOpenConns)
	db.SetMaxIdleConns(cfg.DBMaxIdleConns)
	db.SetConnMaxLifetime(cfg.DBConnMaxLifetime)

	// Best-effort ping so the process can bind and /api/v1/health can report DB status.
	ctx := context.Background()
	if err := db.PingContext(ctx); err != nil {
		slog.Warn("database.ping.initial.failed", "error", err, "host", dbHost)
	} else {
		slog.Info("database.connected", "host", dbHost, "connectTime", time.Since(connectStart).String())
	}

	// Initialize audit logger
	auditLog, err := logging.NewAuditLogger(cfg.AuditLogPath, cfg.AuditLogSync)
	if err != nil {
		slog.Error("audit.logger.init.failed", "error", err)
		os.Exit(1)
	}

	// Create server
	server := api.NewServer(cfg, version, db, auditLog)

	// Start server in goroutine
	errChan := make(chan error, 1)
	go func() {
		if err := server.Start(); err != nil {
			errChan <- err
		}
	}()

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errChan:
		slog.Error("server.start.failed", "error", err)
		os.Exit(1)
	case sig := <-sigChan:
		slog.Info("shutdown.signal.received", "signal", sig.String())
	}

	// Graceful shutdown
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("server.shutdown.failed", "error", err)
		os.Exit(1)
	}

	slog.Info("service.stopped")
}

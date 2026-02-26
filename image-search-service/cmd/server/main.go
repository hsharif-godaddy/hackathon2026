// cmd/server/main.go
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/airo-ai-builder/image-search-service/internal/api"
	"github.com/airo-ai-builder/image-search-service/internal/config"
)

const version = "0.1.0"

func main() {
	// Load .env file if present (ignore error if not found)
	_ = godotenv.Load()

	// Setup structured logging
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

	// Log config for debugging (secrets redacted)
	slog.Info("service.config",
		"qdrantHost", cfg.QdrantHost,
		"qdrantPort", cfg.QdrantPort,
		"qdrantCollection", cfg.QdrantCollection,
		"qdrantUseTLS", cfg.QdrantUseTLS,
		"qdrantTLSSkipVerify", cfg.QdrantTLSSkipVerify,
		"qdrantAPIKeySet", cfg.QdrantAPIKey != "",
		"tlsCertPath", cfg.TLSCertPath,
		"tlsKeyPath", cfg.TLSKeyPath,
		"port", cfg.Port,
		"logLevel", cfg.LogLevel,
		"gettyUpstream", cfg.GettyUpstream,
		"s3Bucket", cfg.S3Bucket,
		"authType", cfg.AuthType,
	)

	// Create server
	server := api.NewServer(cfg, version)

	// Initialize clients
	ctx := context.Background()
	if err := server.Initialize(ctx); err != nil {
		slog.Error("service.init.failed", "error", err)
		os.Exit(1)
	}

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
		slog.Error("service.start.failed", "error", err)
		os.Exit(1)
	case sig := <-sigChan:
		slog.Info("service.shutdown.signal", "signal", sig.String())
	}

	// Graceful shutdown
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)

	if err := server.Shutdown(shutdownCtx); err != nil {
		cancel()
		slog.Error("service.shutdown.failed", "error", err)
		os.Exit(1)
	}
	cancel()

	slog.Info("service.shutdown.complete")
}

package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/airo-ai-builder/knowledge-service/internal/api"
	"github.com/airo-ai-builder/knowledge-service/internal/config"
)

func main() {
	// Load .env if present (no-op if missing)
	_ = godotenv.Load()

	cfg, err := config.LoadConfig()
	if err != nil {
		slog.Error("knowledge-service.config.failed", "error", err)
		os.Exit(1)
	}

	setupLogger(cfg.LogLevel)

	slog.Info("knowledge-service.start", "version", cfg.Version, "port", cfg.Port)

	srv := api.NewServer(cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)

	if err := srv.Initialize(ctx); err != nil {
		cancel()
		slog.Error("knowledge-service.init.failed", "error", err)
		os.Exit(1)
	}
	cancel()

	// Handle graceful shutdown on SIGINT/SIGTERM
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	errCh := make(chan error, 1)
	go func() {
		if err := srv.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case sig := <-quit:
		slog.Info("knowledge-service.shutdown.signal", "signal", sig.String())
	case err := <-errCh:
		slog.Error("knowledge-service.serve.failed", "error", err)
		os.Exit(1)
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)

	if err := srv.Shutdown(shutdownCtx); err != nil {
		shutdownCancel()
		slog.Error("knowledge-service.shutdown.failed", "error", err)
		os.Exit(1)
	}
	shutdownCancel()

	slog.Info("knowledge-service.stopped")
}

func setupLogger(level string) {
	var logLevel slog.Level
	switch level {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	default:
		logLevel = slog.LevelInfo
	}

	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel})
	slog.SetDefault(slog.New(handler))
}

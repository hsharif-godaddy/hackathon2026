// Command server is the stripe-service HTTP entrypoint. Walking skeleton: only
// /health is implemented. Real routes, auth middleware, and AWS SDK wiring land
// in follow-up PRs.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/api"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/config"
)

// version is set via -ldflags at build time. Defaults to "dev" for local builds.
var version = "dev"

func main() {
	setupLogger(bootstrapLogLevel(), bootstrapLogFormat())

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config.load", "error", err)
		os.Exit(1)
	}
	setupLogger(cfg.LogLevel, cfg.LogFormat)

	srv := &api.Server{
		Environment: string(cfg.Environment),
		Version:     version,
	}
	handler := api.NewRouter(srv)

	httpSrv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      handler,
		ReadTimeout:  cfg.HTTPReadTimeout,
		WriteTimeout: cfg.HTTPWriteTimeout,
		IdleTimeout:  cfg.HTTPIdleTimeout,
	}

	slog.Info("stripe_service.start",
		"addr", cfg.Addr,
		"environment", cfg.Environment,
		"version", version,
	)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	errCh := make(chan error, 1)
	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case sig := <-quit:
		slog.Info("stripe_service.shutdown.signal", "signal", sig.String())
	case err := <-errCh:
		slog.Error("http.server", "error", err)
		os.Exit(1)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		slog.Error("stripe_service.shutdown.failed", "error", err)
		os.Exit(1)
	}
	slog.Info("stripe_service.stopped")
}

func bootstrapLogLevel() string {
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		return v
	}
	return "info"
}

func bootstrapLogFormat() string {
	if v := os.Getenv("LOG_FORMAT"); v != "" {
		return v
	}
	return "json"
}

func setupLogger(level, format string) {
	opts := &slog.HandlerOptions{Level: config.SlogLevel(level)}
	var handler slog.Handler
	if format == "text" {
		handler = slog.NewTextHandler(os.Stdout, opts)
	} else {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	}
	slog.SetDefault(slog.New(handler))
}

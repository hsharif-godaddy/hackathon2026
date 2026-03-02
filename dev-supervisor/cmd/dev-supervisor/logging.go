package main

import (
	"context"
	"log/slog"
	"os"

	"golang.org/x/term"

	"github.com/airo-ai-builder/dev-supervisor/internal/allocconfig"
	"github.com/airo-ai-builder/dev-supervisor/internal/config"
)

var logger *slog.Logger

// productIDHandler wraps a handler and injects product_id dynamically on each log call.
// This ensures the product_id is picked up even if the config file is populated after startup.
type productIDHandler struct {
	inner  slog.Handler
	siteID string
}

func (h *productIDHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h *productIDHandler) Handle(ctx context.Context, r slog.Record) error {
	// Add app_id (static) and product_id (dynamic) to every log record.
	// allocconfig.Default() has built-in 5s TTL caching and singleflight.
	r.AddAttrs(
		slog.String("app_id", h.siteID),
		slog.String("product_id", allocconfig.GetProductIDOrDefault("notfound")),
	)
	return h.inner.Handle(ctx, r)
}

func (h *productIDHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &productIDHandler{inner: h.inner.WithAttrs(attrs), siteID: h.siteID}
}

func (h *productIDHandler) WithGroup(name string) slog.Handler {
	return &productIDHandler{inner: h.inner.WithGroup(name), siteID: h.siteID}
}

// newLoggerWithHandler creates a new logger with the given handler
// and includes app_id from SITE_ID environment variable as a default field.
// product_id is injected dynamically via productIDHandler to handle late config loading.
func newLoggerWithHandler(handler slog.Handler) *slog.Logger {
	siteID := os.Getenv("SITE_ID")
	return slog.New(&productIDHandler{inner: handler, siteID: siteID})
}

// getLogLevel returns the configured log level from environment variable
// Defaults to Info if not set or invalid
func getLogLevel() slog.Level {
	levelStr := config.GetEnvStringWithDefault("DEV_SUPERVISOR_LOG_LEVEL", "INFO")

	switch levelStr {
	case "debug", "DEBUG":
		return slog.LevelDebug
	case "info", "INFO":
		return slog.LevelInfo
	case "warn", "WARN", "warning", "WARNING":
		return slog.LevelWarn
	case "error", "ERROR":
		return slog.LevelError
	default:
		slog.Warn("invalid DEV_SUPERVISOR_LOG_LEVEL value, defaulting to info", "value", levelStr)
		return slog.LevelInfo
	}
}

// initLogging sets up structured logging with slog
// Uses JSON format when no terminal is detected, text format otherwise
// Log level can be configured via DEV_SUPERVISOR_LOG_LEVEL environment variable (debug, info, warn, error)
func initLogging() {
	var handler slog.Handler
	level := getLogLevel()

	// Check if stdout is connected to a terminal
	if isTerminal(os.Stdout) {
		// Use text format for terminal output
		handler = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
			Level: level,
		})
	} else {
		// Use JSON format for non-terminal output (Docker, pipes, etc.)
		handler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
			Level: level,
		})
	}

	logger = newLoggerWithHandler(handler)
	slog.SetDefault(logger)
}

// isTerminal checks if the given file is connected to a terminal
func isTerminal(f *os.File) bool {
	return term.IsTerminal(int(f.Fd()))
}

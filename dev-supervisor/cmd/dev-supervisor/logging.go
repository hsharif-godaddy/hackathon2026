package main

import (
	"log/slog"
	"os"

	"golang.org/x/term"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
)

var logger *slog.Logger

// newLoggerWithHandler creates a new logger with the given handler
// and includes app_id from SITE_ID environment variable as a default field,
// plus container metadata using ECS standard fields for production traceability
func newLoggerWithHandler(handler slog.Handler) *slog.Logger {
	siteID := os.Getenv("SITE_ID")
	l := slog.New(handler).With("app_id", siteID)

	// Add container metadata using ECS standard fields for production traceability
	// Using container.image.tag and service.version for compatibility with Elastic tooling
	if imageTag := os.Getenv("PREVIEW_APP_IMAGE_TAG"); imageTag != "" {
		l = l.With(
			"container.image.tag", imageTag,
			"service.version", imageTag,
			"service.name", "airo-preview",
		)
	} else if imageTag := os.Getenv("PUBLISH_APP_IMAGE_TAG"); imageTag != "" {
		l = l.With(
			"container.image.tag", imageTag,
			"service.version", imageTag,
			"service.name", "airo-publish",
		)
	}

	return l
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

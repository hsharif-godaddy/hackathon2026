package main

import (
	"log/slog"
	"os"

	"golang.org/x/term"
)

var logger *slog.Logger

// newLoggerWithHandler creates a new logger with the given handler
// and includes appId from SITE_ID environment variable as a default field
func newLoggerWithHandler(handler slog.Handler) *slog.Logger {
	siteId := os.Getenv("SITE_ID")
	return slog.New(handler).With("appId", siteId)
}

// initLogging sets up structured logging with slog
// Uses JSON format when no terminal is detected, text format otherwise
func initLogging() {
	var handler slog.Handler

	// Check if stdout is connected to a terminal
	if isTerminal(os.Stdout) {
		// Use text format for terminal output
		handler = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
			Level: slog.LevelInfo,
		})
	} else {
		// Use JSON format for non-terminal output (Docker, pipes, etc.)
		handler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
			Level: slog.LevelInfo,
		})
	}

	logger = newLoggerWithHandler(handler)
	slog.SetDefault(logger)
}

// isTerminal checks if the given file is connected to a terminal
func isTerminal(f *os.File) bool {
	return term.IsTerminal(int(f.Fd()))
}

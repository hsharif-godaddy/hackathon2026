package httpproxy

import (
	"errors"
	"log/slog"
	"net/http"
	"time"
)

// handleAutoStart handles requests when the app is stopped.
// Holds the request open, starts the process, and forwards when ready.
func (rr *RequestRouter) handleAutoStart(w http.ResponseWriter, r *http.Request) {
	slog.Info("autostart.triggered",
		"path", r.URL.Path,
		"method", r.Method,
		"remote_addr", r.RemoteAddr)

	// Get current process start request.
	startReq := rr.procMgr.GetStartRequest()
	if startReq == nil {
		slog.Error("autostart.no_config")
		http.Error(w, "Service configuration error", http.StatusInternalServerError)
		return
	}

	// Start the process.
	startTime := time.Now()
	err := rr.procMgr.Start(*startReq)
	// Accept benign race conditions (already starting, already running).
	if err != nil {
		if !errors.Is(err, ErrAlreadyStarting) && !errors.Is(err, ErrAlreadyRunning) {
			slog.Error("autostart.failed", "error", err)
			http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
		// Log the benign race for observability.
		slog.Info("autostart.concurrent_race", "error", err.Error())
	}

	// Wait for process to be ready (hold the request).
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.After(60 * time.Second)

	for {
		select {
		case <-r.Context().Done():
			// Client disconnected or canceled the request.
			slog.Info("autostart.client_canceled",
				"path", r.URL.Path,
				"method", r.Method,
				"reason", r.Context().Err())
			return

		case <-timeout:
			slog.Error("autostart.timeout",
				"path", r.URL.Path,
				"method", r.Method)
			http.Error(w, "Service startup timeout", http.StatusGatewayTimeout)
			return

		case <-ticker.C:
			status := rr.procMgr.GetStatus()

			switch status.State {
			case ProcessStateStopped, ProcessStateStopping:
				// Keep waiting - these states shouldn't happen during startup
				// but handle them gracefully.
				slog.Debug("autostart.unexpected_state",
					"state", status.State,
					"path", r.URL.Path)

			case ProcessStateRunning:
				duration := time.Since(startTime)
				slog.Info("autostart.process_ready",
					"pid", status.PID,
					"startup_duration_ms", duration.Milliseconds(),
					"path", r.URL.Path,
					"method", r.Method)

				// Update activity before forwarding.
				rr.procMgr.UpdateActivity()

				// Forward the original request to backend.
				rr.proxyHandler.ServeHTTP(w, r)
				return

			case ProcessStateError:
				slog.Error("autostart.process_failed",
					"error", status.Error,
					"state", status.State,
					"path", r.URL.Path)
				http.Error(w, "Service startup failed", http.StatusBadGateway)
				return

			case ProcessStateStarting:
				// Keep waiting.
				slog.Debug("autostart.waiting",
					"pid", status.PID,
					"state", status.State)
			}
		}
	}
}

package httpproxy

import (
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"
)

const (
	// TCP readiness probe configuration.
	// After the process reports "running", we probe the backend port to confirm
	// it's actually accepting connections before forwarding queued requests.
	tcpProbeInterval = 100 * time.Millisecond
	tcpProbeTimeout  = 500 * time.Millisecond
	tcpProbeDeadline = 30 * time.Second
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
	// Use broadcast pattern: wait on state change channel instead of polling.
	timeout := time.After(60 * time.Second)

	for {
		// Get current state change channel before checking status
		// to avoid missing notifications between status check and wait.
		stateChangeCh := rr.procMgr.GetStateChangeChan()
		status := rr.procMgr.GetStatus()

		switch status.State {
		case ProcessStateStopped:
			// Startup failed - process stopped after we called Start().
			// This is a genuine failure, not a transient restart state.
			slog.Error("autostart.startup_failed",
				"state", status.State,
				"path", r.URL.Path,
				"method", r.Method)
			http.Error(w, "Service startup failed", http.StatusBadGateway)
			return

		case ProcessStateRunning:
			// Process is alive, but the server inside may not be listening yet.
			// Probe the backend port before forwarding to avoid "connection refused" bursts.
			if rr.backendAddr != "" {
				if !rr.waitForBackendReady(w, r, startTime) {
					return // waitForBackendReady already wrote the HTTP response
				}
			}

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

		case ProcessStateStarting, ProcessStateStopping:
			// Wait for state change notification.
			// ProcessStateStopping is included here because it can be a transient state
			// during a restart sequence (old process stopping before new process starts).
			// Treating it as waitable prevents flaky 502s during restarts.
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

			case <-stateChangeCh:
				// State changed, loop back to check new state.
				slog.Debug("autostart.state_changed", "path", r.URL.Path)
				continue
			}
		}
	}
}

// waitForBackendReady probes the backend port until it accepts TCP connections.
// Returns true when ready, false if the probe failed (HTTP response already written).
func (rr *RequestRouter) waitForBackendReady(w http.ResponseWriter, r *http.Request, startTime time.Time) bool {
	deadline := time.After(tcpProbeDeadline)
	dialer := &net.Dialer{Timeout: tcpProbeTimeout}
	ticker := time.NewTicker(tcpProbeInterval)
	defer ticker.Stop()

	for {
		conn, err := dialer.DialContext(r.Context(), "tcp", rr.backendAddr)
		if err == nil {
			_ = conn.Close()
			return true
		}

		// Check if process died while we were probing.
		status := rr.procMgr.GetStatus()
		if status.State != ProcessStateRunning {
			slog.Error("autostart.process_died_during_probe",
				"state", status.State,
				"backend_addr", rr.backendAddr,
				"path", r.URL.Path)
			http.Error(w, "Service startup failed", http.StatusBadGateway)
			return false
		}

		select {
		case <-r.Context().Done():
			slog.Info("autostart.client_canceled_during_probe",
				"path", r.URL.Path,
				"method", r.Method,
				"reason", r.Context().Err())
			return false

		case <-deadline:
			duration := time.Since(startTime)
			slog.Error("autostart.backend_not_ready",
				"backend_addr", rr.backendAddr,
				"probe_deadline", tcpProbeDeadline,
				"total_duration_ms", duration.Milliseconds(),
				"path", r.URL.Path)
			http.Error(w, "Service startup timeout", http.StatusGatewayTimeout)
			return false

		case <-ticker.C:
			// Retry probe.
			slog.Debug("autostart.tcp_probe_retry",
				"backend_addr", rr.backendAddr)
		}
	}
}

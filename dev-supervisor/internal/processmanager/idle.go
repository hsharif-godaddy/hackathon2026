package processmanager

import (
	"context"
	"log/slog"
	"net"
	"time"
)

// EnableStartOnRequest enables start-on-request functionality with idle monitoring.
// Parameters must satisfy: idleTimeout > 0, checkInterval > 0, checkInterval < idleTimeout.
func (pm *ProcessManager) EnableStartOnRequest(idleTimeout, checkInterval time.Duration) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Validate parameters.
	if idleTimeout <= 0 {
		slog.Error("start_on_request.invalid_idle_timeout",
			"idle_timeout", idleTimeout,
			"message", "idle timeout must be positive")
		return
	}
	if checkInterval <= 0 {
		slog.Error("start_on_request.invalid_check_interval",
			"check_interval", checkInterval,
			"message", "check interval must be positive")
		return
	}
	if checkInterval >= idleTimeout {
		slog.Warn("start_on_request.check_interval_too_large",
			"check_interval", checkInterval,
			"idle_timeout", idleTimeout,
			"message", "check interval should be less than idle timeout for efficient detection")
		// Continue anyway - not a fatal error.
	}

	// Cancel existing monitor if running (defensive - shouldn't happen in practice).
	if pm.idleMonitorCancel != nil {
		slog.Warn("start_on_request.already_enabled", "message", "canceling existing monitor")
		pm.idleMonitorCancel()
		pm.idleMonitorCancel = nil
	}

	pm.startOnRequestEnabled = true
	pm.idleTimeout = idleTimeout
	pm.idleCheckInterval = checkInterval
	pm.UpdateActivity() // Initialize to now.

	ctx, cancel := context.WithCancel(context.Background())
	pm.idleMonitorCancel = cancel

	slog.Info("start_on_request.enabled",
		"idle_timeout", idleTimeout,
		"check_interval", checkInterval)

	go pm.idleMonitorLoop(ctx, checkInterval)
}

// UpdateActivity updates the last activity timestamp.
func (pm *ProcessManager) UpdateActivity() {
	pm.lastActivityTime.Store(time.Now())
}

// TrackRequest increments the in-flight request counter.
// Checks idleStopping flag to prevent accepting new requests during shutdown.
func (pm *ProcessManager) TrackRequest() {
	// Check if idle stop is in progress (without holding pm.mu for performance)
	if pm.idleStopping.Load() {
		// Process is stopping, reject new requests to prevent 502 errors
		return
	}
	pm.inFlightRequests.Add(1)
}

// UntrackRequest decrements the in-flight request counter and updates activity.
func (pm *ProcessManager) UntrackRequest() {
	pm.inFlightRequests.Add(-1)
	pm.UpdateActivity()
}

// RegisterWebSocket registers an active WebSocket connection.
func (pm *ProcessManager) RegisterWebSocket(conn net.Conn) {
	pm.activeWebSockets.Store(conn, true)
	slog.Debug("websocket.registered", "remote_addr", conn.RemoteAddr())
}

// UnregisterWebSocket unregisters a WebSocket connection when it closes.
func (pm *ProcessManager) UnregisterWebSocket(conn net.Conn) {
	pm.activeWebSockets.Delete(conn)
	slog.Debug("websocket.unregistered", "remote_addr", conn.RemoteAddr())
}

// IsIdleMonitorRunning returns true if the idle monitor is currently running.
func (pm *ProcessManager) IsIdleMonitorRunning() bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.idleMonitorCancel != nil
}

// GetIdleTimeout returns the configured idle timeout duration.
func (pm *ProcessManager) GetIdleTimeout() time.Duration {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.idleTimeout
}

// GetIdleCheckInterval returns the configured idle check interval duration.
func (pm *ProcessManager) GetIdleCheckInterval() time.Duration {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.idleCheckInterval
}

// IsStartOnRequestEnabled returns true if start-on-request is enabled.
func (pm *ProcessManager) IsStartOnRequestEnabled() bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.startOnRequestEnabled
}

// WasHealthyBeforeIdle returns true if the process was healthy before being idled.
// This is used by health checks to report "healthy" for idled apps instead of "unhealthy".
func (pm *ProcessManager) WasHealthyBeforeIdle() bool {
	return pm.wasHealthyBeforeIdle.Load()
}

// StopIdleMonitor stops the idle monitoring goroutine.
func (pm *ProcessManager) StopIdleMonitor() {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if pm.idleMonitorCancel != nil {
		pm.idleMonitorCancel()
		pm.idleMonitorCancel = nil
		slog.Info("idle_monitor.stopped")
	}
}

// idleMonitorLoop periodically checks for idle timeout and stops the process.
func (pm *ProcessManager) idleMonitorLoop(ctx context.Context, checkInterval time.Duration) {
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pm.checkIdleAndStop()
		}
	}
}

// checkIdleAndStop checks if the process has been idle too long and stops it.
// This function is called periodically by the idle monitor goroutine.
func (pm *ProcessManager) checkIdleAndStop() {
	status := pm.GetStatus()
	if status.State != ProcessStateRunning {
		return // Already stopped.
	}

	// Check WebSocket connections and idle time atomically to prevent race conditions.
	pm.mu.Lock()

	// Check if any WebSocket connections are active.
	hasActiveWS := false
	pm.activeWebSockets.Range(func(_, _ any) bool {
		hasActiveWS = true
		return false // stop iteration
	})

	// Check if any HTTP requests are in-flight.
	inFlight := pm.inFlightRequests.Load()

	if hasActiveWS || inFlight > 0 {
		pm.mu.Unlock()
		slog.Debug("idle.check.has_active_connections",
			"websockets", hasActiveWS,
			"in_flight_requests", inFlight)
		return // Don't stop if WebSockets or requests are active.
	}

	// Check idle duration while still holding the lock.
	lastActivity, ok := pm.lastActivityTime.Load().(time.Time)
	if !ok {
		pm.mu.Unlock()
		slog.Error("idle.check.type_assertion_failed")
		return
	}
	idleDuration := time.Since(lastActivity)

	if idleDuration <= pm.idleTimeout {
		pm.mu.Unlock()
		return // Not idle long enough.
	}

	// Mark stopping BEFORE final check to catch late arrivals
	pm.idleStopping.Store(true)

	// Re-check after setting flag to catch requests that arrived during check
	hasActiveWS = false
	pm.activeWebSockets.Range(func(_, _ any) bool {
		hasActiveWS = true
		return false
	})
	finalInFlight := pm.inFlightRequests.Load()

	if hasActiveWS || finalInFlight > 0 {
		pm.idleStopping.Store(false) // Abort, clear flag
		pm.mu.Unlock()
		slog.Debug("idle.check.late_arrival_detected",
			"websockets", hasActiveWS,
			"in_flight_requests", finalInFlight)
		return // New activity arrived, abort shutdown.
	}

	// Process is idle and no active connections - proceed with stop.
	slog.Info("idle.stopping",
		"idle_duration", idleDuration,
		"threshold", pm.idleTimeout,
		"pid", status.PID)

	// Release lock before calling stopForIdle() to avoid deadlock.
	pm.mu.Unlock()

	// stopForIdle sets wasHealthyBeforeIdle=true on success (while holding lock).
	err := pm.stopForIdle()
	pm.idleStopping.Store(false) // Clear flag regardless of outcome

	if err != nil {
		slog.Error("idle.stop_failed",
			"error", err,
			"pid", status.PID,
			"idle_duration", idleDuration)
	} else {
		slog.Info("idle.stopped",
			"pid", status.PID,
			"uptime", time.Since(status.StartTime),
			"was_healthy_before_idle", true)
	}
}

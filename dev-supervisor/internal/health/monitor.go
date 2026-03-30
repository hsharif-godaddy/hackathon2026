package health

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
)

// Duration is a custom type that can unmarshal from JSON duration strings like "30s", "5m"
//
//nolint:recvcheck // UnmarshalJSON requires pointer receiver to modify value, others use value receiver for convenience
type Duration time.Duration

// UnmarshalJSON implements json.Unmarshaler for Duration
func (d *Duration) UnmarshalJSON(b []byte) error {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}

	switch value := v.(type) {
	case float64:
		// Handle integer nanoseconds
		*d = Duration(time.Duration(value))
		return nil
	case string:
		// Handle duration strings like "30s", "5m"
		duration, err := time.ParseDuration(value)
		if err != nil {
			return err
		}
		*d = Duration(duration)
		return nil
	default:
		return fmt.Errorf("cannot unmarshal %T into Duration", value)
	}
}

// MarshalJSON implements json.Marshaler for Duration
func (d Duration) MarshalJSON() ([]byte, error) {
	return json.Marshal(time.Duration(d).String())
}

// ToDuration converts to time.Duration
func (d Duration) ToDuration() time.Duration {
	return time.Duration(d)
}

// HealthCheckType represents the type of health check to perform.
//
//nolint:revive // "stuttering" name is intentional for clarity when imported
type HealthCheckType string

const (
	HealthCheckTypeCommand HealthCheckType = "command"
	HealthCheckTypeHTTP    HealthCheckType = "http"
	HealthCheckTypeTCP     HealthCheckType = "tcp"
)

// HealthCheck configures health check behavior.
//
//nolint:revive // "stuttering" name is intentional for clarity when imported
type HealthCheck struct {
	Type             HealthCheckType `json:"type"`
	Command          string          `json:"command,omitempty"`
	URL              string          `json:"url,omitempty"`
	Address          string          `json:"address,omitempty"`
	Interval         Duration        `json:"interval"`
	Timeout          Duration        `json:"timeout"`
	Retries          int             `json:"retries"`
	StartPeriod      Duration        `json:"start_period"`
	SuccessThreshold int             `json:"success_threshold"`
	FailureThreshold int             `json:"failure_threshold"`
}

// HealthStatus represents the current health status.
//
//nolint:revive // "stuttering" name is intentional for clarity when imported
type HealthStatus string

const (
	HealthStatusHealthy   HealthStatus = "healthy"
	HealthStatusUnhealthy HealthStatus = "unhealthy"
	HealthStatusStarting  HealthStatus = "starting"
	HealthStatusDisabled  HealthStatus = "disabled"
)

// Log level constants for health monitor logging
const (
	logLevelInfo    = "info"
	logLevelWarning = "warning"
	logLevelError   = "error"
)

// HealthResult contains the result of a health check.
//
//nolint:revive // "stuttering" name is intentional for clarity when imported
type HealthResult struct {
	Status    HealthStatus  `json:"status"`
	Message   string        `json:"message"`
	LastCheck time.Time     `json:"last_check"`
	Duration  time.Duration `json:"duration"`
	Failures  int           `json:"consecutive_failures"`
	Successes int           `json:"consecutive_successes"`
}

type RestartPolicy struct {
	Enabled           bool     `json:"enabled"`
	MaxRestarts       int      `json:"max_restarts"`
	RestartWindow     Duration `json:"restart_window"`
	BackoffMultiplier float64  `json:"backoff_multiplier"`
	MaxBackoff        Duration `json:"max_backoff"`
	InitialDelay      Duration `json:"initial_delay"`
}

// Monitor performs health checks and manages restart policies.
// Supports command, HTTP, and TCP health checks with configurable intervals,
// timeouts, and automatic restarts on failure.
type Monitor struct {
	mu            sync.RWMutex
	healthCheck   atomic.Pointer[HealthCheck]
	restartPolicy atomic.Pointer[RestartPolicy]
	result        HealthResult
	enabled       bool
	cancel        context.CancelFunc
	restartCount  int
	restartTimes  []time.Time
	onRestart     func() error
	logMgr        logs.Logger
	startTime     time.Time
	restartCh     chan struct{} // Buffered channel for restart requests
	httpClient    *http.Client  // HTTP client for health checks (keep-alives disabled)
}

// NewMonitor creates a new health monitor with disabled status.
// logMgr can be nil if logging is not needed.
func NewMonitor(logMgr logs.Logger) *Monitor {
	// Clone default transport to preserve proxy support, timeouts, and other defaults
	transport, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		// This should never happen as DefaultTransport is always *http.Transport,
		// but we handle it defensively to satisfy static analysis
		transport = &http.Transport{}
	}
	transport = transport.Clone()
	transport.DisableKeepAlives = true // Each health check opens a fresh connection

	return &Monitor{
		result: HealthResult{
			Status: HealthStatusDisabled,
		},
		enabled:    false,
		logMgr:     logMgr,
		httpClient: &http.Client{Transport: transport},
	}
}

func (hm *Monitor) Configure(healthCheck *HealthCheck, restartPolicy *RestartPolicy) {
	hm.configureHealthCheck(healthCheck)
	hm.configureRestartPolicy(restartPolicy)
}

// configureHealthCheck applies defaults and stores health check configuration
func (hm *Monitor) configureHealthCheck(healthCheck *HealthCheck) {
	if healthCheck == nil {
		hm.healthCheck.Store(nil)
		return
	}

	// Make a copy and apply defaults to avoid mutating the original
	hcCopy := *healthCheck

	if hcCopy.Interval == 0 {
		hcCopy.Interval = Duration(30 * time.Second)
	}
	if hcCopy.Timeout == 0 {
		hcCopy.Timeout = Duration(10 * time.Second)
	}
	if hcCopy.Retries == 0 {
		hcCopy.Retries = 3
	}
	if hcCopy.StartPeriod == 0 {
		hcCopy.StartPeriod = Duration(60 * time.Second)
	}
	if hcCopy.SuccessThreshold == 0 {
		hcCopy.SuccessThreshold = 1
	}
	if hcCopy.FailureThreshold == 0 {
		hcCopy.FailureThreshold = 3
	}

	// Store the immutable copy
	hm.healthCheck.Store(&hcCopy)
}

// configureRestartPolicy applies defaults and stores restart policy configuration
func (hm *Monitor) configureRestartPolicy(restartPolicy *RestartPolicy) {
	if restartPolicy == nil || !restartPolicy.Enabled {
		hm.restartPolicy.Store(nil)
		return
	}

	// Copy and apply defaults to local variable
	rpCopy := *restartPolicy
	if rpCopy.MaxRestarts == 0 {
		rpCopy.MaxRestarts = 5
	}
	if rpCopy.RestartWindow == 0 {
		rpCopy.RestartWindow = Duration(5 * time.Minute)
	}
	if rpCopy.BackoffMultiplier == 0 {
		rpCopy.BackoffMultiplier = 2.0
	}
	if rpCopy.MaxBackoff == 0 {
		rpCopy.MaxBackoff = Duration(5 * time.Minute)
	}
	if rpCopy.InitialDelay == 0 {
		rpCopy.InitialDelay = Duration(1 * time.Second)
	}

	// Store atomically, no lock needed
	hm.restartPolicy.Store(&rpCopy)
}

func (hm *Monitor) Start(onRestart func() error) {
	// Check if health check is configured
	if hm.healthCheck.Load() == nil {
		return
	}

	hm.mu.Lock()

	// Guard: cancel existing monitor if running
	if hm.cancel != nil {
		slog.Warn("health_monitor.already_running",
			"message", "canceling existing monitor")
		hm.cancel()
	}

	hm.enabled = true
	hm.onRestart = onRestart
	hm.startTime = time.Now()

	hm.result.Status = HealthStatusStarting
	hm.result.LastCheck = time.Now()

	// Create buffered channel for restart requests (buffer prevents blocking on send)
	hm.restartCh = make(chan struct{}, 10)
	restartCh := hm.restartCh // Capture channel locally to avoid field access race

	// Create context and start monitoring goroutines
	ctx, cancel := context.WithCancel(context.Background())
	hm.cancel = cancel
	hm.mu.Unlock()

	go hm.monitorLoop(ctx)
	go hm.restartLoop(ctx, restartCh) // Pass channel as parameter
}

func (hm *Monitor) Stop() {
	hm.mu.Lock()
	defer hm.mu.Unlock()

	hm.enabled = false
	if hm.cancel != nil {
		hm.cancel()
		hm.cancel = nil // Clear to prevent false positives in Start() guard
	}
	hm.result.Status = HealthStatusDisabled
}

func (hm *Monitor) GetStatus() HealthResult {
	hm.mu.RLock()
	defer hm.mu.RUnlock()
	return hm.result
}

func (hm *Monitor) GetRestartStats() map[string]any {
	hm.mu.RLock()
	defer hm.mu.RUnlock()

	stats := map[string]any{
		"total_restarts":  hm.restartCount,
		"recent_restarts": 0,
	}

	if rp := hm.restartPolicy.Load(); rp != nil {
		recentRestarts := 0
		cutoff := time.Now().Add(-rp.RestartWindow.ToDuration())
		for _, restartTime := range hm.restartTimes {
			if restartTime.After(cutoff) {
				recentRestarts++
			}
		}

		stats["recent_restarts"] = recentRestarts
		stats["restart_window"] = rp.RestartWindow.ToDuration().String()
		stats["max_restarts"] = rp.MaxRestarts
	} else {
		stats["restart_window"] = "not configured"
		stats["max_restarts"] = 0
	}

	return stats
}

func (hm *Monitor) monitorLoop(ctx context.Context) {
	// Get initial health check configuration
	healthCheck := hm.healthCheck.Load()
	if healthCheck == nil {
		return
	}

	ticker := time.NewTicker(healthCheck.Interval.ToDuration())
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			hm.performHealthCheck(ctx)
		}
	}
}

func (hm *Monitor) performHealthCheck(ctx context.Context) {
	checkStart := time.Now()

	// Get current health check configuration atomically
	healthCheck := hm.healthCheck.Load()
	if healthCheck == nil {
		return
	}

	// Get start time under mutex
	hm.mu.RLock()
	startTime := hm.startTime
	hm.mu.RUnlock()

	// Skip health checks during start period
	if time.Since(startTime) < healthCheck.StartPeriod.ToDuration() {
		hm.updateResult(HealthStatusStarting, "Within start period", checkStart, 0)
		return
	}

	success := false
	var message string
	var err error

	// Perform the actual health check
	switch healthCheck.Type {
	case HealthCheckTypeCommand:
		success, message, err = hm.performCommandCheck(ctx, healthCheck)
	case HealthCheckTypeHTTP:
		success, message, err = hm.performHTTPCheck(ctx, healthCheck)
	case HealthCheckTypeTCP:
		success, message, err = hm.performTCPCheck(ctx, healthCheck)
	default:
		message = fmt.Sprintf("Unknown health check type: %s", healthCheck.Type)
		err = fmt.Errorf("%s", message)
	}

	duration := time.Since(checkStart)

	if err != nil {
		message = fmt.Sprintf("Health check failed: %v", err)
	}

	hm.processHealthCheckResult(success, message, checkStart, duration)
}

func (hm *Monitor) performCommandCheck(ctx context.Context, healthCheck *HealthCheck) (bool, string, error) {
	if healthCheck.Command == "" {
		return false, "No command specified", errors.New("empty command")
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, healthCheck.Timeout.ToDuration())
	defer cancel()

	//nolint:gosec // G204: Command execution is the intended functionality for health checks
	// nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
	cmd := exec.CommandContext(timeoutCtx, "sh", "-c", healthCheck.Command)
	output, err := cmd.CombinedOutput()

	if err != nil {
		return false, string(output), err
	}

	return true, strings.TrimSpace(string(output)), nil
}

func (hm *Monitor) performHTTPCheck(ctx context.Context, healthCheck *HealthCheck) (bool, string, error) {
	if healthCheck.URL == "" {
		return false, "No URL specified", errors.New("empty URL")
	}

	// Create request-specific context with timeout
	reqCtx, cancel := context.WithTimeout(ctx, healthCheck.Timeout.ToDuration())
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, healthCheck.URL, nil)
	if err != nil {
		return false, "Failed to create request", err
	}

	// Reuse the Monitor's http.Client instead of creating a new one each time
	resp, err := hm.httpClient.Do(req)
	if err != nil {
		return false, "HTTP request failed", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return true, fmt.Sprintf("HTTP %d", resp.StatusCode), nil
	}

	return false, fmt.Sprintf("HTTP %d", resp.StatusCode), errors.New("unhealthy status code")
}

func (hm *Monitor) performTCPCheck(ctx context.Context, healthCheck *HealthCheck) (bool, string, error) {
	if healthCheck.Address == "" {
		return false, "No address specified", errors.New("empty address")
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, healthCheck.Timeout.ToDuration())
	defer cancel()

	// Parse address - should be in format "host:port"
	dialer := &net.Dialer{}
	conn, err := dialer.DialContext(timeoutCtx, "tcp", healthCheck.Address)
	if err != nil {
		return false, fmt.Sprintf("Connection failed: %v", err), err
	}
	defer conn.Close()

	// Connection successful
	return true, fmt.Sprintf("Connected to %s", healthCheck.Address), nil
}

func (hm *Monitor) processHealthCheckResult(
	success bool,
	message string,
	checkTime time.Time,
	duration time.Duration,
) {
	// Get current health check config atomically
	healthCheck := hm.healthCheck.Load()
	if healthCheck == nil {
		return
	}

	var (
		status         HealthStatus
		logMgr         logs.Logger
		logLevel       string
		logMessage     string
		restartDropped bool
	)

	hm.mu.Lock()

	if success {
		hm.handleHealthSuccess(healthCheck)
	} else {
		restartDropped = hm.handleHealthFailure(healthCheck)
	}

	// Update result while holding lock (called from locked context)
	hm.result.Message = message
	hm.result.LastCheck = checkTime
	hm.result.Duration = duration

	status = hm.result.Status
	logMgr = hm.logMgr
	logLevel = logLevelInfo
	if !success {
		logLevel = logLevelError
	}
	logMessage = fmt.Sprintf(
		"Health check %s: %s (took %v)",
		strings.ToLower(string(status)),
		message,
		duration,
	)
	hm.mu.Unlock()

	if logMgr != nil {
		logMgr.AddLog(logs.LogEntry{
			Timestamp: checkTime,
			Source:    "health_monitor",
			Level:     logLevel,
			Message:   logMessage,
		})
		if restartDropped {
			logMgr.AddLog(logs.LogEntry{
				Timestamp: time.Now(),
				Source:    "health_monitor",
				Level:     logLevelWarning,
				Message:   "Restart request dropped (restart queue full)",
			})
		}
	}
}

// handleHealthSuccess updates counters and status when health check succeeds
func (hm *Monitor) handleHealthSuccess(healthCheck *HealthCheck) {
	hm.result.Successes++
	hm.result.Failures = 0

	if hm.result.Successes >= healthCheck.SuccessThreshold {
		hm.result.Status = HealthStatusHealthy
	}
}

// handleHealthFailure updates counters and status when health check fails
func (hm *Monitor) handleHealthFailure(healthCheck *HealthCheck) bool {
	hm.result.Failures++
	hm.result.Successes = 0

	if hm.result.Failures >= healthCheck.FailureThreshold {
		hm.result.Status = HealthStatusUnhealthy

		// Trigger restart if policy is enabled
		// Send to channel instead of spawning goroutine (non-blocking send)
		if rp := hm.restartPolicy.Load(); rp != nil && rp.Enabled {
			select {
			case hm.restartCh <- struct{}{}:
				// Restart request queued
			default:
				// Channel full, restart already pending
				return true
			}
		}
	}
	return false
}

// updateResult updates the health check result with proper locking.
// This method assumes the caller does NOT hold hm.mu lock.
func (hm *Monitor) updateResult(
	status HealthStatus,
	message string,
	checkTime time.Time,
	duration time.Duration,
) {
	hm.mu.Lock()
	defer hm.mu.Unlock()

	hm.result.Status = status
	hm.result.Message = message
	hm.result.LastCheck = checkTime
	hm.result.Duration = duration
}

// restartLoop processes restart requests with context cancellation support.
// This ensures restarts don't fire after Stop() is called.
// Takes restartCh as a parameter to avoid racing with field reassignment in Start().
func (hm *Monitor) restartLoop(ctx context.Context, restartCh <-chan struct{}) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-restartCh:
			hm.attemptRestart(ctx)
		}
	}
}

func (hm *Monitor) attemptRestart(ctx context.Context) {
	select {
	case <-ctx.Done():
		return
	default:
	}

	// Load restart policy atomically
	rp := hm.restartPolicy.Load()
	if rp == nil {
		return
	}

	hm.mu.Lock()

	// Check if we've exceeded max restarts in the time window
	now := time.Now()
	cutoff := now.Add(-rp.RestartWindow.ToDuration())

	recentRestarts := 0
	for _, restartTime := range hm.restartTimes {
		if restartTime.After(cutoff) {
			recentRestarts++
		}
	}

	if recentRestarts >= rp.MaxRestarts {
		hm.mu.Unlock()
		if hm.logMgr != nil {
			hm.logMgr.AddLog(logs.LogEntry{
				Timestamp: now,
				Source:    "health_monitor",
				Level:     logLevelError,
				Message: fmt.Sprintf(
					"Max restarts (%d) exceeded in window %v, not restarting",
					rp.MaxRestarts,
					rp.RestartWindow.ToDuration(),
				),
			})
		}
		return
	}

	// Calculate backoff delay
	delay := rp.InitialDelay.ToDuration()
	for range recentRestarts {
		delay = time.Duration(float64(delay) * rp.BackoffMultiplier)
		if delay > rp.MaxBackoff.ToDuration() {
			delay = rp.MaxBackoff.ToDuration()
			break
		}
	}

	hm.restartCount++
	hm.restartTimes = append(hm.restartTimes, now)

	onRestart := hm.onRestart
	hm.mu.Unlock()

	if hm.logMgr != nil {
		hm.logMgr.AddLog(logs.LogEntry{
			Timestamp: now,
			Source:    "health_monitor",
			Level:     logLevelWarning,
			Message: fmt.Sprintf(
				"Attempting restart #%d after %v delay due to health check failure",
				hm.restartCount,
				delay,
			),
		})
	}

	// Wait for backoff delay with context cancellation support
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		// Monitor was stopped during backoff, abort restart
		return
	case <-timer.C:
		// Backoff complete, proceed
	}

	// Check if monitor is still enabled after backoff
	hm.mu.RLock()
	if !hm.enabled {
		hm.mu.RUnlock()
		return
	}
	hm.mu.RUnlock()

	// Attempt restart
	if onRestart != nil {
		if err := onRestart(); err != nil && hm.logMgr != nil {
			hm.logMgr.AddLog(logs.LogEntry{
				Timestamp: time.Now(),
				Source:    "health_monitor",
				Level:     logLevelError,
				Message:   fmt.Sprintf("Restart failed: %v", err),
			})
		}
	}
}

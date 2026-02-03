package health

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	restartPolicy *RestartPolicy
	result        HealthResult
	enabled       bool
	cancel        context.CancelFunc
	restartCount  int
	restartTimes  []time.Time
	onRestart     func() error
	logMgr        logs.Logger
	startTime     time.Time
}

// NewMonitor creates a new health monitor with disabled status.
// logMgr can be nil if logging is not needed.
func NewMonitor(logMgr logs.Logger) *Monitor {
	return &Monitor{
		result: HealthResult{
			Status: HealthStatusDisabled,
		},
		enabled: false,
		logMgr:  logMgr,
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
	hm.mu.Lock()
	hm.restartPolicy = restartPolicy
	hm.mu.Unlock()

	if restartPolicy == nil || !restartPolicy.Enabled {
		return
	}

	if hm.restartPolicy.MaxRestarts == 0 {
		hm.restartPolicy.MaxRestarts = 5
	}
	if hm.restartPolicy.RestartWindow == 0 {
		hm.restartPolicy.RestartWindow = Duration(5 * time.Minute)
	}
	if hm.restartPolicy.BackoffMultiplier == 0 {
		hm.restartPolicy.BackoffMultiplier = 2.0
	}
	if hm.restartPolicy.MaxBackoff == 0 {
		hm.restartPolicy.MaxBackoff = Duration(5 * time.Minute)
	}
	if hm.restartPolicy.InitialDelay == 0 {
		hm.restartPolicy.InitialDelay = Duration(1 * time.Second)
	}
}

func (hm *Monitor) Start(onRestart func() error) {
	// Check if health check is configured
	if hm.healthCheck.Load() == nil {
		return
	}

	hm.mu.Lock()
	hm.enabled = true
	hm.onRestart = onRestart
	hm.startTime = time.Now()

	hm.result.Status = HealthStatusStarting
	hm.result.LastCheck = time.Now()

	// Create context and start monitoring goroutine
	ctx, cancel := context.WithCancel(context.Background())
	hm.cancel = cancel
	hm.mu.Unlock()

	go hm.monitorLoop(ctx)
}

func (hm *Monitor) Stop() {
	hm.mu.Lock()
	defer hm.mu.Unlock()

	hm.enabled = false
	if hm.cancel != nil {
		hm.cancel()
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

	if hm.restartPolicy != nil {
		recentRestarts := 0
		cutoff := time.Now().Add(-hm.restartPolicy.RestartWindow.ToDuration())
		for _, restartTime := range hm.restartTimes {
			if restartTime.After(cutoff) {
				recentRestarts++
			}
		}

		stats["recent_restarts"] = recentRestarts
		stats["restart_window"] = hm.restartPolicy.RestartWindow.ToDuration().String()
		stats["max_restarts"] = hm.restartPolicy.MaxRestarts
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

	client := &http.Client{
		Timeout: healthCheck.Timeout.ToDuration(),
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, healthCheck.URL, nil)
	if err != nil {
		return false, "Failed to create request", err
	}

	resp, err := client.Do(req)
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

	hm.mu.Lock()
	defer hm.mu.Unlock()

	if success {
		hm.handleHealthSuccess(healthCheck)
	} else {
		hm.handleHealthFailure(healthCheck)
	}

	hm.updateResult(hm.result.Status, message, checkTime, duration)

	// Log health check result
	if hm.logMgr != nil {
		logLevel := logLevelInfo
		if !success {
			logLevel = logLevelError
		}

		hm.logMgr.AddLog(logs.LogEntry{
			Timestamp: checkTime,
			Source:    "health_monitor",
			Level:     logLevel,
			Message: fmt.Sprintf(
				"Health check %s: %s (took %v)",
				strings.ToLower(string(hm.result.Status)),
				message,
				duration,
			),
		})
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
func (hm *Monitor) handleHealthFailure(healthCheck *HealthCheck) {
	hm.result.Failures++
	hm.result.Successes = 0

	if hm.result.Failures >= healthCheck.FailureThreshold {
		hm.result.Status = HealthStatusUnhealthy

		// Trigger restart if policy is enabled
		if hm.restartPolicy != nil && hm.restartPolicy.Enabled {
			go hm.attemptRestart()
		}
	}
}

func (hm *Monitor) updateResult(
	status HealthStatus,
	message string,
	checkTime time.Time,
	duration time.Duration,
) {
	hm.result.Status = status
	hm.result.Message = message
	hm.result.LastCheck = checkTime
	hm.result.Duration = duration
}

func (hm *Monitor) attemptRestart() {
	hm.mu.Lock()

	// Check if we've exceeded max restarts in the time window
	now := time.Now()
	cutoff := now.Add(-hm.restartPolicy.RestartWindow.ToDuration())

	recentRestarts := 0
	for _, restartTime := range hm.restartTimes {
		if restartTime.After(cutoff) {
			recentRestarts++
		}
	}

	if recentRestarts >= hm.restartPolicy.MaxRestarts {
		hm.mu.Unlock()
		if hm.logMgr != nil {
			hm.logMgr.AddLog(logs.LogEntry{
				Timestamp: now,
				Source:    "health_monitor",
				Level:     logLevelError,
				Message: fmt.Sprintf(
					"Max restarts (%d) exceeded in window %v, not restarting",
					hm.restartPolicy.MaxRestarts,
					hm.restartPolicy.RestartWindow.ToDuration(),
				),
			})
		}
		return
	}

	// Calculate backoff delay
	delay := hm.restartPolicy.InitialDelay.ToDuration()
	for range recentRestarts {
		delay = time.Duration(float64(delay) * hm.restartPolicy.BackoffMultiplier)
		if delay > hm.restartPolicy.MaxBackoff.ToDuration() {
			delay = hm.restartPolicy.MaxBackoff.ToDuration()
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

	// Wait for backoff delay
	time.Sleep(delay)

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

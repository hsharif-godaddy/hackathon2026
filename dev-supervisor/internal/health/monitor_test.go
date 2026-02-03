package health //nolint:testpackage // Using same package to test unexported members

import (
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
)

func TestHealthMonitor_NewMonitor(t *testing.T) {
	t.Parallel()
	var logMgr logs.Logger
	hm := NewMonitor(logMgr)

	if hm == nil {
		t.Fatal("Expected non-nil HealthMonitor")
		return
	}

	if hm.logMgr != logMgr {
		t.Error("Expected logMgr to be set correctly")
	}

	status := hm.GetStatus()
	if status.Status != HealthStatusDisabled {
		t.Errorf("Expected initial status %s, got %s", HealthStatusDisabled, status.Status)
	}

	if hm.enabled {
		t.Error("Expected health monitor to be disabled initially")
	}
}

func TestHealthMonitor_Configure(t *testing.T) {
	t.Parallel()
	var logMgr logs.Logger
	hm := NewMonitor(logMgr)

	healthCheck := &HealthCheck{
		Type:             HealthCheckTypeCommand,
		Command:          "echo 'healthy'",
		Interval:         Duration(5 * time.Second),
		Timeout:          Duration(2 * time.Second),
		Retries:          3,
		StartPeriod:      Duration(10 * time.Second),
		SuccessThreshold: 2,
		FailureThreshold: 3,
	}

	restartPolicy := &RestartPolicy{
		Enabled:           true,
		MaxRestarts:       5,
		RestartWindow:     Duration(5 * time.Minute),
		BackoffMultiplier: 2.0,
		MaxBackoff:        Duration(1 * time.Minute),
		InitialDelay:      Duration(1 * time.Second),
	}

	// Test configuration
	hm.Configure(healthCheck, restartPolicy)

	// Verify defaults were applied
	healthCheck = hm.healthCheck.Load()
	if healthCheck.Interval != Duration(5*time.Second) {
		t.Errorf("Expected interval 5s, got %v", healthCheck.Interval)
	}

	if healthCheck.Timeout != Duration(2*time.Second) {
		t.Errorf("Expected timeout 2s, got %v", healthCheck.Timeout)
	}

	if hm.restartPolicy.MaxRestarts != 5 {
		t.Errorf("Expected max restarts 5, got %d", hm.restartPolicy.MaxRestarts)
	}
}

func TestHealthMonitor_ConfigureDefaults(t *testing.T) {
	t.Parallel()
	var logMgr logs.Logger
	hm := NewMonitor(logMgr)

	// Test with minimal configuration (should apply defaults)
	healthCheck := &HealthCheck{
		Type:    HealthCheckTypeCommand,
		Command: "echo 'test'",
	}

	restartPolicy := &RestartPolicy{
		Enabled: true,
	}

	hm.Configure(healthCheck, restartPolicy)

	// Check that defaults were applied
	healthCheck = hm.healthCheck.Load()
	if healthCheck.Interval != Duration(30*time.Second) {
		t.Errorf("Expected default interval 30s, got %v", healthCheck.Interval)
	}

	if healthCheck.Timeout != Duration(10*time.Second) {
		t.Errorf("Expected default timeout 10s, got %v", healthCheck.Timeout)
	}

	if healthCheck.Retries != 3 {
		t.Errorf("Expected default retries 3, got %d", healthCheck.Retries)
	}

	if hm.restartPolicy.MaxRestarts != 5 {
		t.Errorf("Expected default max restarts 5, got %d", hm.restartPolicy.MaxRestarts)
	}
}

func TestHealthMonitor_StartStop(t *testing.T) {
	t.Parallel()
	var logMgr logs.Logger
	hm := NewMonitor(logMgr)

	// Configure with a simple health check
	healthCheck := &HealthCheck{
		Type:        HealthCheckTypeCommand,
		Command:     "true", // Always succeeds
		Interval:    Duration(100 * time.Millisecond),
		StartPeriod: Duration(50 * time.Millisecond),
	}

	hm.Configure(healthCheck, nil)

	// Start monitoring
	hm.Start(func() error {
		return nil
	})

	if !hm.enabled {
		t.Error("Expected health monitor to be enabled after start")
	}

	// Wait for at least one health check
	time.Sleep(200 * time.Millisecond)

	status := hm.GetStatus()
	if status.Status != HealthStatusHealthy {
		t.Errorf("Expected status %s, got %s", HealthStatusHealthy, status.Status)
	}

	// Stop monitoring
	hm.Stop()

	if hm.enabled {
		t.Error("Expected health monitor to be disabled after stop")
	}

	finalStatus := hm.GetStatus()
	if finalStatus.Status != HealthStatusDisabled {
		t.Errorf("Expected status %s after stop, got %s", HealthStatusDisabled, finalStatus.Status)
	}
}

func TestHealthMonitor_CommandHealthCheck(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		command        string
		expectSuccess  bool
		expectedStatus HealthStatus
	}{
		{
			name:           "successful command",
			command:        "true",
			expectSuccess:  true,
			expectedStatus: HealthStatusHealthy,
		},
		{
			name:           "failing command",
			command:        "false",
			expectSuccess:  false,
			expectedStatus: HealthStatusUnhealthy,
		},
		{
			name:           "command with output",
			command:        "echo 'healthy'",
			expectSuccess:  true,
			expectedStatus: HealthStatusHealthy,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			// Create separate instances for each parallel test to avoid race conditions
			var logMgr logs.Logger
			hm := NewMonitor(logMgr)

			healthCheck := &HealthCheck{
				Type:             HealthCheckTypeCommand,
				Command:          tt.command,
				Interval:         Duration(50 * time.Millisecond), // Much shorter interval for testing
				Timeout:          Duration(2 * time.Second),
				StartPeriod:      Duration(1 * time.Millisecond), // Very short for testing
				FailureThreshold: 1,
				SuccessThreshold: 1,
			}

			hm.Configure(healthCheck, nil)
			hm.Start(func() error { return nil })
			defer hm.Stop()

			// Wait for health check to complete - need to wait longer than interval + start period
			time.Sleep(200 * time.Millisecond)

			status := hm.GetStatus()
			if status.Status != tt.expectedStatus {
				t.Errorf("Expected status %s, got %s", tt.expectedStatus, status.Status)
			}
		})
	}
}

func TestHealthMonitor_HTTPHealthCheck(t *testing.T) {
	t.Parallel()
	// Create test HTTP server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte("healthy")); err != nil {
			t.Logf("test http response write failed: %v", err)
		}
	}))
	defer server.Close()

	var logMgr logs.Logger
	hm := NewMonitor(logMgr)

	healthCheck := &HealthCheck{
		Type:             HealthCheckTypeHTTP,
		URL:              server.URL,
		Interval:         Duration(100 * time.Millisecond),
		Timeout:          Duration(5 * time.Second),
		StartPeriod:      Duration(1 * time.Millisecond),
		SuccessThreshold: 1,
		FailureThreshold: 1,
	}

	hm.Configure(healthCheck, nil)
	hm.Start(func() error { return nil })
	defer hm.Stop()

	// Wait for health check
	time.Sleep(200 * time.Millisecond)

	status := hm.GetStatus()
	if status.Status != HealthStatusHealthy {
		t.Errorf("Expected status %s, got %s", HealthStatusHealthy, status.Status)
	}
}

func TestHealthMonitor_HTTPHealthCheckFailure(t *testing.T) {
	t.Parallel()
	// Create test HTTP server that returns error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		if _, err := w.Write([]byte("unhealthy")); err != nil {
			t.Logf("test http response write failed: %v", err)
		}
	}))
	defer server.Close()

	var logMgr logs.Logger
	hm := NewMonitor(logMgr)

	healthCheck := &HealthCheck{
		Type:             HealthCheckTypeHTTP,
		URL:              server.URL,
		Interval:         Duration(100 * time.Millisecond),
		Timeout:          Duration(5 * time.Second),
		StartPeriod:      Duration(1 * time.Millisecond),
		SuccessThreshold: 1,
		FailureThreshold: 1,
	}

	hm.Configure(healthCheck, nil)
	hm.Start(func() error { return nil })
	defer hm.Stop()

	// Wait for health check
	time.Sleep(200 * time.Millisecond)

	status := hm.GetStatus()
	if status.Status != HealthStatusUnhealthy {
		t.Errorf("Expected status %s, got %s", HealthStatusUnhealthy, status.Status)
	}
}

func TestHealthMonitor_TCPHealthCheck(t *testing.T) {
	t.Parallel()
	// Create a TCP listener
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to create TCP listener: %v", err)
	}
	defer listener.Close()

	// Accept connections in background
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return // Listener closed
			}
			conn.Close() // Immediately close connection
		}
	}()

	var logMgr logs.Logger
	hm := NewMonitor(logMgr)

	healthCheck := &HealthCheck{
		Type:             HealthCheckTypeTCP,
		Address:          listener.Addr().String(),
		Interval:         Duration(100 * time.Millisecond),
		Timeout:          Duration(5 * time.Second),
		StartPeriod:      Duration(1 * time.Millisecond),
		SuccessThreshold: 1,
		FailureThreshold: 1,
	}

	hm.Configure(healthCheck, nil)
	hm.Start(func() error { return nil })
	defer hm.Stop()

	// Wait for health check
	time.Sleep(200 * time.Millisecond)

	status := hm.GetStatus()
	if status.Status != HealthStatusHealthy {
		t.Errorf("Expected status %s, got %s", HealthStatusHealthy, status.Status)
	}
}

func TestHealthMonitor_TCPHealthCheckFailure(t *testing.T) {
	t.Parallel()
	var logMgr logs.Logger
	hm := NewMonitor(logMgr)

	// Use a port that's definitely not listening
	healthCheck := &HealthCheck{
		Type:             HealthCheckTypeTCP,
		Address:          "127.0.0.1:99999", // Unlikely to be in use
		Interval:         Duration(100 * time.Millisecond),
		Timeout:          Duration(1 * time.Second),
		StartPeriod:      Duration(1 * time.Millisecond),
		SuccessThreshold: 1,
		FailureThreshold: 1,
	}

	hm.Configure(healthCheck, nil)
	hm.Start(func() error { return nil })
	defer hm.Stop()

	// Wait for health check
	time.Sleep(200 * time.Millisecond)

	status := hm.GetStatus()
	if status.Status != HealthStatusUnhealthy {
		t.Errorf("Expected status %s, got %s", HealthStatusUnhealthy, status.Status)
	}
}

func TestHealthMonitor_RestartPolicy(t *testing.T) {
	var logMgr logs.Logger
	hm := NewMonitor(logMgr)

	var restartCount atomic.Int64
	healthCheck := &HealthCheck{
		Type:             HealthCheckTypeCommand,
		Command:          "false", // Always fails
		Interval:         Duration(50 * time.Millisecond),
		Timeout:          Duration(1 * time.Second),
		StartPeriod:      Duration(1 * time.Millisecond),
		SuccessThreshold: 1,
		FailureThreshold: 1, // Fail immediately
	}

	restartPolicy := &RestartPolicy{
		Enabled:           true,
		MaxRestarts:       3,
		RestartWindow:     Duration(1 * time.Minute),
		BackoffMultiplier: 1.0, // No backoff for faster testing
		MaxBackoff:        Duration(1 * time.Second),
		InitialDelay:      Duration(1 * time.Millisecond),
	}

	hm.Configure(healthCheck, restartPolicy)
	hm.Start(func() error {
		restartCount.Add(1)
		return nil
	})
	defer hm.Stop()

	// Wait for multiple health checks and restarts
	time.Sleep(500 * time.Millisecond)

	stats := hm.GetRestartStats()
	totalRestarts, exists := stats["total_restarts"]
	if !exists {
		t.Error("Expected total_restarts in stats")
	}

	if restarts, ok := totalRestarts.(int); !ok || restarts == 0 {
		t.Error("Expected some restarts to have occurred")
	}

	if restartCount.Load() == 0 {
		t.Error("Expected restart callback to be called")
	}
}

func TestHealthMonitor_GetRestartStats(t *testing.T) {
	t.Parallel()
	var logMgr logs.Logger
	hm := NewMonitor(logMgr)

	// Test with no restart policy
	stats := hm.GetRestartStats()

	expectedFields := []string{"total_restarts", "recent_restarts", "restart_window", "max_restarts"}
	for _, field := range expectedFields {
		if _, exists := stats[field]; !exists {
			t.Errorf("Expected field %s in restart stats", field)
		}
	}

	if stats["total_restarts"] != 0 {
		t.Error("Expected total_restarts to be 0 initially")
	}

	// Test with restart policy
	restartPolicy := &RestartPolicy{
		Enabled:       true,
		MaxRestarts:   5,
		RestartWindow: Duration(5 * time.Minute),
	}

	hm.Configure(nil, restartPolicy)

	stats = hm.GetRestartStats()
	if stats["max_restarts"] != 5 {
		t.Errorf("Expected max_restarts 5, got %v", stats["max_restarts"])
	}
}

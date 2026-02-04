package main

import (
	"fmt"
	"net"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/processmanager"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

func configureSMTPTestEnv(t *testing.T) {
	listenPort := findAvailablePort(t)
	destPort := findAvailablePort(t)
	t.Setenv("SMTP_LISTEN_ADDR", fmt.Sprintf("127.0.0.1:%d", listenPort))
	t.Setenv("SMTP_DESTINATION", fmt.Sprintf("127.0.0.1:%d", destPort))
}

// shortTempDir creates a temp directory for testing
// Note: Uses t.TempDir() which typically creates directories in /tmp on Unix systems
func shortTempDir(t testing.TB) string {
	// t.TempDir() automatically handles cleanup
	if testingT, ok := t.(*testing.T); ok {
		return testingT.TempDir()
	}
	if testingB, ok := t.(*testing.B); ok {
		return testingB.TempDir()
	}
	t.Fatal("unexpected testing.TB type")
	return ""
}

func TestPortReuseAfterRestart(t *testing.T) {
	configureSMTPTestEnv(t)

	// Create a temporary socket for this test
	tempDir := shortTempDir(t)
	socketPath := filepath.Join(tempDir, "test.sock")

	// Create and start the server
	server := NewServer()
	config := &Config{
		SocketPath:             socketPath,
		ShutdownTimeout:        5 * time.Second,
		ProcessLogging:         true,
		ProcessLoggingToStdout: false,
	}

	// Start server in a goroutine
	serverDone := make(chan error, 1)
	go func() {
		serverDone <- server.StartWithConfig(config)
	}()

	// Wait for server to be ready
	if err := server.waitForServerReady(socketPath, false); err != nil {
		t.Fatalf("Server failed to start: %v", err)
	}

	// Find an available port for testing
	testPort := findAvailablePort(t)

	// Command that binds to a specific port (simulates a development server)
	testCommand := fmt.Sprintf("python3 -m http.server %d", testPort)

	t.Logf("Testing port reuse with command: %s", testCommand)

	// Start initial process
	startReq := validation.ProcessStartRequest{
		Command:    testCommand,
		WorkingDir: tempDir,
	}

	if err := server.procMgr.Start(startReq); err != nil {
		t.Fatalf("Failed to start initial process: %v", err)
	}

	// Wait for the server to actually start listening and accepting connections
	if err := waitForPortInUse(testPort, 5*time.Second); err != nil {
		t.Fatalf("Initial server failed to start listening: %v", err)
	}

	t.Logf("Initial process started successfully and listening on port %d", testPort)

	// Perform sequential restarts - realistic scenario for Node.js servers
	numRestarts := 10
	for i := range numRestarts {
		t.Logf("Performing restart %d/%d", i+1, numRestarts)

		restartStart := time.Now()

		// Restart with graceful shutdown
		if err := server.procMgr.Restart(processmanager.ProcessRestartRequest{Graceful: true}); err != nil {
			t.Fatalf("Restart %d failed: %v", i+1, err)
		}

		// Wait for the new server to actually be listening and accepting connections
		// This is the realistic test - can we reliably restart and have the server ready?
		if err := waitForPortInUse(testPort, 10*time.Second); err != nil {
			status := server.procMgr.GetStatus()
			t.Fatalf("Restart %d: server failed to start listening on port %d: %v (Status: %s, Error: %q)",
				i+1, testPort, err, status.State, status.Error)
		}

		restartDuration := time.Since(restartStart)
		t.Logf("Restart %d completed in %v (server ready and accepting connections)", i+1, restartDuration)
	}

	t.Logf("All %d restarts completed successfully", numRestarts)

	// Clean up - stop the process
	if err := server.procMgr.Stop(processmanager.ProcessStopRequest{Signal: "SIGTERM", Timeout: 10}); err != nil {
		t.Errorf("Failed to stop process: %v", err)
	}
}

func TestConcurrentRestarts(t *testing.T) {
	configureSMTPTestEnv(t)

	// Create a temporary socket for this test
	tempDir := shortTempDir(t)
	socketPath := filepath.Join(tempDir, "test.sock")

	// Create and start the server
	server := NewServer()
	config := &Config{
		SocketPath:             socketPath,
		ShutdownTimeout:        5 * time.Second,
		ProcessLogging:         true,
		ProcessLoggingToStdout: false,
	}

	// Start server in a goroutine
	go func() {
		if err := server.StartWithConfig(config); err != nil {
			t.Errorf("Server failed to start: %v", err)
		}
	}()

	// Wait for server to be ready
	if err := server.waitForServerReady(socketPath, false); err != nil {
		t.Fatalf("Server failed to start: %v", err)
	}

	// Find an available port for testing
	testPort := findAvailablePort(t)
	testCommand := fmt.Sprintf(
		"python3 -c 'import http.server; import socketserver; handler = http.server.SimpleHTTPRequestHandler; httpd = socketserver.TCPServer((\"\", %d), handler); httpd.serve_forever()'",
		testPort,
	)

	// Start initial process
	startReq := validation.ProcessStartRequest{
		Command:    testCommand,
		WorkingDir: tempDir,
	}

	if err := server.procMgr.Start(startReq); err != nil {
		t.Fatalf("Failed to start initial process: %v", err)
	}

	time.Sleep(500 * time.Millisecond)

	// Test concurrent restart attempts (this would previously cause race conditions)
	numGoroutines := 5
	numRestartsPerGoroutine := 3

	var wg sync.WaitGroup
	var mu sync.Mutex
	results := make([]error, 0, numGoroutines*numRestartsPerGoroutine)

	for i := range numGoroutines {
		wg.Add(1)
		go func(goroutineID int) {
			defer wg.Done()

			for j := range numRestartsPerGoroutine {
				err := server.procMgr.Restart(processmanager.ProcessRestartRequest{Graceful: true})

				mu.Lock()
				results = append(results, err)
				mu.Unlock()

				if err != nil {
					t.Logf("Goroutine %d restart %d failed: %v", goroutineID, j+1, err)
				} else {
					t.Logf("Goroutine %d restart %d succeeded", goroutineID, j+1)
				}

				// Small delay between restart attempts
				time.Sleep(50 * time.Millisecond)
			}
		}(i)
	}

	wg.Wait()

	// Count successful restarts
	successCount := 0
	for _, err := range results {
		if err == nil {
			successCount++
		}
	}

	t.Logf("Concurrent restart results: %d successful, %d failed out of %d total",
		successCount, len(results)-successCount, len(results))

	// At least some restarts should succeed (the first one in each batch should work)
	if successCount == 0 {
		t.Fatalf("No concurrent restarts succeeded - this indicates a serious problem")
	}

	// Verify final process is still running
	status := server.procMgr.GetStatus()
	if status.State != processmanager.ProcessStateRunning {
		t.Fatalf(
			"Process should be running after concurrent restarts, got: %s (Error: %q, PID: %d)",
			status.State,
			status.Error,
			status.PID,
		)
	}

	// Clean up
	if err := server.procMgr.Stop(processmanager.ProcessStopRequest{Signal: "SIGTERM", Timeout: 10}); err != nil {
		t.Errorf("Failed to stop process: %v", err)
	}
}

func TestExplicitPortConfiguration(t *testing.T) {
	testCases := []struct {
		name     string
		ports    []int
		expected []int
	}{
		{
			name:     "single port",
			ports:    []int{3000},
			expected: []int{3000},
		},
		{
			name:     "multiple ports",
			ports:    []int{3000, 9229},
			expected: []int{3000, 9229},
		},
		{
			name:     "no ports",
			ports:    []int{},
			expected: []int{},
		},
		{
			name:     "nil ports",
			ports:    nil,
			expected: []int{},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := validation.ProcessStartRequest{
				Ports: tc.ports,
			}

			// Test that ports are preserved in the request
			if len(req.Ports) != len(tc.expected) {
				t.Errorf("Expected %d ports, got %d", len(tc.expected), len(req.Ports))
				return
			}

			for i, expected := range tc.expected {
				if i >= len(req.Ports) || req.Ports[i] != expected {
					t.Errorf("Expected port %d, got %v", expected, req.Ports)
				}
			}
		})
	}
}

// Helper function to find an available port for testing
func findAvailablePort(t *testing.T) int {
	// Start from a high port to avoid conflicts
	for port := 8000; port <= 9000; port++ {
		if processmanager.IsPortAvailable(port) {
			return port
		}
	}
	t.Fatal("No available ports found for testing")
	return 0
}

// waitForPortInUse waits for a port to be bound and accepting connections
// This simulates waiting for a real server to be ready after restart
func waitForPortInUse(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()

	for time.Now().Before(deadline) {
		// Try to connect to the port to verify it's actually accepting connections
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("localhost:%d", port), 100*time.Millisecond)
		if err == nil {
			conn.Close()
			return nil // Port is bound and accepting connections
		}
		<-ticker.C
	}
	return fmt.Errorf("timeout waiting for port %d to accept connections", port)
}

// Benchmark the restart performance with port waiting
func BenchmarkRestartWithPortWait(b *testing.B) {
	// Setup
	tempDir := shortTempDir(b)
	socketPath := filepath.Join(tempDir, "test.sock")

	server := NewServer()
	config := &Config{
		SocketPath:             socketPath,
		ShutdownTimeout:        5 * time.Second,
		ProcessLogging:         false, // Disable logging for benchmark
		ProcessLoggingToStdout: false,
	}

	go func() {
		if err := server.StartWithConfig(config); err != nil {
			b.Errorf("Server failed to start: %v", err)
		}
	}()

	if err := server.waitForServerReady(socketPath, false); err != nil {
		b.Fatalf("Server failed to start: %v", err)
	}

	// Use a lightweight command for benchmarking
	testPort := findAvailablePortForBench(b)
	startReq := validation.ProcessStartRequest{
		Command: fmt.Sprintf(
			"python3 -c 'import socket; s=socket.socket(); s.bind((\"\", %d)); s.listen(1); s.accept()'",
			testPort,
		),
		WorkingDir: tempDir,
	}

	if err := server.procMgr.Start(startReq); err != nil {
		b.Fatalf("Failed to start initial process: %v", err)
	}

	time.Sleep(200 * time.Millisecond) // Let process start

	// Reset timer and run benchmark

	for b.Loop() {
		if err := server.procMgr.Restart(processmanager.ProcessRestartRequest{Graceful: true}); err != nil {
			b.Fatalf("Restart failed: %v", err)
		}
	}

	b.StopTimer()

	// Cleanup
	if err := server.procMgr.Stop(processmanager.ProcessStopRequest{Signal: "SIGKILL", Timeout: 5}); err != nil {
		b.Errorf("Failed to stop process: %v", err)
	}
}

func findAvailablePortForBench(b *testing.B) int {
	listener, err := net.Listen("tcp", ":0")
	if err != nil {
		b.Fatal(err)
	}
	tcpAddr, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		b.Fatal("failed to get TCP address")
	}
	port := tcpAddr.Port
	if err := listener.Close(); err != nil {
		b.Errorf("Failed to close listener: %v", err)
	}
	return port
}

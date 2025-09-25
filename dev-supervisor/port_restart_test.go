package main

import (
	"fmt"
	"net"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestPortReuseAfterRestart(t *testing.T) {
	// Create a temporary socket for this test
	tempDir := t.TempDir()
	socketPath := filepath.Join(tempDir, "test-supervisor.sock")

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
	if err := server.waitForServerReady(socketPath, false, 5*time.Second); err != nil {
		t.Fatalf("Server failed to start: %v", err)
	}

	// Find an available port for testing
	testPort := findAvailablePort(t)
	
	// Command that binds to a specific port (simulates a development server)
	testCommand := fmt.Sprintf("python3 -m http.server %d", testPort)

	t.Logf("Testing port reuse with command: %s", testCommand)

	// Start initial process
	startReq := ProcessStartRequest{
		Command:    testCommand,
		WorkingDir: tempDir,
	}

	if err := server.procMgr.Start(startReq); err != nil {
		t.Fatalf("Failed to start initial process: %v", err)
	}

	// Wait a moment for the process to fully start and bind to the port
	time.Sleep(500 * time.Millisecond)

	// Verify process is running and port is in use
	status := server.procMgr.GetStatus()
	if status.State != ProcessStateRunning {
		t.Fatalf("Process should be running, got: %s", status.State)
	}

	// Verify port is actually in use
	if isPortAvailable(testPort) {
		t.Fatalf("Port %d should be in use but appears available", testPort)
	}

	t.Logf("Initial process started successfully on port %d", testPort)

	// Perform rapid restarts to test for race conditions
	numRestarts := 10
	for i := 0; i < numRestarts; i++ {
		t.Logf("Performing restart %d/%d", i+1, numRestarts)
		
		restartStart := time.Now()
		
		// Restart with graceful shutdown
		if err := server.procMgr.Restart(ProcessRestartRequest{Graceful: true}); err != nil {
			t.Fatalf("Restart %d failed: %v", i+1, err)
		}

		restartDuration := time.Since(restartStart)
		t.Logf("Restart %d completed in %v", i+1, restartDuration)

		// Verify process is running after restart
		status = server.procMgr.GetStatus()
		if status.State != ProcessStateRunning {
			t.Fatalf("Process should be running after restart %d, got: %s", i+1, status.State)
		}

		// Verify the port is still in use (process successfully rebound)
		if isPortAvailable(testPort) {
			t.Fatalf("Port %d should still be in use after restart %d", testPort, i+1)
		}

		// Short delay between restarts to make test more realistic
		time.Sleep(100 * time.Millisecond)
	}

	t.Logf("All %d restarts completed successfully", numRestarts)

	// Clean up - stop the process
	if err := server.procMgr.Stop(ProcessStopRequest{Signal: "SIGTERM", Timeout: 10}); err != nil {
		t.Errorf("Failed to stop process: %v", err)
	}

	// Wait for port to be released
	timeout := time.After(5 * time.Second)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			t.Errorf("Port %d was not released within timeout", testPort)
			return
		case <-ticker.C:
			if isPortAvailable(testPort) {
				t.Logf("Port %d successfully released after process stop", testPort)
				return
			}
		}
	}
}

func TestConcurrentRestarts(t *testing.T) {
	// Create a temporary socket for this test
	tempDir := t.TempDir()
	socketPath := filepath.Join(tempDir, "test-supervisor-concurrent.sock")

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
		server.StartWithConfig(config)
	}()

	// Wait for server to be ready
	if err := server.waitForServerReady(socketPath, false, 5*time.Second); err != nil {
		t.Fatalf("Server failed to start: %v", err)
	}

	// Find an available port for testing
	testPort := findAvailablePort(t)
	testCommand := fmt.Sprintf("python3 -c 'import http.server; import socketserver; handler = http.server.SimpleHTTPRequestHandler; httpd = socketserver.TCPServer((\"\", %d), handler); httpd.serve_forever()'", testPort)

	// Start initial process
	startReq := ProcessStartRequest{
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

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(goroutineID int) {
			defer wg.Done()
			
			for j := 0; j < numRestartsPerGoroutine; j++ {
				err := server.procMgr.Restart(ProcessRestartRequest{Graceful: true})
				
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
	if status.State != ProcessStateRunning {
		t.Fatalf("Process should be running after concurrent restarts, got: %s", status.State)
	}

	// Clean up
	if err := server.procMgr.Stop(ProcessStopRequest{Signal: "SIGTERM", Timeout: 10}); err != nil {
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
			req := ProcessStartRequest{
				Command:    "test command",
				WorkingDir: "/tmp",
				Ports:      tc.ports,
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
		if isPortAvailable(port) {
			return port
		}
	}
	t.Fatal("No available ports found for testing")
	return 0
}

// Benchmark the restart performance with port waiting
func BenchmarkRestartWithPortWait(b *testing.B) {
	// Setup
	tempDir := b.TempDir()
	socketPath := filepath.Join(tempDir, "bench-supervisor.sock")

	server := NewServer()
	config := &Config{
		SocketPath:             socketPath,
		ShutdownTimeout:        5 * time.Second,
		ProcessLogging:         false, // Disable logging for benchmark
		ProcessLoggingToStdout: false,
	}

	go func() {
		server.StartWithConfig(config)
	}()

	if err := server.waitForServerReady(socketPath, false, 5*time.Second); err != nil {
		b.Fatalf("Server failed to start: %v", err)
	}

	// Use a lightweight command for benchmarking
	testPort := findAvailablePortForBench(b)
	startReq := ProcessStartRequest{
		Command:    fmt.Sprintf("python3 -c 'import socket; s=socket.socket(); s.bind((\"\", %d)); s.listen(1); s.accept()'", testPort),
		WorkingDir: tempDir,
	}

	if err := server.procMgr.Start(startReq); err != nil {
		b.Fatalf("Failed to start initial process: %v", err)
	}

	time.Sleep(200 * time.Millisecond) // Let process start

	// Reset timer and run benchmark
	b.ResetTimer()
	
	for i := 0; i < b.N; i++ {
		if err := server.procMgr.Restart(ProcessRestartRequest{Graceful: true}); err != nil {
			b.Fatalf("Restart failed: %v", err)
		}
	}
	
	b.StopTimer()

	// Cleanup
	server.procMgr.Stop(ProcessStopRequest{Signal: "SIGKILL", Timeout: 5})
}

func findAvailablePortForBench(b *testing.B) int {
	listener, err := net.Listen("tcp", ":0")
	if err != nil {
		b.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	return port
}
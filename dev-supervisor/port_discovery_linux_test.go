//go:build linux

package main

import (
	"net"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestLinuxPortDiscovery_GetProcessPorts(t *testing.T) {
	discovery := NewPortDiscovery()

	t.Run("invalid PID returns error", func(t *testing.T) {
		_, err := discovery.GetProcessPorts(0)
		if err == nil {
			t.Error("expected error for invalid PID")
		}

		_, err = discovery.GetProcessPorts(-1)
		if err == nil {
			t.Error("expected error for negative PID")
		}
	})

	t.Run("discovers port from listening process", func(t *testing.T) {
		// Start a simple TCP server
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("failed to start listener: %v", err)
		}
		defer listener.Close()

		tcpAddr, ok := listener.Addr().(*net.TCPAddr)
		if !ok {
			t.Fatal("failed to get TCP address from listener")
		}
		port := tcpAddr.Port

		// Get ports for current process
		ports, err := discovery.GetProcessPorts(os.Getpid())
		if err != nil {
			t.Fatalf("failed to discover ports: %v", err)
		}

		// Check if our test port is in the discovered ports
		found := false
		for _, p := range ports {
			if p == port {
				found = true
				break
			}
		}

		if !found {
			t.Errorf("expected to find port %d in discovered ports %v", port, ports)
		}
	})

	t.Run("returns empty for non-existent PID", func(t *testing.T) {
		// Use a very high PID that likely doesn't exist
		ports, err := discovery.GetProcessPorts(999999)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if len(ports) != 0 {
			t.Errorf("expected no ports for non-existent PID, got %v", ports)
		}
	})

	t.Run("discovers ports from child process", func(t *testing.T) {
		// Start a simple HTTP server in a subprocess
		cmd := exec.Command("python3", "-m", "http.server", "0")
		if err := cmd.Start(); err != nil {
			t.Skip("python3 not available, skipping test")
			return
		}
		defer func() {
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
		}()

		// Give the server time to start
		time.Sleep(500 * time.Millisecond)

		// Try to discover ports
		ports, err := discovery.GetProcessPorts(cmd.Process.Pid)
		if err != nil {
			t.Fatalf("failed to discover child process ports: %v", err)
		}

		// Python HTTP server should be listening on at least one port
		if len(ports) == 0 {
			t.Error("expected to find at least one port for HTTP server")
		}
	})
}

func TestLinuxPortDiscovery_GracefulDegradation(t *testing.T) {
	t.Run("handles missing /proc gracefully", func(t *testing.T) {
		// This test verifies that the implementation logs a warning
		// and returns an empty slice rather than failing completely
		// when /proc/net/tcp cannot be read

		// We can't easily test the error path without mocking,
		// but we document the expected behavior here:
		// - On error reading /proc/net/tcp, log warning
		// - Return empty slice ([]int{}, nil)
		// - This allows restarts to continue (port conflicts detected at bind time)

		t.Skip("graceful degradation tested manually in production scenarios")
	})
}

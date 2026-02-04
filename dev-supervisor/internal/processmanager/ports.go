package processmanager

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"time"
)

const (
	defaultPortWaitTimeout = 10 * time.Second
	portCheckInterval      = 50 * time.Millisecond
)

// IsPortAvailable checks if a port is available for binding (i.e., not in use).
func IsPortAvailable(port int) bool {
	// Try to bind to 0.0.0.0 (all interfaces) to check if port is truly available.
	// This matches how servers typically bind and will fail if anything is using the port.
	//nolint:noctx // Port availability check, no request context available
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		// Can't bind - port is still in use.
		return false
	}
	// Successfully bound - port is available, close immediately.
	//nolint:gosec // G104: Intentionally ignoring error.
	listener.Close()
	return true
}

// waitForPortsAvailable waits for the specified ports to become available.
func waitForPortsAvailable(ports []int, timeout time.Duration) error {
	if len(ports) == 0 {
		return nil // No ports to wait for.
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	ticker := time.NewTicker(portCheckInterval)
	defer ticker.Stop()

	slog.Info("waiting for ports to become available", "ports", ports, "timeout", timeout)

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("timeout waiting for ports %v to become available after %v", ports, timeout)
		case <-ticker.C:
			allAvailable := true
			for _, port := range ports {
				if !IsPortAvailable(port) {
					allAvailable = false
					break
				}
			}
			if allAvailable {
				slog.Info("all ports now available", "ports", ports)
				return nil
			}
		}
	}
}

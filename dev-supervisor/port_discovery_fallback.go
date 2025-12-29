//go:build !linux

package main

import (
	"log/slog"
)

// FallbackPortDiscovery provides a no-op implementation for non-Linux platforms
type FallbackPortDiscovery struct{}

// NewPortDiscovery creates a platform-specific PortDiscovery implementation
func NewPortDiscovery() PortDiscovery {
	return &FallbackPortDiscovery{}
}

// GetProcessPorts returns an empty slice on non-Linux platforms
// Port waiting is an optimization; restarts work without it (fails fast at bind time)
func (d *FallbackPortDiscovery) GetProcessPorts(_ int) ([]int, error) {
	slog.Debug("port discovery not available on this platform, port waiting disabled")
	return []int{}, nil
}

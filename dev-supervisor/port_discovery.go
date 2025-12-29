package main

// PortDiscovery provides platform-specific port discovery capabilities
type PortDiscovery interface {
	// GetProcessPorts discovers what ports a process is actually using
	// Returns an empty slice if discovery is not available on this platform
	GetProcessPorts(pid int) ([]int, error)
}

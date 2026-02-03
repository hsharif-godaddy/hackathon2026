package ports

// Package ports provides platform-specific port discovery capabilities.
// It allows querying which TCP ports a running process is listening on,
// which is useful for process restart coordination.

// Discovery provides platform-specific port discovery capabilities
type Discovery interface {
	// GetProcessPorts discovers what ports a process is actually using
	// Returns an empty slice if discovery is not available on this platform
	GetProcessPorts(pid int) ([]int, error)
}

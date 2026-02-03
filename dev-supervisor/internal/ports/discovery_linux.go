//go:build linux

package ports

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// LinuxPortDiscovery implements port discovery using /proc filesystem
type LinuxPortDiscovery struct{}

// NewDiscovery creates a platform-specific Discovery implementation
func NewDiscovery() Discovery {
	return &LinuxPortDiscovery{}
}

// GetProcessPorts discovers what ports a process is actually using via /proc/net/tcp
func (d *LinuxPortDiscovery) GetProcessPorts(pid int) ([]int, error) {
	if pid <= 0 {
		return nil, fmt.Errorf("invalid PID: %d", pid)
	}

	// Read /proc/net/tcp to find listening ports for this process
	tcpFile := "/proc/net/tcp"
	content, err := os.ReadFile(tcpFile)
	if err != nil {
		// On error, log warning and return empty slice (graceful degradation)
		slog.Warn("failed to read /proc/net/tcp, port discovery unavailable", "error", err)
		return []int{}, nil
	}

	var ports []int
	lines := strings.Split(string(content), "\n")

	// Skip header line
	for i, line := range lines {
		if i == 0 || strings.TrimSpace(line) == "" {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 10 {
			continue
		}

		// Check if this entry belongs to our process
		// Field 9 is the inode, we need to check if our PID has this socket
		inode := fields[9]
		if inode == "0" {
			continue
		}

		// Check if this process owns this socket by looking in /proc/PID/fd/
		if d.processOwnsSocket(pid, inode) {
			// Parse the local address (field 1: "address:port" in hex)
			localAddr := fields[1]
			if colonIdx := strings.LastIndex(localAddr, ":"); colonIdx != -1 {
				portHex := localAddr[colonIdx+1:]
				if port, err := strconv.ParseInt(portHex, 16, 32); err == nil && port > 0 {
					ports = append(ports, int(port))
				}
			}
		}
	}

	return ports, nil
}

// processOwnsSocket checks if a process owns a socket by examining /proc/PID/fd/
func (d *LinuxPortDiscovery) processOwnsSocket(pid int, inode string) bool {
	fdDir := fmt.Sprintf("/proc/%d/fd", pid)
	entries, err := os.ReadDir(fdDir)
	if err != nil {
		return false
	}

	targetLink := fmt.Sprintf("socket:[%s]", inode)

	for _, entry := range entries {
		linkPath := filepath.Join(fdDir, entry.Name())
		if target, err := os.Readlink(linkPath); err == nil {
			if target == targetLink {
				return true
			}
		}
	}

	return false
}

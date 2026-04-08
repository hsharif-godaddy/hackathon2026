package checks

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"runtime"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

const hostsTarget = "local.gasket.dev-godaddy.com"

// HostsCheck verifies that /etc/hosts contains an entry mapping 127.0.0.1 to
// local.gasket.dev-godaddy.com. Skipped on WSL2 (where the hosts file is
// managed by Windows).
type HostsCheck struct{}

func (c *HostsCheck) Name() string     { return "Hosts Entry" }
func (c *HostsCheck) Category() string { return preflight.CategoryEnvironment }

func (c *HostsCheck) Run(_ context.Context, _ string) preflight.CheckResult {
	// Skip on Windows entirely.
	if runtime.GOOS == "windows" {
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "skipped on Windows",
		}
	}

	// Skip on WSL2 – the hosts file is owned by Windows.
	if isWSL2() {
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "skipped on WSL2",
		}
	}

	found, err := hostsEntryExists("/etc/hosts")
	if err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  fmt.Sprintf("could not read /etc/hosts: %v", err),
		}
	}

	if !found {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      fmt.Sprintf("/etc/hosts missing entry: 127.0.0.1 %s", hostsTarget),
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  fmt.Sprintf("127.0.0.1 %s present in /etc/hosts", hostsTarget),
	}
}

// hostsEntryExists scans the file at path for a non-comment line that contains
// both "127.0.0.1" and hostsTarget.
func hostsEntryExists(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		// Skip comment lines.
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.Contains(line, "127.0.0.1") && strings.Contains(line, hostsTarget) {
			return true, nil
		}
	}
	return false, scanner.Err()
}

// isWSL2 returns true when running inside a WSL2 environment.
func isWSL2() bool {
	data, err := os.ReadFile("/proc/version")
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(data)), "microsoft")
}

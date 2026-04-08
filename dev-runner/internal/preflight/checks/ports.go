package checks

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// PortCheck verifies that required ports are available.
type PortCheck struct {
	// Ports maps port number to service name (e.g. 3000 → "App").
	Ports map[int]string
}

func (c *PortCheck) Name() string     { return "Ports" }
func (c *PortCheck) Category() string { return preflight.CategoryServices }

func (c *PortCheck) Run(_ context.Context, _ string) preflight.CheckResult {
	var busy []string
	for port, name := range c.Ports {
		if preflight.IsPortInUse(port) {
			busy = append(busy, fmt.Sprintf("%d (%s)", port, name))
		}
	}

	if len(busy) > 0 {
		sort.Strings(busy)
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      fmt.Sprintf("in use: %s", strings.Join(busy, ", ")),
			FixAvailable: true,
		}
	}

	// Build port list dynamically from the map
	ports := make([]int, 0, len(c.Ports))
	for p := range c.Ports {
		ports = append(ports, p)
	}
	sort.Ints(ports)
	portStrs := make([]string, len(ports))
	for i, p := range ports {
		portStrs[i] = fmt.Sprintf("%d", p)
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  fmt.Sprintf("%s available", strings.Join(portStrs, ", ")),
	}
}

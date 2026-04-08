package fixers

import (
	"context"
	"fmt"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// PortsFixer kills processes occupying required ports.
type PortsFixer struct {
	Ports map[int]string // port → service name
}

func (f *PortsFixer) Fix(ctx context.Context, _ string) error {
	// Sort ports for deterministic ordering
	ports := make([]int, 0, len(f.Ports))
	for p := range f.Ports {
		ports = append(ports, p)
	}
	sort.Ints(ports)

	var failed []string
	for _, port := range ports {
		if !preflight.IsPortInUse(port) {
			continue
		}
		// lsof -ti :<port> returns PIDs
		out, err := exec.CommandContext(ctx, "lsof", "-ti", fmt.Sprintf(":%d", port)).Output()
		if err != nil || len(strings.TrimSpace(string(out))) == 0 {
			failed = append(failed, fmt.Sprintf("%d (could not find PID)", port))
			continue
		}
		pids := strings.Fields(strings.TrimSpace(string(out)))
		for _, pid := range pids {
			_ = exec.CommandContext(ctx, "kill", pid).Run()
		}
		// Brief wait then verify
		time.Sleep(500 * time.Millisecond)
		if preflight.IsPortInUse(port) {
			// Force kill
			for _, pid := range pids {
				_ = exec.CommandContext(ctx, "kill", "-9", pid).Run()
			}
			time.Sleep(300 * time.Millisecond)
			if preflight.IsPortInUse(port) {
				failed = append(failed, fmt.Sprintf("%d (kill failed)", port))
			}
		}
	}
	if len(failed) > 0 {
		return fmt.Errorf("could not free ports: %s", strings.Join(failed, ", "))
	}
	return nil
}

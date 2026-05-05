package checks

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// NodeVersionManagerCheck looks for a supported Node.js version manager.
type NodeVersionManagerCheck struct{}

func (c *NodeVersionManagerCheck) Name() string     { return "Node Version Manager" }
func (c *NodeVersionManagerCheck) Category() string { return preflight.CategoryTools }

func (c *NodeVersionManagerCheck) Run(_ context.Context, _ string) preflight.CheckResult {
	// Check binary-based managers first
	for _, m := range []string{"mise", "fnm", "asdf"} {
		if _, err := exec.LookPath(m); err == nil {
			return preflight.CheckResult{
				Status:   preflight.StatusPass,
				Name:     c.Name(),
				Category: c.Category(),
				Message:  fmt.Sprintf("%s found", m),
			}
		}
	}

	// nvm is a shell function, not a binary — check for NVM_DIR or ~/.nvm/nvm.sh
	if nvmInstalled() {
		return preflight.CheckResult{
			Status:   preflight.StatusPass,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "nvm found",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusWarn,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "no Node version manager found (mise, fnm, asdf, nvm)",
	}
}

// nvmInstalled checks if nvm is installed by looking for nvm.sh
// in $NVM_DIR or the default ~/.nvm location.
func nvmInstalled() bool {
	nvmDir := os.Getenv("NVM_DIR")
	if nvmDir != "" {
		if _, err := os.Stat(filepath.Join(nvmDir, "nvm.sh")); err == nil {
			return true
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return false
	}
	_, err = os.Stat(filepath.Join(home, ".nvm", "nvm.sh"))
	return err == nil
}

// NodeCheck verifies that node >= the required version is installed.
type NodeCheck struct{}

func (c *NodeCheck) Name() string     { return "Node.js" }
func (c *NodeCheck) Category() string { return preflight.CategoryTools }

func (c *NodeCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	reqMajor := readNvmrcMajor(projectRoot)
	if reqMajor == 0 {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  ".nvmrc not found or unreadable",
		}
	}

	out, err := exec.CommandContext(ctx, "node", "--version").Output()
	if err != nil {
		return preflight.CheckResult{
			Status:      preflight.StatusFail,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     "node not found",
			InstallHint: fmt.Sprintf("brew install node@%d", reqMajor),
		}
	}

	version := strings.TrimSpace(string(out))
	// node outputs "v22.16.0"
	version = strings.TrimPrefix(version, "v")

	major, _, _ := parseVersion(version)

	if major != reqMajor {
		return preflight.CheckResult{
			Status:      preflight.StatusFail,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     fmt.Sprintf("node %s found, need major version %d", version, reqMajor),
			InstallHint: fmt.Sprintf("brew install node@%d", reqMajor),
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  fmt.Sprintf("node %s", version),
	}
}

// readNvmrcMajor reads the major Node version from .nvmrc in the project root.
// Returns 0 if .nvmrc is missing or unparseable.
func readNvmrcMajor(projectRoot string) int {
	data, err := os.ReadFile(filepath.Join(projectRoot, ".nvmrc"))
	if err != nil {
		return 0
	}
	s := strings.TrimSpace(string(data))
	// .nvmrc may contain just "22" or "22.16.0" or "v22"
	s = strings.TrimPrefix(s, "v")
	if idx := strings.IndexByte(s, '.'); idx >= 0 {
		s = s[:idx]
	}
	major, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return major
}

// parseVersion splits a version string like "22.16.0" or "22.16.0-rc1" into
// (major, minor, patch). Returns (0, 0, 0) if the string cannot be parsed.
func parseVersion(v string) (major, minor, patch int) {
	// Strip any pre-release suffix (e.g. "-rc1")
	if idx := strings.IndexByte(v, '-'); idx >= 0 {
		v = v[:idx]
	}

	parts := strings.SplitN(v, ".", 3)
	if len(parts) < 3 {
		// Pad with zeros if needed
		for len(parts) < 3 {
			parts = append(parts, "0")
		}
	}

	major, _ = strconv.Atoi(parts[0])
	minor, _ = strconv.Atoi(parts[1])
	patch, _ = strconv.Atoi(parts[2])
	return
}

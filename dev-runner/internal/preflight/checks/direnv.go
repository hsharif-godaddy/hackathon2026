package checks

import (
	"context"
	"os"
	"os/exec"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// DirenvCheck verifies that direnv is installed and active in the current shell.
// direnv loads .envrc on directory entry, which activates the correct Node.js
// version and enables corepack. Without it, new terminal sessions won't get the
// right toolchain versions.
type DirenvCheck struct{}

func (c *DirenvCheck) Name() string     { return "direnv" }
func (c *DirenvCheck) Category() string { return preflight.CategoryTools }

func (c *DirenvCheck) Run(_ context.Context, _ string) preflight.CheckResult {
	_, err := exec.LookPath("direnv")
	if err != nil {
		return preflight.CheckResult{
			Status:      preflight.StatusWarn,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     "direnv not installed; new shells won't auto-load Node.js/pnpm",
			InstallHint: "brew install direnv  # then hook into your shell: https://direnv.net/docs/hook.html",
		}
	}

	if os.Getenv("DIRENV_DIR") == "" {
		return preflight.CheckResult{
			Status:      preflight.StatusWarn,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     "direnv hook not active or .envrc not allowed",
			InstallHint: "run: direnv allow  # if hook is missing, see https://direnv.net/docs/hook.html",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "installed and active",
	}
}

package checks

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// PnpmCheck verifies that pnpm matches the version in package.json's packageManager field.
type PnpmCheck struct{}

func (c *PnpmCheck) Name() string     { return "pnpm" }
func (c *PnpmCheck) Category() string { return preflight.CategoryTools }

func (c *PnpmCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	required := ReadPnpmVersion(projectRoot)
	if required == "" {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "packageManager not found in package.json",
		}
	}

	out, err := exec.CommandContext(ctx, "pnpm", "--version").Output()
	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "pnpm not found",
			FixAvailable: true,
		}
	}

	version := strings.TrimSpace(string(out))
	if version != required {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      fmt.Sprintf("pnpm %s found, need exactly %s", version, required),
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  fmt.Sprintf("pnpm %s", version),
	}
}

// ReadPnpmVersion extracts the pnpm version from the root package.json packageManager field.
// Returns empty string if not found.
func ReadPnpmVersion(projectRoot string) string {
	data, err := os.ReadFile(filepath.Join(projectRoot, "package.json"))
	if err != nil {
		return ""
	}
	var pkg struct {
		PackageManager string `json:"packageManager"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return ""
	}
	// Format: "pnpm@10.33.0+sha512...."
	if !strings.HasPrefix(pkg.PackageManager, "pnpm@") {
		return ""
	}
	ver := strings.TrimPrefix(pkg.PackageManager, "pnpm@")
	if idx := strings.Index(ver, "+"); idx >= 0 {
		ver = ver[:idx]
	}
	return ver
}

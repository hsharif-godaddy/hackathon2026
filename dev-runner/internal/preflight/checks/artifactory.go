package checks

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// ArtifactoryCheck verifies that ~/.npmrc contains authentication for
// GoDaddy Artifactory. Without this, pnpm install cannot fetch private
// @ux/* and other GoDaddy-scoped packages.
type ArtifactoryCheck struct{}

func (c *ArtifactoryCheck) Name() string     { return "Artifactory Auth" }
func (c *ArtifactoryCheck) Category() string { return preflight.CategoryTools }

func (c *ArtifactoryCheck) Run(_ context.Context, _ string) preflight.CheckResult {
	home, err := os.UserHomeDir()
	if err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "could not determine home directory",
		}
	}

	npmrcPath := filepath.Join(home, ".npmrc")
	data, err := os.ReadFile(npmrcPath)
	if err != nil {
		if os.IsNotExist(err) {
			return preflight.CheckResult{
				Status:       preflight.StatusFail,
				Name:         c.Name(),
				Category:     c.Category(),
				FixAvailable: true,
				Message:      "~/.npmrc not found — pnpm install will fail for private GoDaddy packages",
				InstallHint:  "pnpm login --registry https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/ --auth-type web",
			}
		}
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "could not read ~/.npmrc",
		}
	}

	if !strings.Contains(string(data), "gdartifactory1.jfrog.io") {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      "~/.npmrc has no Artifactory credentials — pnpm install will fail for private GoDaddy packages",
			InstallHint:  "pnpm login --registry https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/ --auth-type web",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "Artifactory credentials found in ~/.npmrc",
	}
}

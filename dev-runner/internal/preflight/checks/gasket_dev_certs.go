package checks

import (
	"context"
	"os"
	"path/filepath"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// GasketDevCertsCheck verifies that the @godaddy/gasket-plugin-dev-certs package
// is installed and contains the expected certificate files. These certs are used
// for TLS on preview/publish containers.
type GasketDevCertsCheck struct{}

func (c *GasketDevCertsCheck) Name() string     { return "Gasket Dev Certs" }
func (c *GasketDevCertsCheck) Category() string { return preflight.CategoryEnvironment }

func (c *GasketDevCertsCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	certsDir := filepath.Join(projectRoot, "app", "node_modules", "@godaddy",
		"gasket-plugin-dev-certs", "certs")

	requiredFiles := []string{
		"_.gasket.dev-godaddy.com.crt",
		"_.gasket.dev-godaddy.com.key",
		"_.gasket.dev-godaddy.com_intermediate_chain.crt",
	}

	for _, f := range requiredFiles {
		if _, err := os.Stat(filepath.Join(certsDir, f)); err != nil {
			return preflight.CheckResult{
				Status:      preflight.StatusFail,
				Name:        c.Name(),
				Category:    c.Category(),
				Message:     "Gasket dev certs not found -- run pnpm install: " + err.Error(),
				InstallHint: "pnpm install",
			}
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "Gasket dev certs present (GoDaddy-signed wildcard for *.gasket.dev-godaddy.com)",
	}
}

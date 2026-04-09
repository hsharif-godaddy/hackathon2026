package checks

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// DevCACheck verifies that the local development Certificate Authority
// files exist in .dev-ca/. Without these, locally generated apps cannot
// serve HTTPS without browser certificate warnings.
type DevCACheck struct{}

func (c *DevCACheck) Name() string     { return "Dev CA" }
func (c *DevCACheck) Category() string { return preflight.CategoryEnvironment }

func (c *DevCACheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	requiredFiles := []string{"ca-cert.pem", "ca-key.pem"}
	caDir := filepath.Join(projectRoot, ".dev-ca")

	var missing []string
	for _, f := range requiredFiles {
		if _, err := os.Stat(filepath.Join(caDir, f)); os.IsNotExist(err) {
			missing = append(missing, f)
		}
	}

	if len(missing) > 0 {
		msg := fmt.Sprintf(".dev-ca/ missing %s — local HTTPS will show certificate warnings", strings.Join(missing, ", "))
		fixable := hasMkcert()
		if !fixable {
			msg += fmt.Sprintf(" (install mkcert first: %s)", mkcertInstallHint())
		}
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: fixable,
			Message:      msg,
			InstallHint:  "./setup.sh",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "Development CA certificate present",
	}
}

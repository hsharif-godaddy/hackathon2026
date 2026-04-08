package checks

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// CertsCheck verifies that app/certificates/ exists and contains at least one
// certificate file (.pem, .crt, or .key).
type CertsCheck struct{}

func (c *CertsCheck) Name() string     { return "TLS Certificates" }
func (c *CertsCheck) Category() string { return preflight.CategoryEnvironment }

func (c *CertsCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	certsDir := filepath.Join(projectRoot, "app", "certificates")

	entries, err := os.ReadDir(certsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return preflight.CheckResult{
				Status:       preflight.StatusFail,
				Name:         c.Name(),
				Category:     c.Category(),
				Message:      "app/certificates/ directory not found",
				FixAvailable: true,
			}
		}
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  fmt.Sprintf("could not read app/certificates/: %v", err),
		}
	}

	certExts := map[string]bool{
		".pem": true,
		".crt": true,
		".key": true,
	}

	count := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if certExts[ext] {
			count++
		}
	}

	if count == 0 {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "app/certificates/ contains no .pem, .crt, or .key files",
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  fmt.Sprintf("app/certificates/ contains %d certificate file(s)", count),
	}
}

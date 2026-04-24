package checks

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/jfrog"
)

// ArtifactoryCheck verifies that ~/.npmrc contains a working authentication
// token for GoDaddy Artifactory. Without a valid token, pnpm install cannot
// fetch private @ux/* and other GoDaddy-scoped packages.
//
// Beyond just confirming credentials are present, this check actively probes
// Artifactory to catch expired or revoked tokens -- a common failure mode
// that otherwise only surfaces when pnpm install dies with a 401.
type ArtifactoryCheck struct{}

func (c *ArtifactoryCheck) Name() string     { return "Artifactory Auth" }
func (c *ArtifactoryCheck) Category() string { return preflight.CategoryTools }

const loginHint = "pnpm login --registry https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/ --auth-type web"

func (c *ArtifactoryCheck) Run(ctx context.Context, _ string) preflight.CheckResult {
	// Single read (no prior Stat) to avoid a TOCTOU window during
	// pnpm login's atomic write-then-rename of ~/.npmrc.
	token, err := jfrog.TokenFromNpmrc()
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return c.fail("~/.npmrc not found -- pnpm install will fail for private GoDaddy packages")
		}
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "could not read ~/.npmrc: " + err.Error(),
		}
	}
	if token == "" {
		return c.fail("~/.npmrc has no Artifactory _authToken -- pnpm install will fail for private GoDaddy packages")
	}

	if err := jfrog.Probe(ctx, token); err != nil {
		if errors.Is(err, jfrog.ErrUnauthorized) {
			return c.fail("Artifactory rejected the token in ~/.npmrc (expired or revoked) -- pnpm install will fail with 401")
		}
		// Anything else (timeout, DNS, TLS, 5xx, etc.) is inconclusive.
		// Surface the underlying error so a developer with e.g. a
		// corporate-MITM cert error doesn't chase phantom "offline"
		// causes.
		return preflight.CheckResult{
			Status:   preflight.StatusPass,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  fmt.Sprintf("Artifactory credentials found (probe inconclusive: %v)", err),
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "Artifactory credentials verified",
	}
}

func (c *ArtifactoryCheck) fail(msg string) preflight.CheckResult {
	return preflight.CheckResult{
		Status:       preflight.StatusFail,
		Name:         c.Name(),
		Category:     c.Category(),
		FixAvailable: true,
		Message:      msg,
		InstallHint:  loginHint,
	}
}

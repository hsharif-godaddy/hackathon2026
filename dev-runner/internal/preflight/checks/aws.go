package checks

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

const defaultAWSProfile = "airobuild-dev-private-sso"

// AWSCLICheck verifies that the AWS CLI is installed.
type AWSCLICheck struct{}

func (c *AWSCLICheck) Name() string     { return "AWS CLI" }
func (c *AWSCLICheck) Category() string { return preflight.CategoryTools }

func (c *AWSCLICheck) Run(ctx context.Context, _ string) preflight.CheckResult {
	out, err := exec.CommandContext(ctx, "aws", "--version").CombinedOutput()
	if err != nil {
		return preflight.CheckResult{
			Status:      preflight.StatusFail,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     "aws CLI not found",
			InstallHint: "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
		}
	}

	versionStr := strings.TrimSpace(string(out))

	// Output looks like: "aws-cli/2.15.0 Python/3.11.6 ..."
	// SSO session support requires AWS CLI v2.
	major := parseAWSMajorVersion(versionStr)
	if major < 2 {
		return preflight.CheckResult{
			Status:      preflight.StatusFail,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     fmt.Sprintf("aws CLI v1 found (%s), need v2+ for SSO support", versionStr),
			InstallHint: "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  versionStr,
	}
}

// parseAWSMajorVersion extracts the major version from "aws-cli/2.15.0 ...".
// Returns 0 if unparseable.
func parseAWSMajorVersion(output string) int {
	// Find the "aws-cli/X.Y.Z" token
	for _, token := range strings.Fields(output) {
		if strings.HasPrefix(token, "aws-cli/") {
			ver := strings.TrimPrefix(token, "aws-cli/")
			if idx := strings.IndexByte(ver, '.'); idx > 0 {
				major, _, _ := parseVersion(ver[:idx] + ".0.0")
				return major
			}
		}
	}
	return 0
}

// AWSSSOCheck verifies that the given AWS SSO profile is authenticated.
type AWSSSOCheck struct {
	// Profile is the AWS profile to check. Defaults to "airobuild-dev-private-sso".
	Profile string
}

func (c *AWSSSOCheck) Name() string     { return "AWS SSO" }
func (c *AWSSSOCheck) Category() string { return preflight.CategoryEnvironment }

func (c *AWSSSOCheck) profile() string {
	if c.Profile != "" {
		return c.Profile
	}
	return defaultAWSProfile
}

func (c *AWSSSOCheck) Run(ctx context.Context, _ string) preflight.CheckResult {
	profile := c.profile()
	err := exec.CommandContext(ctx, "aws", "sts", "get-caller-identity", "--profile", profile).Run()
	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      fmt.Sprintf("AWS SSO profile %q not authenticated", profile),
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  fmt.Sprintf("profile %q authenticated", profile),
	}
}

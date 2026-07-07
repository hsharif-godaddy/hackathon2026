package checks

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/awsconfig"
)

// AWSRoleCheck verifies that each resolved AWS SSO profile uses the expected
// sso_role_name. Everything in local dev assumes PowerUser; a different role
// (e.g. Ops) passes authentication but fails at runtime with opaque permission
// errors.
type AWSRoleCheck struct{}

func (c *AWSRoleCheck) Name() string     { return "AWS SSO Role" }
func (c *AWSRoleCheck) Category() string { return preflight.CategoryEnvironment }

func (c *AWSRoleCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	profiles := (&AWSSSOCheck{}).ResolveProfiles(projectRoot)

	configPath, err := awsconfig.ConfigPath()
	if err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  fmt.Sprintf("cannot determine home directory: %s", err),
		}
	}

	content, err := os.ReadFile(configPath)
	if err != nil {
		msg := fmt.Sprintf("~/.aws/config: %s", err)
		if errors.Is(err, os.ErrNotExist) {
			msg = "~/.aws/config not found"
		}
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  msg,
		}
	}

	configStr := string(content)
	for _, profile := range profiles {
		roleName := awsconfig.ProfileKey(configStr, profile, "sso_role_name")
		if roleName == "" {
			continue
		}
		if roleName != awsconfig.ExpectedRoleName {
			return preflight.CheckResult{
				Status:       preflight.StatusFail,
				Name:         c.Name(),
				Category:     c.Category(),
				Message:      fmt.Sprintf("profile %q has sso_role_name %q, expected %q", profile, roleName, awsconfig.ExpectedRoleName),
				FixAvailable: true,
			}
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  fmt.Sprintf("sso_role_name = %s", awsconfig.ExpectedRoleName),
	}
}

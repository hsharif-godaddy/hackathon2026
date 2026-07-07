package fixers

import (
	"context"
	"fmt"
	"os"

	"github.com/airo-ai-builder/dev-runner/internal/preflight/awsconfig"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/checks"
)

// AWSRoleFixer rewrites sso_role_name to PowerUser in ~/.aws/config for the
// profiles resolved from app/.env and agents/.env — the same set that
// AWSRoleCheck inspects.
type AWSRoleFixer struct{}

func (f *AWSRoleFixer) Fix(_ context.Context, projectRoot string) error {
	profiles := (&checks.AWSSSOCheck{}).ResolveProfiles(projectRoot)

	configPath, err := awsconfig.ConfigPath()
	if err != nil {
		return fmt.Errorf("getting config path: %w", err)
	}

	content, err := os.ReadFile(configPath)
	if err != nil {
		return fmt.Errorf("reading %s: %w", configPath, err)
	}

	configStr := string(content)
	changed := false
	for _, profile := range profiles {
		updated, ok := awsconfig.SetProfileKey(configStr, profile, "sso_role_name", awsconfig.ExpectedRoleName)
		if ok {
			configStr = updated
			changed = true
		}
	}

	if !changed {
		return fmt.Errorf("no sso_role_name found to fix in %s", configPath)
	}

	if err := os.WriteFile(configPath, []byte(configStr), 0600); err != nil {
		return fmt.Errorf("writing %s: %w", configPath, err)
	}
	return nil
}

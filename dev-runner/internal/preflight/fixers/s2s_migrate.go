package fixers

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// S2SMigrateFixer flips an existing agents/.env from GoCode api-key auth to
// S2S (IAM JWT) by delegating to EnvFixer with pre-populated values. It
// preserves AUTH_TYPE and AWS_PROFILE so the user isn't re-prompted via the
// TUI form.
type S2SMigrateFixer struct{}

func (f *S2SMigrateFixer) Fix(ctx context.Context, projectRoot string) error {
	envPath := filepath.Join(projectRoot, "agents/.env")
	env, err := preflight.ParseEnvFile(envPath)
	if err != nil {
		return fmt.Errorf("reading agents/.env: %w", err)
	}

	authType := strings.TrimSpace(env["AUTH_TYPE"])
	if authType == "" || authType == "none" {
		authType = "jwt"
	}
	awsProfile := strings.TrimSpace(env["AWS_PROFILE"])
	if awsProfile == "" {
		awsProfile = defaultAWSProfile
	}

	inner := &EnvFixer{
		Target: "agents",
		Values: &EnvValues{
			AuthType:   authType,
			AWSProfile: awsProfile,
			GoCodeAuth: "s2s",
		},
	}
	return inner.Fix(ctx, projectRoot)
}

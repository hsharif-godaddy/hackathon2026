package checks

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sts"

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

// AWSSSOCheck verifies that the AWS SSO profile(s) used by app and agents are
// authenticated. It reads AWS_PROFILE from both app/.env and agents/.env,
// deduplicates, and validates each with STS GetCallerIdentity.
type AWSSSOCheck struct{}

func (c *AWSSSOCheck) Name() string     { return "AWS SSO" }
func (c *AWSSSOCheck) Category() string { return preflight.CategoryEnvironment }

func (c *AWSSSOCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	profiles := c.resolveProfiles(projectRoot)

	for _, profile := range profiles {
		cfg, err := awsconfig.LoadDefaultConfig(ctx,
			awsconfig.WithRegion("us-west-2"),
			awsconfig.WithSharedConfigProfile(profile),
		)
		if err != nil {
			return preflight.CheckResult{
				Status:       preflight.StatusFail,
				Name:         c.Name(),
				Category:     c.Category(),
				Message:      fmt.Sprintf("AWS SSO profile %q: failed to load config: %s", profile, err),
				FixAvailable: true,
			}
		}

		client := sts.NewFromConfig(cfg)
		_, err = client.GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
		if err != nil {
			return preflight.CheckResult{
				Status:       preflight.StatusFail,
				Name:         c.Name(),
				Category:     c.Category(),
				Message:      fmt.Sprintf("AWS SSO session expired for profile %q (run: aws sso login --profile %s)", profile, profile),
				FixAvailable: true,
			}
		}
	}

	msg := fmt.Sprintf("profile %q authenticated", profiles[0])
	if len(profiles) > 1 {
		msg = fmt.Sprintf("profiles %q authenticated", profiles)
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  msg,
	}
}

// resolveProfiles reads AWS_PROFILE from app/.env and agents/.env, returning
// a deduplicated list. Falls back to the default profile if neither file exists.
func (c *AWSSSOCheck) resolveProfiles(projectRoot string) []string {
	seen := make(map[string]bool)
	var profiles []string

	for _, rel := range []string{"app/.env", "agents/.env"} {
		env, err := preflight.ParseEnvFile(filepath.Join(projectRoot, rel))
		if err != nil {
			continue
		}
		if p := strings.TrimSpace(env["AWS_PROFILE"]); p != "" && !seen[p] {
			seen[p] = true
			profiles = append(profiles, p)
		}
	}

	if len(profiles) == 0 {
		return []string{defaultAWSProfile}
	}
	return profiles
}

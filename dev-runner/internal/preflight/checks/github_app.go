package checks

import (
	"context"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// GitHubAppCheck verifies that GitHub App OAuth credentials are configured
// in app/.env and that ENABLE_GIT_REMOTE_SYNC=true is set in agents/.env
// for the GitHub sync feature. Optional — the feature is gated behind a
// Switchboard flag, so missing vars are a soft warning, not a failure.
//
// In production, the git-remote capability is controlled by the
// CODE_SYNC_GIT_PUSH entry in /alloc/config.json (Nomad alloc config).
// Locally there is no alloc config, so ENABLE_GIT_REMOTE_SYNC=true in
// agents/.env acts as the equivalent gate.
type GitHubAppCheck struct{}

func (c *GitHubAppCheck) Name() string     { return "GitHub App" }
func (c *GitHubAppCheck) Category() string { return preflight.CategoryEnvironment }

func (c *GitHubAppCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	var warnings []string

	appEnv, err := preflight.ParseEnvFile(filepath.Join(projectRoot, "app", ".env"))
	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      "app/.env not found; GitHub App credentials need to be fetched after env setup",
		}
	}

	for _, key := range []string{
		"GITHUB_APP_CLIENT_ID",
		"GITHUB_APP_CLIENT_SECRET",
		"GITHUB_APP_SLUG",
	} {
		if appEnv[key] == "" {
			warnings = append(warnings, key+" in app/.env")
		}
	}

	agentsEnv, err := preflight.ParseEnvFile(filepath.Join(projectRoot, "agents", ".env"))
	if err == nil {
		if !strings.EqualFold(strings.TrimSpace(agentsEnv["ENABLE_GIT_REMOTE_SYNC"]), "true") {
			warnings = append(warnings, "ENABLE_GIT_REMOTE_SYNC=true in agents/.env")
		}
	}

	if len(warnings) > 0 {
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "GitHub sync feature requires: " + joinMissing(warnings),
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "GitHub App credentials and git sync flag configured",
	}
}

func joinMissing(keys []string) string {
	result := ""
	for i, k := range keys {
		if i > 0 {
			result += ", "
		}
		result += k
	}
	return result
}

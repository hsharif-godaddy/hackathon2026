package checks

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// E2EEnvPrefixes mirrors the prefixes recognised by tests/helpers/constants.ts —
// any one configured pair is enough for the test harness to pick credentials.
var E2EEnvPrefixes = []string{"E2E", "TEST", "DEV", "PROD", "LOCAL", "PRE_TEST"}

// E2ECheck verifies the prerequisites for running Playwright E2E tests:
// tests/.env contains a non-empty USERNAME/PASSWORD pair for at least one of
// the recognised env prefixes, and Playwright browser binaries are installed.
type E2ECheck struct{}

func (c *E2ECheck) Name() string     { return "E2E (Playwright)" }
func (c *E2ECheck) Category() string { return preflight.CategoryEnvironment }

func (c *E2ECheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	envPath := filepath.Join(projectRoot, "tests", ".env")
	hasCreds, credErr := HasE2ECredentialPair(envPath)
	if credErr != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "could not read tests/.env: " + credErr.Error(),
		}
	}

	hasBrowsers, browserErr := PlaywrightBrowsersInstalled()
	if browserErr != nil {
		// Distinguish "cache dir unlocatable" from "browsers genuinely
		// missing". Without this, a misconfigured $HOME triggers a multi-GB
		// playwright re-install on every fix attempt because the fixer
		// re-checks via the same function.
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "could not locate Playwright cache dir: " + browserErr.Error(),
		}
	}

	switch {
	case !hasCreds && !hasBrowsers:
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "tests/.env credentials missing and Playwright browsers not installed",
			FixAvailable: true,
		}
	case !hasCreds:
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "tests/.env has no USERNAME/PASSWORD pair (need one of E2E_*, TEST_*, etc.)",
			FixAvailable: true,
		}
	case !hasBrowsers:
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "Playwright browser binaries not installed (~/.cache/ms-playwright)",
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "tests/.env configured, Playwright browsers installed",
	}
}

// HasE2ECredentialPair reports whether the env file at path contains a
// non-whitespace USERNAME/PASSWORD pair for any prefix in E2EEnvPrefixes.
// Missing files are treated as "no creds" with no error — matches the
// `[[ -f "$file" ]] || return 1` early-exit in scripts/setup-e2e.sh.
func HasE2ECredentialPair(path string) (bool, error) {
	env, err := preflight.ParseEnvFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	for _, prefix := range E2EEnvPrefixes {
		username := strings.TrimSpace(env[prefix+"_USERNAME"])
		password := strings.TrimSpace(env[prefix+"_PASSWORD"])
		if username != "" && password != "" {
			return true, nil
		}
	}
	return false, nil
}

// PlaywrightBrowsersInstalled reports whether the user-cache Playwright
// directory contains at least one chromium build. We don't gate on a specific
// version — Playwright manages compatibility itself, and any chromium dir
// means `pnpm exec playwright install` has run at least once.
//
// Returns (false, err) only when the user cache dir itself can't be located
// (e.g., $HOME unset). A missing/empty ms-playwright subdir is a normal
// "not installed yet" case and returns (false, nil) so the caller can offer
// the fix without surfacing a confusing error.
func PlaywrightBrowsersInstalled() (bool, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return false, err
	}
	entries, err := os.ReadDir(filepath.Join(cacheDir, "ms-playwright"))
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	for _, e := range entries {
		if e.IsDir() && strings.HasPrefix(e.Name(), "chromium-") {
			return true, nil
		}
	}
	return false, nil
}

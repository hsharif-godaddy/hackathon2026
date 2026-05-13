package fixers

import (
	"context"
	"fmt"

	"github.com/airo-ai-builder/dev-runner/internal/preflight/checks"
)

// EnsurePlaywrightBrowsers runs `pnpm exec playwright install chromium` when
// the user cache has no chromium browser yet. Idempotent; skipped when a
// chromium-* directory already exists under ms-playwright (matches
// checks.PlaywrightBrowsersInstalled).
func EnsurePlaywrightBrowsers(ctx context.Context, projectRoot string) error {
	hasBrowsers, err := checks.PlaywrightBrowsersInstalled()
	if err != nil {
		return fmt.Errorf("playwright cache: %w", err)
	}
	if hasBrowsers {
		return nil
	}
	out, err := RunCommand(ctx, projectRoot, "pnpm", "exec", "playwright", "install", "chromium")
	if err != nil {
		if out != "" {
			return fmt.Errorf("playwright install chromium: %w\n%s", err, out)
		}
		return fmt.Errorf("playwright install chromium: %w", err)
	}
	return nil
}

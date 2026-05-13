package checks

import (
	"context"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// EvalProbePlaywrightCheck verifies that Playwright Chromium is installed for
// gosym-probe DOM capture.
type EvalProbePlaywrightCheck struct{}

func (c *EvalProbePlaywrightCheck) Name() string     { return "Eval Probe Playwright" }
func (c *EvalProbePlaywrightCheck) Category() string { return preflight.CategoryEnvironment }

func (c *EvalProbePlaywrightCheck) Run(_ context.Context, _ string) preflight.CheckResult {
	hasBrowsers, err := PlaywrightBrowsersInstalled()
	if err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "could not locate Playwright cache dir: " + err.Error(),
		}
	}
	if !hasBrowsers {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "Playwright Chromium not installed for gosym-probe DOM capture",
			FixAvailable: true,
		}
	}
	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "Playwright Chromium installed for gosym-probe DOM capture",
	}
}

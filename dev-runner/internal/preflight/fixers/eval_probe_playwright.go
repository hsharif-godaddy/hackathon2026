package fixers

import "context"

// EvalProbePlaywrightFixer installs Playwright Chromium for gosym-probe.
type EvalProbePlaywrightFixer struct{}

func (f *EvalProbePlaywrightFixer) Fix(ctx context.Context, projectRoot string) error {
	return EnsurePlaywrightBrowsers(ctx, projectRoot)
}

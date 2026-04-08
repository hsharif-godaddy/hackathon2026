package fixers

import (
	"context"
	"fmt"

	"github.com/airo-ai-builder/dev-runner/internal/preflight/checks"
)

// PnpmFixer enables corepack and activates the required pnpm version.
type PnpmFixer struct{}

func (f *PnpmFixer) Fix(ctx context.Context, projectRoot string) error {
	if _, err := RunCommand(ctx, projectRoot, "corepack", "enable"); err != nil {
		return err
	}

	version := checks.ReadPnpmVersion(projectRoot)
	if version == "" {
		return fmt.Errorf("packageManager not found in package.json")
	}

	_, err := RunCommand(ctx, projectRoot, "corepack", "prepare", fmt.Sprintf("pnpm@%s", version), "--activate")
	return err
}

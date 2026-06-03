package fixers

import (
	"context"
	"fmt"
)

// GasketDevCertsFixer reinstalls dependencies so the bundled certs under
// app/node_modules/@godaddy/gasket-plugin-dev-certs/certs reappear.
//
// Preflight runs before the pre-start hooks, so a fresh checkout (or a
// --clean-all that wipes node_modules) lands at the dashboard before
// `pnpm install` has had a chance to run. This fixer just runs install
// at the repo root — pnpm rehydrates every workspace and the certs
// package comes back with it.
type GasketDevCertsFixer struct{}

func (f *GasketDevCertsFixer) Fix(ctx context.Context, projectRoot string) error {
	out, err := RunCommand(ctx, projectRoot, "pnpm", "install")
	if err != nil {
		if out != "" {
			return fmt.Errorf("pnpm install: %w\n%s", err, out)
		}
		return fmt.Errorf("pnpm install: %w", err)
	}
	return nil
}

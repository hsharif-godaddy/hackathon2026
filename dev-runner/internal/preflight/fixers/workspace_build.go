package fixers

import (
	"context"
	"fmt"

	"github.com/airo-ai-builder/dev-runner/internal/preflight/checks"
)

// WorkspaceBuildFixer builds the internal library packages dev requires so
// their dist/ output exists for the app and agents to consume. It drives Turbo
// (filtered to the dev dependency closure discovered by checks.devDistPackages)
// rather than the root `pnpm build` script so it builds the libraries in
// dependency order without also running the apps' production builds (a full
// Next build is slow and unnecessary for dev). Turbo caches per-package, so
// already-built libs return instantly and only the missing dist/ output is
// produced.
//
// Approach contributed by Ying Han (yhan1-godaddy) in PR review.
type WorkspaceBuildFixer struct{}

func (f *WorkspaceBuildFixer) Fix(ctx context.Context, projectRoot string) error {
	// turbo is a workspace-local binary, so node_modules must exist before
	// `pnpm exec turbo` can resolve it — and preflight fixers run before the
	// preStart install hook.
	if err := EnsurePnpmInstall(ctx, projectRoot); err != nil {
		return err
	}

	pkgs, err := checks.DevDistPackageNames(projectRoot)
	if err != nil {
		return fmt.Errorf("resolving workspace packages to build: %w", err)
	}
	if len(pkgs) == 0 {
		return nil
	}

	// pnpm exec resolves the workspace-local turbo binary; a raw `turbo`
	// invocation would rely on node_modules/.bin being on PATH, which it is
	// not when we exec outside a pnpm script context. Build only the dev
	// dependency closure; Turbo pulls each package's ^build deps in order.
	args := []string{"exec", "turbo", "run", "build"}
	for _, name := range pkgs {
		args = append(args, "--filter="+name)
	}
	if out, err := RunCommand(ctx, projectRoot, "pnpm", args...); err != nil {
		return fmt.Errorf("building workspace packages: %w\n%s", err, out)
	}
	return nil
}

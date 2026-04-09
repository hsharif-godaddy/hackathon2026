package fixers

import (
	"context"
)

const artifactoryRegistry = "https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/"

// ArtifactoryFixer authenticates with GoDaddy Artifactory via pnpm login.
// This adds the auth token to ~/.npmrc and sets up the registry.
// pnpm login prompts for Enter before opening the browser, so this fixer
// needs terminal access.
type ArtifactoryFixer struct{}

func (f *ArtifactoryFixer) NeedsTerminal() bool { return true }

func (f *ArtifactoryFixer) Fix(ctx context.Context, projectRoot string) error {
	return RunCommandPassthrough(ctx, projectRoot, "pnpm", "login", "--registry", artifactoryRegistry, "--auth-type", "web")
}

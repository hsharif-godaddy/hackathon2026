package fixers

import (
	"context"
)

const artifactoryRegistry = "https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/"

// ArtifactoryFixer authenticates with GoDaddy Artifactory via pnpm login.
// This adds the auth token to ~/.npmrc and sets up the registry.
type ArtifactoryFixer struct{}

func (f *ArtifactoryFixer) Fix(ctx context.Context, projectRoot string) error {
	return RunCommandInteractive(ctx, projectRoot, nil, "pnpm", "login", "--registry", artifactoryRegistry, "--auth-type", "web")
}

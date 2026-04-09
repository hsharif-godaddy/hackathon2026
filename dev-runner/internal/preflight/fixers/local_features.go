package fixers

import (
	"context"
	"fmt"
	"path/filepath"
)

// LocalFeaturesFixer sets NEXT_PUBLIC_ENABLE_LOCAL_FEATURES=true in app/.env
// so that switchboard feature flag overrides apply during local development.
type LocalFeaturesFixer struct{}

func (f *LocalFeaturesFixer) Fix(_ context.Context, projectRoot string) error {
	appEnvPath := filepath.Join(projectRoot, "app", ".env")

	if err := upsertEnvVar(appEnvPath, "NEXT_PUBLIC_ENABLE_LOCAL_FEATURES", "true"); err != nil {
		return fmt.Errorf("setting NEXT_PUBLIC_ENABLE_LOCAL_FEATURES: %w", err)
	}

	return nil
}

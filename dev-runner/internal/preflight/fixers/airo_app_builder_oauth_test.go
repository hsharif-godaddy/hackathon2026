package fixers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAiroAppBuilderOAuthFixer_UsesEnvironmentSecretWhenPresent(t *testing.T) {
	root := t.TempDir()
	t.Setenv("AIRO_APP_BUILDER_CLIENT_SECRET", "env-secret")

	if err := (&AiroAppBuilderOAuthFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() error = %v", err)
	}

	content, err := os.ReadFile(filepath.Join(root, "app", ".env"))
	if err != nil {
		t.Fatal(err)
	}
	got := string(content)
	if !strings.Contains(got, `AIRO_APP_BUILDER_CLIENT_ID="`+airoAppBuilderClientID+`"`) {
		t.Fatalf("expected client id in app/.env, got:\n%s", got)
	}
	if !strings.Contains(got, `AIRO_APP_BUILDER_CLIENT_SECRET="env-secret"`) {
		t.Fatalf("expected env secret in app/.env, got:\n%s", got)
	}
}

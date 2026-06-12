package fixers

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestGitHubAppFixer_UsesEnvironmentSecretsWhenPresent(t *testing.T) {
	root := t.TempDir()
	t.Setenv("GITHUB_APP_CLIENT_ID", "env-client-id")
	t.Setenv("GITHUB_APP_CLIENT_SECRET", "env-client-secret")

	if err := (&GitHubAppFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() error = %v", err)
	}

	appEnv, err := preflight.ParseEnvFile(filepath.Join(root, "app", ".env"))
	if err != nil {
		t.Fatalf("ParseEnvFile(app/.env) error = %v", err)
	}
	if appEnv["GITHUB_APP_SLUG"] != githubAppSlug {
		t.Fatalf("GITHUB_APP_SLUG = %q, want %q", appEnv["GITHUB_APP_SLUG"], githubAppSlug)
	}
	if appEnv["GITHUB_APP_CLIENT_ID"] != "env-client-id" {
		t.Fatalf("GITHUB_APP_CLIENT_ID = %q, want %q", appEnv["GITHUB_APP_CLIENT_ID"], "env-client-id")
	}
	if appEnv["GITHUB_APP_CLIENT_SECRET"] != "env-client-secret" {
		t.Fatalf("GITHUB_APP_CLIENT_SECRET = %q, want %q", appEnv["GITHUB_APP_CLIENT_SECRET"], "env-client-secret")
	}

	agentsEnv, err := preflight.ParseEnvFile(filepath.Join(root, "agents", ".env"))
	if err != nil {
		t.Fatalf("ParseEnvFile(agents/.env) error = %v", err)
	}
	if agentsEnv["ENABLE_GIT_REMOTE_SYNC"] != "true" {
		t.Fatalf("ENABLE_GIT_REMOTE_SYNC = %q, want %q", agentsEnv["ENABLE_GIT_REMOTE_SYNC"], "true")
	}
}

func TestGitHubAppFixer_UpsertsIntoExistingEnv(t *testing.T) {
	root := t.TempDir()
	t.Setenv("GITHUB_APP_CLIENT_ID", "new-id")
	t.Setenv("GITHUB_APP_CLIENT_SECRET", "new-secret")

	appDir := filepath.Join(root, "app")
	agentsDir := filepath.Join(root, "agents")
	os.MkdirAll(appDir, 0o755)
	os.MkdirAll(agentsDir, 0o755)

	os.WriteFile(filepath.Join(appDir, ".env"), []byte(
		"NODE_ENV=development\nGITHUB_APP_CLIENT_ID=\"stale-id\"\nSOME_OTHER_VAR=keep-me\n",
	), 0o644)
	os.WriteFile(filepath.Join(agentsDir, ".env"), []byte(
		"OPENAI_API_KEY=sk-test\nENABLE_GIT_REMOTE_SYNC=false\n",
	), 0o644)

	if err := (&GitHubAppFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() error = %v", err)
	}

	appEnv, err := preflight.ParseEnvFile(filepath.Join(appDir, ".env"))
	if err != nil {
		t.Fatalf("ParseEnvFile(app/.env) error = %v", err)
	}
	if appEnv["GITHUB_APP_CLIENT_ID"] != "new-id" {
		t.Fatalf("GITHUB_APP_CLIENT_ID = %q, want %q", appEnv["GITHUB_APP_CLIENT_ID"], "new-id")
	}
	if appEnv["GITHUB_APP_CLIENT_SECRET"] != "new-secret" {
		t.Fatalf("GITHUB_APP_CLIENT_SECRET = %q, want %q", appEnv["GITHUB_APP_CLIENT_SECRET"], "new-secret")
	}
	if appEnv["GITHUB_APP_SLUG"] != githubAppSlug {
		t.Fatalf("GITHUB_APP_SLUG = %q, want %q", appEnv["GITHUB_APP_SLUG"], githubAppSlug)
	}
	if appEnv["NODE_ENV"] != "development" {
		t.Fatalf("NODE_ENV = %q, want %q (unrelated key clobbered)", appEnv["NODE_ENV"], "development")
	}
	if appEnv["SOME_OTHER_VAR"] != "keep-me" {
		t.Fatalf("SOME_OTHER_VAR = %q, want %q (unrelated key clobbered)", appEnv["SOME_OTHER_VAR"], "keep-me")
	}

	agentsEnv, err := preflight.ParseEnvFile(filepath.Join(agentsDir, ".env"))
	if err != nil {
		t.Fatalf("ParseEnvFile(agents/.env) error = %v", err)
	}
	if agentsEnv["ENABLE_GIT_REMOTE_SYNC"] != "true" {
		t.Fatalf("ENABLE_GIT_REMOTE_SYNC = %q, want %q", agentsEnv["ENABLE_GIT_REMOTE_SYNC"], "true")
	}
	if agentsEnv["OPENAI_API_KEY"] != "sk-test" {
		t.Fatalf("OPENAI_API_KEY = %q, want %q (unrelated key clobbered)", agentsEnv["OPENAI_API_KEY"], "sk-test")
	}
}

package checks

import (
	"context"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestCheckEnvFile_Missing(t *testing.T) {
	dir := t.TempDir()
	// Use a project root where the env file definitely does not exist.
	result, _ := checkEnvFile(dir, "app/.env", []string{"NODE_ENV"}, "Test Check", "Environment")

	if result.Status != preflight.StatusFail {
		t.Errorf("expected StatusFail for missing file, got %v", result.Status)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true for missing file")
	}
}

func TestAgentsEnvCheck_S2SMode_NoAPIKeyRequired(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, strings.Join([]string{
		"NODE_ENV=development",
		"AUTH_TYPE=jwt",
		"GOCODE_USE_S2S_AUTH=true",
		"AWS_PROFILE=airobuild-dev-private-sso",
	}, "\n"))

	c := &AgentsEnvCheck{}
	result := c.Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Fatalf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestAgentsEnvCheck_APIKeyMode_RequiresOpenAIKey(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, strings.Join([]string{
		"NODE_ENV=development",
		"AUTH_TYPE=jwt",
		"AWS_PROFILE=airobuild-dev-private-sso",
	}, "\n"))

	c := &AgentsEnvCheck{}
	result := c.Run(context.Background(), root)
	if result.Status == preflight.StatusPass {
		t.Fatalf("expected failure in api-key mode, got Pass")
	}
	if !strings.Contains(result.Message, "OPENAI_API_KEY") {
		t.Fatalf("expected message to list OPENAI_API_KEY missing, got: %s", result.Message)
	}
}

func TestAgentsEnvCheck_S2SMode_StaleApiKeyVars(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, strings.Join([]string{
		"NODE_ENV=development",
		"AUTH_TYPE=jwt",
		"GOCODE_USE_S2S_AUTH=true",
		"AWS_PROFILE=airobuild-dev-private-sso",
		`OPENAI_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"`,
		`OPENAI_API_KEY="sk-stale"`,
	}, "\n"))

	c := &AgentsEnvCheck{}
	result := c.Run(context.Background(), root)
	if result.Status == preflight.StatusPass {
		t.Fatalf("expected failure with stale api-key vars in s2s mode, got Pass")
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true for stale s2s config")
	}
	if !strings.Contains(result.Message, "OPENAI_BASE_URL") {
		t.Fatalf("expected message to list stale OPENAI_BASE_URL, got: %s", result.Message)
	}
}

func TestAgentsEnvCheck_S2SMode_MissingAwsProfile(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, strings.Join([]string{
		"NODE_ENV=development",
		"AUTH_TYPE=jwt",
		"GOCODE_USE_S2S_AUTH=true",
	}, "\n"))

	c := &AgentsEnvCheck{}
	result := c.Run(context.Background(), root)
	if result.Status == preflight.StatusPass {
		t.Fatalf("expected failure when AWS_PROFILE missing, got Pass")
	}
	if !strings.Contains(result.Message, "AWS_PROFILE") {
		t.Fatalf("expected message to list AWS_PROFILE missing, got: %s", result.Message)
	}
}

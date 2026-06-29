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
		"USE_S2S_AUTH=true",
		"S2S_AWS_PROFILE=airobuild-dev-private-sso",
		"AWS_PROFILE=airobuild-dev-private-sso",
		"OPENAI_BASE_URL=https://api.gocode.caas.gdcorp.tools/v1",
		"BUDGET_SERVICE_URL=https://budget-service.api.int.dev-godaddy.com",
	}, "\n"))

	c := &AgentsEnvCheck{}
	result := c.Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Fatalf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestAgentsEnvCheck_S2SMode_MissingUseS2SAuth(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, strings.Join([]string{
		"NODE_ENV=development",
		"AUTH_TYPE=jwt",
		"GOCODE_USE_S2S_AUTH=true",
		"AWS_PROFILE=airobuild-dev-private-sso",
		"BUDGET_SERVICE_URL=https://budget-service.api.int.dev-godaddy.com",
	}, "\n"))

	c := &AgentsEnvCheck{}
	result := c.Run(context.Background(), root)
	if result.Status == preflight.StatusPass {
		t.Fatal("expected failure when USE_S2S_AUTH and S2S_AWS_PROFILE missing in S2S mode")
	}
	if !strings.Contains(result.Message, "USE_S2S_AUTH") {
		t.Errorf("expected message to mention USE_S2S_AUTH, got: %s", result.Message)
	}
	if !strings.Contains(result.Message, "S2S_AWS_PROFILE") {
		t.Errorf("expected message to mention S2S_AWS_PROFILE, got: %s", result.Message)
	}
}

func TestAppLocalEnvCheck_MissingFiles(t *testing.T) {
	root := t.TempDir()

	c := &AppLocalEnvCheck{}
	result := c.Run(context.Background(), root)
	if result.Status == preflight.StatusPass {
		t.Fatalf("expected failure when app/.env.local.* files are missing, got Pass")
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true when local env files are missing")
	}
}

func TestAppLocalEnvCheck_MissingSSOHost(t *testing.T) {
	root := t.TempDir()
	// Seed files without SSO_HOST
	for _, envName := range []string{"dev", "test", "prod"} {
		writeLocalEnvFile(t, root, "app", envName, "NEXT_PUBLIC_APP_URL=https://example.com\n")
	}

	c := &AppLocalEnvCheck{}
	result := c.Run(context.Background(), root)
	if result.Status == preflight.StatusPass {
		t.Fatalf("expected failure when SSO_HOST missing, got Pass")
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true when SSO_HOST missing")
	}
	if !strings.Contains(result.Message, "SSO_HOST") {
		t.Fatalf("expected message to mention SSO_HOST, got: %s", result.Message)
	}
}

// Regression test: a hand-edit that points .env.local.dev at the TEST SSO
// host should be flagged and fixed, not silently accepted. Reported by the
// user after manually setting SSO_HOST=sso.test-godaddy.com in .env.local.dev.
//
// Also guards the accumulate-all behavior: we seed TWO wrong files (dev and
// test) and assert both appear in the message so a fail-fast regression
// would break the test.
func TestAppLocalEnvCheck_WrongSSOHostForEnv(t *testing.T) {
	root := t.TempDir()
	writeLocalEnvFile(t, root, "app", "dev", "SSO_HOST=sso.test-godaddy.com\n") // wrong: dev should be sso.dev-godaddy.com
	writeLocalEnvFile(t, root, "app", "test", "SSO_HOST=sso.godaddy.com\n")     // wrong: test should be sso.test-godaddy.com
	writeLocalEnvFile(t, root, "app", "prod", "SSO_HOST=sso.godaddy.com\n")     // correct

	c := &AppLocalEnvCheck{}
	result := c.Run(context.Background(), root)
	if result.Status == preflight.StatusPass {
		t.Fatalf("expected failure when .env.local.{dev,test} have wrong SSO_HOST, got Pass")
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true when SSO_HOST is wrong")
	}
	if !strings.Contains(result.Message, "app/.env.local.dev") {
		t.Errorf("expected message to mention app/.env.local.dev, got: %s", result.Message)
	}
	if !strings.Contains(result.Message, "app/.env.local.test") {
		t.Errorf("expected message to mention app/.env.local.test (fail-fast regression?), got: %s", result.Message)
	}
	if !strings.Contains(result.Message, "sso.dev-godaddy.com") {
		t.Errorf("expected message to mention expected value sso.dev-godaddy.com, got: %s", result.Message)
	}
}

func TestAppLocalEnvCheck_Pass(t *testing.T) {
	root := t.TempDir()
	writeLocalEnvFiles(t, root, "app")

	c := &AppLocalEnvCheck{}
	result := c.Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Fatalf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

// Also guards the accumulate-all behavior for the agents side — see the
// app-side test for the rationale.
func TestAgentsLocalEnvCheck_WrongSSOHostForEnv(t *testing.T) {
	root := t.TempDir()
	writeLocalEnvFile(t, root, "agents", "dev", "SSO_HOST=sso.test-godaddy.com\nASM_BASE_URL=https://asm-dp.api.int.dev-godaddy.com/v1/conversation/graphql\n") // wrong SSO_HOST
	writeLocalEnvFile(t, root, "agents", "test", "SSO_HOST=sso.godaddy.com\nASM_BASE_URL=https://asm.api.int.test-godaddy.com/v1/conversation/graphql\n")       // wrong SSO_HOST
	writeLocalEnvFile(t, root, "agents", "prod", "SSO_HOST=sso.godaddy.com\nASM_BASE_URL=https://asm.api.int.godaddy.com/v1/conversation/graphql\n")            // correct

	c := &AgentsLocalEnvCheck{}
	result := c.Run(context.Background(), root)
	if result.Status == preflight.StatusPass {
		t.Fatalf("expected failure when .env.local.{dev,test} have wrong SSO_HOST, got Pass")
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true when SSO_HOST is wrong")
	}
	if !strings.Contains(result.Message, "agents/.env.local.dev") {
		t.Errorf("expected message to mention agents/.env.local.dev, got: %s", result.Message)
	}
	if !strings.Contains(result.Message, "agents/.env.local.test") {
		t.Errorf("expected message to mention agents/.env.local.test (fail-fast regression?), got: %s", result.Message)
	}
	if !strings.Contains(result.Message, "sso.dev-godaddy.com") {
		t.Errorf("expected message to mention expected value sso.dev-godaddy.com, got: %s", result.Message)
	}
}

func TestAgentsLocalEnvCheck_MissingFiles(t *testing.T) {
	root := t.TempDir()

	c := &AgentsLocalEnvCheck{}
	result := c.Run(context.Background(), root)
	if result.Status == preflight.StatusPass {
		t.Fatalf("expected failure when agents/.env.local.* files are missing, got Pass")
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true when local env files are missing")
	}
}

func TestAgentsLocalEnvCheck_Pass(t *testing.T) {
	root := t.TempDir()
	writeLocalEnvFiles(t, root, "agents")

	c := &AgentsLocalEnvCheck{}
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
		"USE_S2S_AUTH=true",
		"S2S_AWS_PROFILE=airobuild-dev-private-sso",
		"AWS_PROFILE=airobuild-dev-private-sso",
		"BUDGET_SERVICE_URL=https://budget-service.api.int.dev-godaddy.com",
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

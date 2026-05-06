package checks

import (
	"context"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestS2SAuthRecommendCheck_S2SEnabled_Pass(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, strings.Join([]string{
		"NODE_ENV=development",
		"AUTH_TYPE=jwt",
		"GOCODE_USE_S2S_AUTH=true",
		"AWS_PROFILE=airobuild-dev-private-sso",
	}, "\n"))

	result := (&S2SAuthRecommendCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Fatalf("expected Pass when S2S enabled, got %v: %s", result.Status, result.Message)
	}
}

func TestS2SAuthRecommendCheck_APIKeyMode_Warn(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, strings.Join([]string{
		"NODE_ENV=development",
		"AUTH_TYPE=jwt",
		`OPENAI_API_KEY="sk-test"`,
		`OPENAI_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"`,
		`ANTHROPIC_API_KEY="sk-test"`,
		`ANTHROPIC_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"`,
	}, "\n"))

	result := (&S2SAuthRecommendCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Fatalf("expected Warn for api-key mode, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true so the user can opt to migrate")
	}
	if !strings.Contains(result.Message, "S2S") {
		t.Errorf("expected message to mention S2S, got: %s", result.Message)
	}
}

func TestS2SAuthRecommendCheck_MissingEnvFile_Pass(t *testing.T) {
	root := t.TempDir()

	result := (&S2SAuthRecommendCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Fatalf("expected Pass when agents/.env missing (AgentsEnvCheck owns it), got %v: %s",
			result.Status, result.Message)
	}
}

func TestS2SAuthRecommendCheck_APIKeyVarsMissing_Pass(t *testing.T) {
	// AgentsEnvCheck would fail with these missing api-key vars; this check
	// stays quiet so the user isn't double-prompted.
	root := t.TempDir()
	writeAgentsEnv(t, root, strings.Join([]string{
		"NODE_ENV=development",
		"AUTH_TYPE=jwt",
	}, "\n"))

	result := (&S2SAuthRecommendCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Fatalf("expected Pass when api-key vars incomplete, got %v: %s",
			result.Status, result.Message)
	}
}

func TestS2SAuthRecommendCheck_GocodeUseS2SFalse_Warn(t *testing.T) {
	// Explicit GOCODE_USE_S2S_AUTH=false should still be treated as api-key mode.
	root := t.TempDir()
	writeAgentsEnv(t, root, strings.Join([]string{
		"NODE_ENV=development",
		"AUTH_TYPE=jwt",
		"GOCODE_USE_S2S_AUTH=false",
		`OPENAI_API_KEY="sk-test"`,
		`OPENAI_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"`,
		`ANTHROPIC_API_KEY="sk-test"`,
		`ANTHROPIC_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"`,
	}, "\n"))

	result := (&S2SAuthRecommendCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Fatalf("expected Warn when GOCODE_USE_S2S_AUTH=false, got %v: %s",
			result.Status, result.Message)
	}
}

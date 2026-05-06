package fixers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestS2SMigrateFixer_FlipsExistingApiKeyEnvToS2S(t *testing.T) {
	root := t.TempDir()
	existing := `NODE_ENV=development
AUTH_TYPE=jwt
AWS_PROFILE=custom-profile
OPENAI_API_KEY="sk-test"
OPENAI_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"
ANTHROPIC_API_KEY="sk-test"
ANTHROPIC_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"
SSO_JWT=preserved-value
`
	writeEnv(t, root, "agents", existing)

	if err := (&S2SMigrateFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents/.env"))
	assertEq(t, env, "GOCODE_USE_S2S_AUTH", "true")
	assertEq(t, env, "AUTH_TYPE", "jwt")
	assertEq(t, env, "AWS_PROFILE", "custom-profile") // preserved
	assertEq(t, env, "SSO_JWT", "preserved-value")    // unmanaged var preserved
	assertAbsent(t, env, "OPENAI_API_KEY")
	assertAbsent(t, env, "OPENAI_BASE_URL")
	assertAbsent(t, env, "ANTHROPIC_API_KEY")
	assertAbsent(t, env, "ANTHROPIC_BASE_URL")
}

func TestS2SMigrateFixer_FillsMissingProfileWithDefault(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", "NODE_ENV=development\nAUTH_TYPE=jwt\n")

	if err := (&S2SMigrateFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents/.env"))
	assertEq(t, env, "AWS_PROFILE", defaultAWSProfile)
	assertEq(t, env, "GOCODE_USE_S2S_AUTH", "true")
}

func TestS2SMigrateFixer_NormalizesAuthTypeNoneToJwt(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", "NODE_ENV=development\nAUTH_TYPE=none\nAWS_PROFILE=p\n")

	if err := (&S2SMigrateFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents/.env"))
	assertEq(t, env, "AUTH_TYPE", "jwt")
}

func TestS2SMigrateFixer_FailsWhenEnvMissing(t *testing.T) {
	root := t.TempDir()

	err := (&S2SMigrateFixer{}).Fix(context.Background(), root)
	if err == nil {
		t.Fatal("expected error when agents/.env missing, got nil")
	}
}

func TestS2SMigrateFixer_OverwritesExistingGocodeUseS2SFalse(t *testing.T) {
	// The EnvFixer upsert path must overwrite an existing GOCODE_USE_S2S_AUTH=false
	// rather than leaving it in place or duplicating the line. Exercise that through
	// the S2SMigrateFixer -> EnvFixer delegation chain directly.
	root := t.TempDir()
	existing := `NODE_ENV=development
AUTH_TYPE=jwt
AWS_PROFILE=custom-profile
GOCODE_USE_S2S_AUTH=false
OPENAI_API_KEY="sk-test"
OPENAI_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"
ANTHROPIC_API_KEY="sk-test"
ANTHROPIC_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"
`
	writeEnv(t, root, "agents", existing)

	if err := (&S2SMigrateFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	envPath := filepath.Join(root, "agents/.env")
	env := readEnvMap(t, envPath)
	assertEq(t, env, "GOCODE_USE_S2S_AUTH", "true")
	assertEq(t, env, "AWS_PROFILE", "custom-profile")

	raw, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("reading env: %v", err)
	}
	if got := strings.Count(string(raw), "GOCODE_USE_S2S_AUTH="); got != 1 {
		t.Errorf("expected exactly one GOCODE_USE_S2S_AUTH line after overwrite, got %d:\n%s", got, raw)
	}
}

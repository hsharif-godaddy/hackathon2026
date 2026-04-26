package fixers

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func s2sValues() *EnvValues {
	return &EnvValues{
		AuthType:   "jwt",
		AWSProfile: "airobuild-dev-private-sso",
		GoCodeAuth: "s2s",
	}
}

func apiKeyValues() *EnvValues {
	return &EnvValues{
		APIKey:     "sk-test",
		BaseURL:    "https://caas-gocode-prod.caas-prod.prod.onkatana.net",
		AuthType:   "jwt",
		AWSProfile: "airobuild-dev-private-sso",
		GoCodeAuth: "api-key",
	}
}

func TestEnvFixer_FirstTimeCreate_S2S(t *testing.T) {
	root := t.TempDir()
	f := &EnvFixer{Target: "agents", Values: s2sValues()}

	if err := f.Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents/.env"))
	assertEq(t, env, "GOCODE_USE_S2S_AUTH", "true")
	assertEq(t, env, "AWS_PROFILE", "airobuild-dev-private-sso")
	assertEq(t, env, "AUTH_TYPE", "jwt")
	assertAbsent(t, env, "OPENAI_API_KEY")
	assertAbsent(t, env, "ANTHROPIC_API_KEY")
}

func TestEnvFixer_FirstTimeCreate_APIKey(t *testing.T) {
	root := t.TempDir()
	f := &EnvFixer{Target: "agents", Values: apiKeyValues()}

	if err := f.Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents/.env"))
	assertEq(t, env, "OPENAI_API_KEY", "sk-test")
	assertEq(t, env, "OPENAI_BASE_URL", "https://caas-gocode-prod.caas-prod.prod.onkatana.net")
	assertEq(t, env, "ANTHROPIC_API_KEY", "sk-test")
	assertAbsent(t, env, "GOCODE_USE_S2S_AUTH")
}

func TestEnvFixer_UpsertSwitchAPIKeyToS2S(t *testing.T) {
	root := t.TempDir()
	existing := `NODE_ENV=development
AUTH_TYPE=jwt
AWS_PROFILE=airobuild-dev-private-sso
OPENAI_API_KEY="sk-old"
OPENAI_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"
ANTHROPIC_API_KEY="sk-old"
ANTHROPIC_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"
SSO_JWT=preserved-value
`
	writeEnv(t, root, "agents", existing)

	f := &EnvFixer{Target: "agents", Values: s2sValues()}
	if err := f.Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents/.env"))
	assertEq(t, env, "GOCODE_USE_S2S_AUTH", "true")
	assertEq(t, env, "SSO_JWT", "preserved-value") // unmanaged var preserved
	assertAbsent(t, env, "OPENAI_API_KEY")
	assertAbsent(t, env, "OPENAI_BASE_URL")
	assertAbsent(t, env, "ANTHROPIC_API_KEY")
	assertAbsent(t, env, "ANTHROPIC_BASE_URL")
}

func TestEnvFixer_UpsertSwitchS2SToAPIKey(t *testing.T) {
	root := t.TempDir()
	existing := `NODE_ENV=development
AUTH_TYPE=jwt
AWS_PROFILE=airobuild-dev-private-sso
GOCODE_USE_S2S_AUTH=true
`
	writeEnv(t, root, "agents", existing)

	f := &EnvFixer{Target: "agents", Values: apiKeyValues()}
	if err := f.Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents/.env"))
	assertEq(t, env, "GOCODE_USE_S2S_AUTH", "false")
	assertEq(t, env, "OPENAI_API_KEY", "sk-test")
	assertEq(t, env, "OPENAI_BASE_URL", "https://caas-gocode-prod.caas-prod.prod.onkatana.net")
	assertEq(t, env, "ANTHROPIC_API_KEY", "sk-test")
	assertEq(t, env, "ANTHROPIC_BASE_URL", "https://caas-gocode-prod.caas-prod.prod.onkatana.net")
}

func TestEnvFixer_APIKeyRequiredInAPIKeyMode(t *testing.T) {
	root := t.TempDir()
	f := &EnvFixer{Target: "agents", Values: &EnvValues{
		AuthType:   "jwt",
		AWSProfile: "airobuild-dev-private-sso",
		GoCodeAuth: "api-key",
		// no APIKey
	}}

	err := f.Fix(context.Background(), root)
	if err == nil {
		t.Fatal("expected error when APIKey is empty in api-key mode, got nil")
	}
	if !strings.Contains(err.Error(), "API key required") {
		t.Errorf("expected 'API key required' in error, got: %v", err)
	}
}

func TestEnvFixer_SetFormValues_NormalizesGoCodeAuth(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", "s2s"},
		{"api-key", "api-key"},
		{"s2s", "s2s"},
		{"bogus", "s2s"},
		{"  s2s  ", "s2s"},
	}
	for _, tc := range cases {
		f := &EnvFixer{Target: "agents"}
		f.SetFormValues(map[string]string{"gocodeAuth": tc.in, "authType": "jwt", "awsProfile": "p"})
		if f.Values.GoCodeAuth != tc.want {
			t.Errorf("GoCodeAuth=%q: got %q, want %q", tc.in, f.Values.GoCodeAuth, tc.want)
		}
	}
}

func assertEq(t *testing.T, env map[string]string, key, want string) {
	t.Helper()
	if got := env[key]; got != want {
		t.Errorf("env[%q] = %q; want %q", key, got, want)
	}
}

func assertAbsent(t *testing.T, env map[string]string, key string) {
	t.Helper()
	if got, ok := env[key]; ok && got != "" {
		t.Errorf("env[%q] = %q; expected absent/empty", key, got)
	}
}


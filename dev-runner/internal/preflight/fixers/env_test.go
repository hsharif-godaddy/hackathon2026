package fixers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
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
	assertEq(t, env, "OPENAI_BASE_URL", preflight.S2SGoCodeEndpoint)
	assertEq(t, env, "ANTHROPIC_BASE_URL", preflight.S2SGoCodeEndpoint)
	assertAbsent(t, env, "OPENAI_API_KEY")
	assertAbsent(t, env, "ANTHROPIC_API_KEY")
}

func TestEnvFixer_GeneratesEnvironmentSpecificSSOHosts(t *testing.T) {
	root := t.TempDir()

	appFixer := &EnvFixer{Target: "app", Values: s2sValues()}
	if err := appFixer.Fix(context.Background(), root); err != nil {
		t.Fatalf("app Fix() failed: %v", err)
	}

	agentsFixer := &EnvFixer{Target: "agents", Values: s2sValues()}
	if err := agentsFixer.Fix(context.Background(), root); err != nil {
		t.Fatalf("agents Fix() failed: %v", err)
	}

	cases := []struct {
		relPath string
		want    string
	}{
		{"app/.env.local.dev", "sso.dev-godaddy.com"},
		{"app/.env.local.test", "sso.test-godaddy.com"},
		{"app/.env.local.prod", "sso.godaddy.com"},
		{"agents/.env.local.dev", "sso.dev-godaddy.com"},
		{"agents/.env.local.test", "sso.test-godaddy.com"},
		{"agents/.env.local.prod", "sso.godaddy.com"},
	}

	for _, tc := range cases {
		env := readEnvMap(t, filepath.Join(root, tc.relPath))
		assertEq(t, env, "SSO_HOST", tc.want)
	}
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
	assertEq(t, env, "OPENAI_BASE_URL", preflight.S2SGoCodeEndpoint)
	assertEq(t, env, "ANTHROPIC_BASE_URL", preflight.S2SGoCodeEndpoint)
	assertAbsent(t, env, "OPENAI_API_KEY")
	assertAbsent(t, env, "ANTHROPIC_API_KEY")
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

// Existing-file shortcut: when agents/.env already declares a complete S2S
// configuration, FormFields() must return nil so the TUI doesn't re-prompt the
// user just to add the newly-required BASE_URL pinning.
func TestEnvFixer_FormFields_SkipsForExistingCompleteS2S(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", `NODE_ENV=development
GOCODE_USE_S2S_AUTH=true
AUTH_TYPE=jwt
AWS_PROFILE=airobuild-dev-private-sso
`)

	f := &EnvFixer{Target: "agents", ProjectRoot: root}
	if fields := f.FormFields(); fields != nil {
		t.Errorf("FormFields() should be nil for complete S2S file, got %d fields", len(fields))
	}
	if f.Values != nil {
		t.Error("FormFields() must not mutate f.Values; registered fixer is reused across runs")
	}
}

func TestEnvFixer_FormFields_ShownForApiKeyFile(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", `NODE_ENV=development
GOCODE_USE_S2S_AUTH=false
AUTH_TYPE=jwt
AWS_PROFILE=airobuild-dev-private-sso
OPENAI_API_KEY=sk-old
`)

	f := &EnvFixer{Target: "agents", ProjectRoot: root}
	if fields := f.FormFields(); len(fields) == 0 {
		t.Error("FormFields() should prompt when file is in api-key mode")
	}
}

func TestEnvFixer_FormFields_ShownForFreshInstall(t *testing.T) {
	root := t.TempDir()
	f := &EnvFixer{Target: "agents", ProjectRoot: root}
	if fields := f.FormFields(); len(fields) == 0 {
		t.Error("FormFields() should prompt when agents/.env does not exist")
	}
}

func TestEnvFixer_FormFields_ShownForIncompleteS2S(t *testing.T) {
	cases := []struct {
		name    string
		content string
	}{
		{"missing AUTH_TYPE", "GOCODE_USE_S2S_AUTH=true\nAWS_PROFILE=p\n"},
		{"missing AWS_PROFILE", "GOCODE_USE_S2S_AUTH=true\nAUTH_TYPE=jwt\n"},
		{"empty AUTH_TYPE", "GOCODE_USE_S2S_AUTH=true\nAUTH_TYPE=\nAWS_PROFILE=p\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			writeEnv(t, root, "agents", tc.content)

			f := &EnvFixer{Target: "agents", ProjectRoot: root}
			if fields := f.FormFields(); len(fields) == 0 {
				t.Errorf("FormFields() should prompt when S2S setup is incomplete (%s)", tc.name)
			}
		})
	}
}

// Fix() must reconstruct values from the existing file each call (rather than
// relying on cached state), so the registered fixer can be reused safely.
func TestEnvFixer_Fix_PinsBaseURLsForExistingCompleteS2S(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", `NODE_ENV=development
GOCODE_USE_S2S_AUTH=true
AUTH_TYPE=jwt
AWS_PROFILE=custom-profile
SSO_JWT=preserved-value
`)

	f := &EnvFixer{Target: "agents", ProjectRoot: root}
	if err := f.Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents/.env"))
	assertEq(t, env, "GOCODE_USE_S2S_AUTH", "true")
	assertEq(t, env, "OPENAI_BASE_URL", preflight.S2SGoCodeEndpoint)
	assertEq(t, env, "ANTHROPIC_BASE_URL", preflight.S2SGoCodeEndpoint)
	assertEq(t, env, "AUTH_TYPE", "jwt")
	assertEq(t, env, "AWS_PROFILE", "custom-profile")
	assertEq(t, env, "SSO_JWT", "preserved-value")
	assertAbsent(t, env, "OPENAI_API_KEY")
	assertAbsent(t, env, "ANTHROPIC_API_KEY")

	if f.Values != nil {
		t.Error("Fix() must not cache loaded values on the fixer struct")
	}
}

// Primary upgrade scenario: existing complete S2S file already has BASE_URLs,
// but they point at the api-key LiteLLM proxy. Shortcut must overwrite both
// rather than leaving them in place (the api-key URL would route IAM JWTs to
// a backend that rejects them).
func TestEnvFixer_Fix_OverwritesWrongBaseURLsForExistingCompleteS2S(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", `NODE_ENV=development
GOCODE_USE_S2S_AUTH=true
AUTH_TYPE=jwt
AWS_PROFILE=airobuild-dev-private-sso
OPENAI_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"
ANTHROPIC_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"
`)

	f := &EnvFixer{Target: "agents", ProjectRoot: root}
	if err := f.Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents/.env"))
	assertEq(t, env, "OPENAI_BASE_URL", preflight.S2SGoCodeEndpoint)
	assertEq(t, env, "ANTHROPIC_BASE_URL", preflight.S2SGoCodeEndpoint)
}

// Pins the source-of-truth contract: when both f.ProjectRoot and the Fix() arg
// are set, f.ProjectRoot wins. This matches needsForm()'s choice so the two
// can't disagree about whether the shortcut applies.
func TestEnvFixer_Fix_PrefersStructProjectRootOverArg(t *testing.T) {
	structRoot := t.TempDir()
	argRoot := t.TempDir()
	writeEnv(t, structRoot, "agents", `NODE_ENV=development
GOCODE_USE_S2S_AUTH=true
AUTH_TYPE=jwt
AWS_PROFILE=airobuild-dev-private-sso
`)

	f := &EnvFixer{Target: "agents", ProjectRoot: structRoot}
	if err := f.Fix(context.Background(), argRoot); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	if _, err := os.Stat(filepath.Join(argRoot, "agents/.env")); !os.IsNotExist(err) {
		t.Errorf("Fix() wrote to argRoot when struct ProjectRoot should have won; err=%v", err)
	}
	env := readEnvMap(t, filepath.Join(structRoot, "agents/.env"))
	assertEq(t, env, "OPENAI_BASE_URL", preflight.S2SGoCodeEndpoint)
}

func TestEnvFixer_Fix_NoValuesNoShortcutReturnsError(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", "NODE_ENV=development\nGOCODE_USE_S2S_AUTH=false\n")

	f := &EnvFixer{Target: "agents", ProjectRoot: root}
	err := f.Fix(context.Background(), root)
	if err == nil {
		t.Fatal("expected error when Values is nil and no shortcut applies")
	}
	if !strings.Contains(err.Error(), "Values to be set") {
		t.Errorf("expected 'Values to be set' in error, got: %v", err)
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

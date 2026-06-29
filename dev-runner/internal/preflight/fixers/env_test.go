package fixers

import (
	"context"
	"os"
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
	// S2S mode pins GoCode to the prod gateway so the prod sso-jwt isn't sent
	// to the NODE_ENV-derived dev endpoint (401 → silent no-output agent).
	assertEq(t, env, "OPENAI_BASE_URL", "https://api.gocode.caas.gdcorp.tools/v1")
	assertAbsent(t, env, "OPENAI_API_KEY")
	assertAbsent(t, env, "ANTHROPIC_API_KEY")
}

// writeLocalEnv creates an .env.local.<env> file under root/service/ with the
// given content. Used to seed drifted per-environment files in tests.
func writeLocalEnv(t *testing.T, root, service, envName, content string) {
	t.Helper()
	dir := filepath.Join(root, service)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", service, err)
	}
	path := filepath.Join(dir, ".env.local."+envName)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
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

// Regression test: when a user has a drifted .env.local.dev (missing SSO_HOST
// but with hand-authored comments and extra vars), the fixer must upsert the
// managed keys without wiping the rest. Mirrors the real-world state where
// the file was seeded long ago by the predecessor setup utility.
func TestEnvFixer_PreservesExistingLocalEnvFiles(t *testing.T) {
	root := t.TempDir()

	drifted := `# =============================================================================
# Authentication Architecture Overview
# =============================================================================
# Hand-crafted comment block that must survive.

NEXT_PUBLIC_APP_URL=https://local.gasket.dev-godaddy.com:8443
SSO_LOGIN_URL=https://sso.dev-godaddy.com/login
SSO_LOGOUT_URL=https://sso.dev-godaddy.com/logout
LOGIN_REDIRECT_URL=https://local.gasket.dev-godaddy.com:8443/

# Extra var set by the old setup utility, not managed by the fixer.
AGENTS_SERVICE_URL=http://localhost:4000
AWS_REGION=us-west-2

MGMT_AIRO_BASE_URL=http://localhost:4100
`
	writeLocalEnv(t, root, "app", "dev", drifted)

	agentsDrifted := `# Seeded by the old setup utility.
JWKS_URL=https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json
CUSTOM_AGENTS_VAR=keep-me
`
	writeLocalEnv(t, root, "agents", "dev", agentsDrifted)

	appFixer := &EnvFixer{Target: "app", Values: s2sValues()}
	if err := appFixer.Fix(context.Background(), root); err != nil {
		t.Fatalf("app Fix() failed: %v", err)
	}

	agentsFixer := &EnvFixer{Target: "agents", Values: s2sValues()}
	if err := agentsFixer.Fix(context.Background(), root); err != nil {
		t.Fatalf("agents Fix() failed: %v", err)
	}

	// app/.env.local.dev: SSO_HOST added, existing vars and comments preserved.
	appEnv := readEnvMap(t, filepath.Join(root, "app/.env.local.dev"))
	assertEq(t, appEnv, "SSO_HOST", "sso.dev-godaddy.com")
	assertEq(t, appEnv, "AGENTS_SERVICE_URL", "http://localhost:4000")
	assertEq(t, appEnv, "AWS_REGION", "us-west-2")

	appRaw, err := os.ReadFile(filepath.Join(root, "app/.env.local.dev"))
	if err != nil {
		t.Fatalf("read app/.env.local.dev: %v", err)
	}
	if !strings.Contains(string(appRaw), "Authentication Architecture Overview") {
		t.Errorf("app/.env.local.dev lost hand-crafted comment block:\n%s", string(appRaw))
	}

	// agents/.env.local.dev: SSO_HOST added, unmanaged var preserved.
	agentsEnv := readEnvMap(t, filepath.Join(root, "agents/.env.local.dev"))
	assertEq(t, agentsEnv, "SSO_HOST", "sso.dev-godaddy.com")
	assertEq(t, agentsEnv, "CUSTOM_AGENTS_VAR", "keep-me")
}

// Regression test: when a user has a populated app/.env (with JWT keys and
// S2S certs added by other fixers) and the only failure is a drifted
// .env.local.*, the fixer must NOT wipe the existing JWT keys / certs via
// a wholesale rewrite. This would rotate JWT keys and break preview auth.
func TestEnvFixer_PreservesAppEnvJWTKeysAndCerts(t *testing.T) {
	root := t.TempDir()

	existingAppEnv := `NODE_ENV=development
PORT=3000
AUTH_TYPE=jwt
AWS_PROFILE=airobuild-dev-private-sso
JWT_PRIVATE_KEY="preserved-private-key"
JWT_PUBLIC_KEY="preserved-public-key"
GRAPHQL_CLIENT_CERT="preserved-graphql-cert"
`
	writeEnv(t, root, "app", existingAppEnv)

	f := &EnvFixer{Target: "app", Values: s2sValues()}
	if err := f.Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "app/.env"))
	assertEq(t, env, "JWT_PRIVATE_KEY", "preserved-private-key")
	assertEq(t, env, "JWT_PUBLIC_KEY", "preserved-public-key")
	assertEq(t, env, "GRAPHQL_CLIENT_CERT", "preserved-graphql-cert")
	assertEq(t, env, "AUTH_TYPE", "jwt")
	assertEq(t, env, "AWS_PROFILE", "airobuild-dev-private-sso")
}

// AppLocalEnvFixer runs generateAppEnvSpecific without requiring form values.
// It should create all three .env.local.* files with SSO_HOST on first run.
func TestAppLocalEnvFixer_FirstTimeCreate(t *testing.T) {
	root := t.TempDir()

	if err := (&AppLocalEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	cases := []struct {
		relPath string
		want    string
	}{
		{"app/.env.local.dev", "sso.dev-godaddy.com"},
		{"app/.env.local.test", "sso.test-godaddy.com"},
		{"app/.env.local.prod", "sso.godaddy.com"},
	}
	for _, tc := range cases {
		env := readEnvMap(t, filepath.Join(root, tc.relPath))
		assertEq(t, env, "SSO_HOST", tc.want)
	}

	// test only has the sxb1 datacenter; dev/prod resolve via marketId.
	testEnv := readEnvMap(t, filepath.Join(root, "app/.env.local.test"))
	assertEq(t, testEnv, "MGMT_AIRO_DATACENTER", "sxb1")
	for _, relPath := range []string{"app/.env.local.dev", "app/.env.local.prod"} {
		env := readEnvMap(t, filepath.Join(root, relPath))
		if dc, ok := env["MGMT_AIRO_DATACENTER"]; ok {
			t.Errorf("%s should not set MGMT_AIRO_DATACENTER, got %q", relPath, dc)
		}
	}
}

// Regression test: if a user hand-edits SSO_HOST in .env.local.dev to the
// wrong environment's value (e.g. sso.test-godaddy.com), the fixer must
// replace it with the canonical per-env value.
func TestAppLocalEnvFixer_CorrectsWrongSSOHost(t *testing.T) {
	root := t.TempDir()
	writeLocalEnv(t, root, "app", "dev", "SSO_HOST=sso.test-godaddy.com\n")

	if err := (&AppLocalEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "app/.env.local.dev"))
	assertEq(t, env, "SSO_HOST", "sso.dev-godaddy.com")
}

// Regression guard: the narrow fixer must preserve pre-existing drifted
// files (hand-authored comments, unmanaged vars) rather than rewriting.
func TestAppLocalEnvFixer_PreservesDrift(t *testing.T) {
	root := t.TempDir()
	drifted := `# Hand-crafted header
NEXT_PUBLIC_APP_URL=https://local.gasket.dev-godaddy.com:8443
AGENTS_SERVICE_URL=http://localhost:4000
`
	writeLocalEnv(t, root, "app", "dev", drifted)

	if err := (&AppLocalEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "app/.env.local.dev"))
	assertEq(t, env, "SSO_HOST", "sso.dev-godaddy.com")
	assertEq(t, env, "AGENTS_SERVICE_URL", "http://localhost:4000")
}

func TestAgentsLocalEnvFixer_FirstTimeCreate(t *testing.T) {
	root := t.TempDir()

	if err := (&AgentsLocalEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	cases := []struct {
		relPath     string
		wantSSO     string
		wantJWKSURL string
	}{
		{
			relPath:     "agents/.env.local.dev",
			wantSSO:     "sso.dev-godaddy.com",
			wantJWKSURL: "https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json",
		},
		{
			relPath:     "agents/.env.local.test",
			wantSSO:     "sso.test-godaddy.com",
			wantJWKSURL: "https://airo-builder.test-godaddy.com/.well-known/jwks.json",
		},
		{
			relPath:     "agents/.env.local.prod",
			wantSSO:     "sso.godaddy.com",
			wantJWKSURL: "https://airo-builder.godaddy.com/.well-known/jwks.json",
		},
	}
	for _, tc := range cases {
		env := readEnvMap(t, filepath.Join(root, tc.relPath))
		assertEq(t, env, "SSO_HOST", tc.wantSSO)
		assertEq(t, env, "JWKS_URL", tc.wantJWKSURL)
	}
}

// Mirror of TestAppLocalEnvFixer_CorrectsWrongSSOHost for the agents side.
func TestAgentsLocalEnvFixer_CorrectsWrongSSOHost(t *testing.T) {
	root := t.TempDir()
	writeLocalEnv(t, root, "agents", "dev", "SSO_HOST=sso.test-godaddy.com\n")

	if err := (&AgentsLocalEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents/.env.local.dev"))
	assertEq(t, env, "SSO_HOST", "sso.dev-godaddy.com")
}

// Mirror of TestAppLocalEnvFixer_PreservesDrift for the agents side.
func TestAgentsLocalEnvFixer_PreservesDrift(t *testing.T) {
	root := t.TempDir()
	drifted := `# Hand-crafted header
JWKS_URL=https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json
CUSTOM_AGENTS_VAR=keep-me
`
	writeLocalEnv(t, root, "agents", "dev", drifted)

	if err := (&AgentsLocalEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "agents/.env.local.dev"))
	assertEq(t, env, "SSO_HOST", "sso.dev-godaddy.com")
	assertEq(t, env, "CUSTOM_AGENTS_VAR", "keep-me")
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
	// OPENAI_BASE_URL is re-pinned to the prod S2S gateway (matches the prod
	// sso-jwt), NOT stripped — the old onkatana api-key endpoint is replaced.
	assertEq(t, env, "OPENAI_BASE_URL", "https://api.gocode.caas.gdcorp.tools/v1")
	assertAbsent(t, env, "OPENAI_API_KEY")
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

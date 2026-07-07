package fixers

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

type EnvFixer struct {
	Target      string     // "app" or "agents"
	Values      *EnvValues // if set by TUI, skip form and use these directly
	SyncFrom    *EnvValues // set after fix runs (on app fixer)
	AppEnvFixer *EnvFixer  // agents fixer points to app fixer for syncing
}

type EnvValues struct {
	AIProvider string
	APIKey     string
	BaseURL    string
	AuthType   string
	AWSProfile string
	GoCodeAuth string // "api-key" or "s2s"
}

func (f *EnvFixer) FormFields() []preflight.FormField {
	if !f.needsForm() {
		return nil
	}
	defaults := DefaultEnvValues()
	// Order matters: the TUI form renders non-conditional fields in group 1
	// and conditional (apiKey/baseURL) fields in group 2. gocodeAuth is placed
	// last in group 1 so that picking "api-key" is immediately followed by the
	// credential prompts on the next wizard page.
	return []preflight.FormField{
		{
			Key:         "authType",
			Label:       "App Auth Type",
			Description: "User authentication to the app (unrelated to GoCode auth)",
			Default:     defaults.AuthType,
			Options:     []string{"jwt", "mock"},
		},
		{
			Key:         "awsProfile",
			Label:       "AWS Profile",
			Description: "AWS SSO profile for S2S auth (GoCode, logo, budget, knowledge services)",
			Default:     defaults.AWSProfile,
		},
		{
			Key:          "gocodeAuth",
			Label:        "GoCode Auth",
			Description:  "s2s = AWS IAM JWT (recommended, requires AWS SSO login); api-key = personal GoCode key (deprecated fallback)",
			Default:      defaults.GoCodeAuth,
			Options:      []string{"s2s", "api-key"},
			OptionLabels: []string{"s2s", "api-key (deprecated)"},
		},
		{
			Key:         "apiKey",
			Label:       "GoCode API Key",
			Description: "Only used when GoCode Auth = api-key. Get your key at: https://caas.open-webui.godaddy.com/workspace/apiKeys",
			Placeholder: "sk-...",
			Default:     defaults.APIKey,
			Required:    false,
			Password:    true,
		},
		{
			Key:         "baseURL",
			Label:       "GoCode Base URL",
			Description: "Only used when GoCode Auth = api-key. In s2s mode the endpoint is pinned to the prod GoCode gateway (to match the prod sso-jwt).",
			Default:     defaults.BaseURL,
		},
	}
}

func (f *EnvFixer) SetFormValues(values map[string]string) {
	authType := strings.TrimSpace(values["authType"])
	if authType == "none" {
		authType = "mock"
	}
	gocodeAuth := strings.TrimSpace(values["gocodeAuth"])
	if gocodeAuth != "api-key" && gocodeAuth != "s2s" {
		gocodeAuth = "s2s"
	}
	f.Values = &EnvValues{
		APIKey:     strings.TrimSpace(values["apiKey"]),
		BaseURL:    strings.TrimSpace(values["baseURL"]),
		AuthType:   authType,
		AWSProfile: strings.TrimSpace(values["awsProfile"]),
		GoCodeAuth: gocodeAuth,
	}
}

// needsForm returns true if this fixer needs user input via the TUI form.
func (f *EnvFixer) needsForm() bool {
	if f.Values != nil {
		return false
	}
	if f.Target == "agents" && f.AppEnvFixer != nil && f.AppEnvFixer.SyncFrom != nil {
		return false
	}
	return true
}

// Fix generates env files. Values must be set (via TUI form or synced from app)
// before calling this for the app target.
func (f *EnvFixer) Fix(ctx context.Context, projectRoot string) error {
	if f.Values != nil && f.Values.GoCodeAuth == "api-key" && f.Values.APIKey == "" {
		return fmt.Errorf("GoCode API key required when GoCode Auth = api-key")
	}

	// Agents can sync from app's collected values
	if f.Target == "agents" && f.AppEnvFixer != nil && f.AppEnvFixer.SyncFrom != nil {
		return f.generateAgentsEnv(projectRoot, f.AppEnvFixer.SyncFrom)
	}

	// Use pre-collected values
	if f.Values != nil {
		f.SyncFrom = f.Values
		if f.Target == "app" {
			return f.generateAppEnv(projectRoot, f.Values)
		}
		return f.generateAgentsEnv(projectRoot, f.Values)
	}

	return fmt.Errorf("env fixer requires Values to be set before Fix() is called")
}

// DefaultEnvValues returns the default values for the env form, pre-populated
// from environment variables where available.
func DefaultEnvValues() *EnvValues {
	values := &EnvValues{
		BaseURL:    "https://caas-gocode-prod.caas-prod.prod.onkatana.net",
		AuthType:   "jwt",
		AWSProfile: defaultAWSProfile,
		GoCodeAuth: "s2s",
	}
	if envKey := os.Getenv("APPBUILDER_GOCODE_API_TOKEN"); envKey != "" {
		values.APIKey = envKey
	}
	return values
}

func (f *EnvFixer) generateAppEnv(projectRoot string, v *EnvValues) error {
	envPath := filepath.Join(projectRoot, "app/.env")

	_, err := os.Stat(envPath)
	switch {
	case err == nil:
		// File exists — upsert only the managed variables, preserving
		// everything else (e.g., JWT_PRIVATE_KEY/JWT_PUBLIC_KEY written by
		// JWTKeysFixer and GRAPHQL client certs written by
		// S2SCertsFixer). A wholesale rewrite here would wipe those and
		// trigger a JWT rotation downstream.
		managed := []struct{ key, value string }{
			{"NODE_ENV", "development"},
			{"PORT", "3000"},
			{"AUTH_TYPE", v.AuthType},
			{"AWS_PROFILE", v.AWSProfile},
		}
		for _, kv := range managed {
			if err := upsertEnvVarUnquoted(envPath, kv.key, kv.value); err != nil {
				return fmt.Errorf("upserting %s in app/.env: %w", kv.key, err)
			}
		}
	case os.IsNotExist(err):
		content := fmt.Sprintf(`# Airo Builder - App Environment Configuration
# Generated by dev-runner preflight

NODE_ENV=development
PORT=3000

AUTH_TYPE=%s

# AWS Configuration
AWS_PROFILE=%s
`, v.AuthType, v.AWSProfile)
		if err := writeFileAtomic(envPath, content); err != nil {
			return err
		}
	default:
		return fmt.Errorf("stat app/.env: %w", err)
	}

	return generateAppEnvSpecific(projectRoot)
}

func (f *EnvFixer) generateAgentsEnv(projectRoot string, v *EnvValues) error {
	envPath := filepath.Join(projectRoot, "agents/.env")

	// If the file doesn't exist, create it from template (first-time setup).
	if _, err := os.Stat(envPath); os.IsNotExist(err) {
		var content string
		if v.GoCodeAuth == "s2s" {
			content = fmt.Sprintf(`# Airo Builder - Agents Environment Configuration
# Generated by dev-runner preflight

NODE_ENV=development
GD_ENV=dev

AUTH_TYPE=%s

# S2S Authentication (GoCode, logo generation, budget service, knowledge service, etc.)
AWS_PROFILE=%s
GOCODE_USE_S2S_AUTH=true
USE_S2S_AUTH=true
S2S_AWS_PROFILE=%s

# SSO_HOST (set per-env in .env.local.*) mints a PROD sso-jwt; pin GoCode to
# the matching PROD endpoint so the token isn't sent to the NODE_ENV-derived
# DEV gateway (which 401s and silently yields no agent output).
OPENAI_BASE_URL=%s

DEFAULT_PROVIDER=anthropic

APP_TEMPLATE_DIR=app-templates/v8

ENABLE_SOCIAL=true

MYSQL_ROOT_HOST=localhost
MYSQL_ROOT_PORT=3306
MYSQL_ROOT_USER=root
MYSQL_ROOT_PASS=

GODADDY_OAUTH_CLIENT_ID=c16c68eb-0c20-437c-90bd-1c78911b3d48
GODADDY_API_BASE_URL=https://api.dev-godaddy.com
AGENT_URL=http://localhost:4000

DOWNLOAD_TEMP_DIR="/tmp/apps/archives"

ENABLE_AI_DEVTOOLS=true

BUDGET_SERVICE_URL=https://budget-service.api.int.dev-godaddy.com
`, v.AuthType, v.AWSProfile, v.AWSProfile, preflight.S2SGoCodeEndpoint)
		} else {
			content = fmt.Sprintf(`# Airo Builder - Agents Environment Configuration
# Generated by dev-runner preflight

NODE_ENV=development
GD_ENV=dev

AUTH_TYPE=%s

# S2S Authentication (logo generation, budget service, knowledge service, etc.)
AWS_PROFILE=%s

OPENAI_API_KEY="%s"
OPENAI_BASE_URL="%s"

DEFAULT_PROVIDER=anthropic
ANTHROPIC_API_KEY="%s"
ANTHROPIC_BASE_URL="%s"

APP_TEMPLATE_DIR=app-templates/v8

ENABLE_SOCIAL=true

MYSQL_ROOT_HOST=localhost
MYSQL_ROOT_PORT=3306
MYSQL_ROOT_USER=root
MYSQL_ROOT_PASS=

GODADDY_OAUTH_CLIENT_ID=c16c68eb-0c20-437c-90bd-1c78911b3d48
GODADDY_API_BASE_URL=https://api.dev-godaddy.com
AGENT_URL=http://localhost:4000

DOWNLOAD_TEMP_DIR="/tmp/apps/archives"

ENABLE_AI_DEVTOOLS=true

BUDGET_SERVICE_URL=https://budget-service.api.int.dev-godaddy.com
`, v.AuthType, v.AWSProfile, v.APIKey, v.BaseURL,
				v.APIKey, v.BaseURL)
		}

		if err := writeFileAtomic(envPath, content); err != nil {
			return err
		}
		return generateAgentsEnvSpecific(projectRoot)
	}

	// File exists — upsert only the managed variables, preserving everything else
	// (e.g., SSO_JWT set by other fixers).
	baseVars := []struct {
		key    string
		value  string
		quoted bool
	}{
		{"NODE_ENV", "development", false},
		{"GD_ENV", "dev", false},
		{"AUTH_TYPE", v.AuthType, false},
		{"AWS_PROFILE", v.AWSProfile, false},
		{"DEFAULT_PROVIDER", "anthropic", false},
		{"APP_TEMPLATE_DIR", "app-templates/v8", false},
		{"ENABLE_SOCIAL", "true", false},
		{"MYSQL_ROOT_HOST", "localhost", false},
		{"MYSQL_ROOT_PORT", "3306", false},
		{"MYSQL_ROOT_USER", "root", false},
		{"MYSQL_ROOT_PASS", "", false},
		{"GODADDY_OAUTH_CLIENT_ID", "c16c68eb-0c20-437c-90bd-1c78911b3d48", false},
		{"GODADDY_API_BASE_URL", "https://api.dev-godaddy.com", false},
		{"AGENT_URL", "http://localhost:4000", false},
		{"DOWNLOAD_TEMP_DIR", "/tmp/apps/archives", true},
		{"ENABLE_AI_DEVTOOLS", "true", false},
		{"BUDGET_SERVICE_URL", "https://budget-service.api.int.dev-godaddy.com", false},
	}

	var modeVars []struct {
		key    string
		value  string
		quoted bool
	}
	if v.GoCodeAuth == "s2s" {
		// Remove stale api-key-mode credential vars. The api-key endpoint
		// (LiteLLM/onkatana proxy) and personal keys don't apply in S2S mode.
		for _, key := range []string{
			"OPENAI_API_KEY",
			"ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL",
		} {
			if err := removeEnvVar(envPath, key); err != nil {
				return fmt.Errorf("removing %s: %w", key, err)
			}
		}
		// Pin OPENAI_BASE_URL to the PROD GoCode sso-jwt gateway. s2s-auth.ts
		// honors it over the NODE_ENV default; without it the prod sso-jwt is
		// sent to the DEV gateway and 401s (silent no-output agent). This is a
		// managed value, not stale state — set it rather than strip it.
		modeVars = []struct {
			key    string
			value  string
			quoted bool
		}{
			{"GOCODE_USE_S2S_AUTH", "true", false},
			{"USE_S2S_AUTH", "true", false},
			{"S2S_AWS_PROFILE", v.AWSProfile, false},
			{"OPENAI_BASE_URL", preflight.S2SGoCodeEndpoint, false},
		}
	} else {
		modeVars = []struct {
			key    string
			value  string
			quoted bool
		}{
			{"GOCODE_USE_S2S_AUTH", "false", false},
			{"USE_S2S_AUTH", "false", false},
			{"OPENAI_API_KEY", v.APIKey, true},
			{"OPENAI_BASE_URL", v.BaseURL, true},
			{"ANTHROPIC_API_KEY", v.APIKey, true},
			{"ANTHROPIC_BASE_URL", v.BaseURL, true},
		}
	}

	for _, variable := range append(baseVars, modeVars...) {
		var err error
		if variable.quoted {
			err = upsertEnvVar(envPath, variable.key, variable.value)
		} else {
			err = upsertEnvVarUnquoted(envPath, variable.key, variable.value)
		}
		if err != nil {
			return fmt.Errorf("upserting %s: %w", variable.key, err)
		}
	}

	return generateAgentsEnvSpecific(projectRoot)
}

func generateAppEnvSpecific(projectRoot string) error {
	envs := []struct {
		relPath, appURL, ssoHost, mgmtURL, datacenter string
	}{
		{
			relPath: "app/.env.local.dev",
			appURL:  "https://local.gasket.dev-godaddy.com:8443",
			ssoHost: "sso.dev-godaddy.com",
			mgmtURL: "http://localhost:4100",
		},
		{
			relPath: "app/.env.local.test",
			appURL:  "https://airo-builder.test-godaddy.com",
			ssoHost: "sso.test-godaddy.com",
			mgmtURL: "https://mgmt.nstk.net",
			// test only has the sxb1 datacenter; without this, en-US/default
			// markets resolve to p3 via getDatacenterFromMarketId and app
			// creation fails.
			datacenter: "sxb1",
		},
		{
			relPath: "app/.env.local.prod",
			appURL:  "https://airo-builder.godaddy.com",
			ssoHost: "sso.godaddy.com",
			mgmtURL: "https://mgmt.woosaas.godaddy.com",
		},
	}

	for _, cfg := range envs {
		fullPath := filepath.Join(projectRoot, cfg.relPath)
		managed := []struct{ key, value string }{
			{"NEXT_PUBLIC_APP_URL", cfg.appURL},
			{"SSO_LOGIN_URL", "https://" + cfg.ssoHost + "/login"},
			{"SSO_LOGOUT_URL", "https://" + cfg.ssoHost + "/logout"},
			{"SSO_HOST", cfg.ssoHost},
			{"LOGIN_REDIRECT_URL", cfg.appURL + "/"},
			{"MGMT_AIRO_BASE_URL", cfg.mgmtURL},
		}
		if cfg.datacenter != "" {
			managed = append(managed, struct{ key, value string }{"MGMT_AIRO_DATACENTER", cfg.datacenter})
		}

		if err := writeOrUpsertManagedEnv(fullPath, cfg.relPath, managed); err != nil {
			return err
		}
	}
	return nil
}

func generateAgentsEnvSpecific(projectRoot string) error {
	envs := []struct {
		relPath, jwksURL, ssoHost, asmBaseURL, atlasAPIURL, mgmtURL string
	}{
		{
			relPath:     "agents/.env.local.dev",
			jwksURL:     "https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json",
			ssoHost:     "sso.dev-godaddy.com",
			asmBaseURL:  "https://asm-dp.api.int.dev-godaddy.com/v1/conversation/graphql",
			atlasAPIURL: "https://atlas.dev-gdcorp.tools",
			mgmtURL:     "http://localhost:4100",
		},
		{
			relPath:     "agents/.env.local.test",
			jwksURL:     "https://airo-builder.test-godaddy.com/.well-known/jwks.json",
			ssoHost:     "sso.test-godaddy.com",
			asmBaseURL:  "https://asm.api.int.test-godaddy.com/v1/conversation/graphql",
			atlasAPIURL: "https://atlas.test-gdcorp.tools",
			mgmtURL:     "https://mgmt.nstk.net",
		},
		{
			relPath:     "agents/.env.local.prod",
			jwksURL:     "https://airo-builder.godaddy.com/.well-known/jwks.json",
			ssoHost:     "sso.godaddy.com",
			asmBaseURL:  "https://asm.api.int.godaddy.com/v1/conversation/graphql",
			atlasAPIURL: "https://atlas.gdcorp.tools",
			mgmtURL:     "https://mgmt.woosaas.godaddy.com",
		},
	}

	for _, cfg := range envs {
		fullPath := filepath.Join(projectRoot, cfg.relPath)
		managed := []struct{ key, value string }{
			{"JWKS_URL", cfg.jwksURL},
			{"SSO_HOST", cfg.ssoHost},
			{"ASM_BASE_URL", cfg.asmBaseURL},
			{"ATLAS_API_BASE_URL", cfg.atlasAPIURL},
			{"MGMT_AIRO_BASE_URL", cfg.mgmtURL},
		}

		if err := writeOrUpsertManagedEnv(fullPath, cfg.relPath, managed); err != nil {
			return err
		}
	}
	return nil
}

// writeOrUpsertManagedEnv writes a canonical template to fullPath if it does
// not exist, otherwise upserts each managed key preserving any other content
// in the file. Non-IsNotExist stat errors are surfaced with the stat call as
// context rather than silently falling through to the read-on-upsert path.
func writeOrUpsertManagedEnv(fullPath, relPath string, managed []struct{ key, value string }) error {
	_, err := os.Stat(fullPath)
	switch {
	case err == nil:
		for _, kv := range managed {
			if err := upsertEnvVarUnquoted(fullPath, kv.key, kv.value); err != nil {
				return fmt.Errorf("upserting %s in %s: %w", kv.key, relPath, err)
			}
		}
		return nil
	case os.IsNotExist(err):
		var b strings.Builder
		b.WriteString("# Environment-specific configuration (generated by dev-runner)\n")
		for _, kv := range managed {
			b.WriteString(kv.key)
			b.WriteByte('=')
			b.WriteString(kv.value)
			b.WriteByte('\n')
		}
		return writeFileAtomic(fullPath, b.String())
	default:
		return fmt.Errorf("stat %s: %w", relPath, err)
	}
}

// AppLocalEnvFixer regenerates app/.env.local.{dev,test,prod} with the
// managed SSO/env keys. Non-interactive (no form, no Values) — pairs with
// AppLocalEnvCheck so SSO_HOST drift can be fixed without retriggering the
// full app/agents setup wizard.
type AppLocalEnvFixer struct{}

func (f *AppLocalEnvFixer) Fix(_ context.Context, projectRoot string) error {
	return generateAppEnvSpecific(projectRoot)
}

// AgentsLocalEnvFixer regenerates agents/.env.local.{dev,test,prod}.
// Non-interactive; pairs with AgentsLocalEnvCheck.
type AgentsLocalEnvFixer struct{}

func (f *AgentsLocalEnvFixer) Fix(_ context.Context, projectRoot string) error {
	return generateAgentsEnvSpecific(projectRoot)
}

func writeFileAtomic(path string, content string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, ".env-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()

	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}

	return os.Rename(tmpPath, path)
}

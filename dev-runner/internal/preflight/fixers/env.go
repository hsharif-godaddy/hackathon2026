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
	ProjectRoot string     // when set (Target="agents"), enables the existing-file shortcut that skips the form for already-complete S2S setups
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
			Description: "Only used when GoCode Auth = api-key. Ignored in s2s mode (endpoint pinned automatically).",
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
	// Existing-file shortcut: when agents/.env already declares S2S with the
	// supporting AUTH_TYPE / AWS_PROFILE present, reuse those values and skip
	// the form. Avoids re-prompting users on upgrade just to add the newly-
	// required BASE_URL pinning. The lookup is read-only so the registered
	// fixer's state stays clean across preflight runs.
	if f.Target == "agents" && f.ProjectRoot != "" {
		if loadExistingAgentsS2SValues(f.ProjectRoot) != nil {
			return false
		}
	}
	return true
}

// Fix generates env files. Values must be set (via TUI form or synced from app)
// before calling this for the app target.
func (f *EnvFixer) Fix(ctx context.Context, projectRoot string) error {
	if f.Values != nil && f.Values.GoCodeAuth == "api-key" && f.Values.APIKey == "" {
		return fmt.Errorf("GoCode API key required when GoCode Auth = api-key")
	}

	// Single source of truth for which root the existing-file shortcut reads:
	// when the caller wired f.ProjectRoot at construction time, honor it so
	// needsForm() and Fix() agree even if a future caller passes a different
	// projectRoot to Fix(). Falls back to the framework-supplied arg otherwise.
	effectiveRoot := projectRoot
	if f.ProjectRoot != "" {
		effectiveRoot = f.ProjectRoot
	}

	// Agents can sync from app's collected values
	if f.Target == "agents" && f.AppEnvFixer != nil && f.AppEnvFixer.SyncFrom != nil {
		return f.generateAgentsEnv(effectiveRoot, f.AppEnvFixer.SyncFrom)
	}

	// Use pre-collected values
	if f.Values != nil {
		f.SyncFrom = f.Values
		if f.Target == "app" {
			return f.generateAppEnv(effectiveRoot, f.Values)
		}
		return f.generateAgentsEnv(effectiveRoot, f.Values)
	}

	// Existing-file shortcut mirroring needsForm(): no form was shown because
	// agents/.env already has a complete S2S configuration. Re-load the values
	// here (rather than caching from needsForm) so the fixer instance remains
	// stateless across preflight runs.
	if f.Target == "agents" {
		if values := loadExistingAgentsS2SValues(effectiveRoot); values != nil {
			return f.generateAgentsEnv(effectiveRoot, values)
		}
	}

	return fmt.Errorf("env fixer requires Values to be set before Fix() is called")
}

// loadExistingAgentsS2SValues returns EnvValues derived from agents/.env when
// the file already declares a complete S2S configuration (GOCODE_USE_S2S_AUTH=true
// with AUTH_TYPE and AWS_PROFILE set). Returns nil otherwise so callers fall
// back to the form path. ENOENT and I/O errors both return nil here on purpose:
// AgentsEnvCheck's loadEnvForCheck already classifies and surfaces those errors,
// and the form path will hit the same I/O error when it tries to write the file.
func loadExistingAgentsS2SValues(projectRoot string) *EnvValues {
	env, err := preflight.ParseEnvFile(filepath.Join(projectRoot, "agents/.env"))
	if err != nil {
		return nil
	}
	if !strings.EqualFold(strings.TrimSpace(env["GOCODE_USE_S2S_AUTH"]), "true") {
		return nil
	}
	authType := strings.TrimSpace(env["AUTH_TYPE"])
	awsProfile := strings.TrimSpace(env["AWS_PROFILE"])
	if authType == "" || awsProfile == "" {
		return nil
	}
	return &EnvValues{
		AuthType:   authType,
		AWSProfile: awsProfile,
		GoCodeAuth: "s2s",
	}
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
	content := fmt.Sprintf(`# Airo Builder - App Environment Configuration
# Generated by dev-runner preflight

NODE_ENV=development
PORT=3000

AUTH_TYPE=%s

# AWS Configuration
AWS_PROFILE=%s
`, v.AuthType, v.AWSProfile)

	if err := writeFileAtomic(filepath.Join(projectRoot, "app/.env"), content); err != nil {
		return err
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

# Pin S2S GoCode endpoint (s2s-auth.ts honors OPENAI_BASE_URL as an override).
OPENAI_BASE_URL="%s"
ANTHROPIC_BASE_URL="%s"

DEFAULT_PROVIDER=anthropic

APP_TEMPLATE_DIR=app-templates/v8

ENABLE_SOCIAL=false

MYSQL_ROOT_HOST=localhost
MYSQL_ROOT_PORT=3306
MYSQL_ROOT_USER=root
MYSQL_ROOT_PASS=

GODADDY_OAUTH_CLIENT_ID=c16c68eb-0c20-437c-90bd-1c78911b3d48
GODADDY_API_BASE_URL=https://api.dev-godaddy.com
AGENT_URL=http://localhost:4000

DOWNLOAD_TEMP_DIR="/tmp/apps/archives"

ENABLE_AI_DEVTOOLS=true
`, v.AuthType, v.AWSProfile, preflight.S2SGoCodeEndpoint, preflight.S2SGoCodeEndpoint)
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

ENABLE_SOCIAL=false

MYSQL_ROOT_HOST=localhost
MYSQL_ROOT_PORT=3306
MYSQL_ROOT_USER=root
MYSQL_ROOT_PASS=

GODADDY_OAUTH_CLIENT_ID=c16c68eb-0c20-437c-90bd-1c78911b3d48
GODADDY_API_BASE_URL=https://api.dev-godaddy.com
AGENT_URL=http://localhost:4000

DOWNLOAD_TEMP_DIR="/tmp/apps/archives"

ENABLE_AI_DEVTOOLS=true
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
		{"ENABLE_SOCIAL", "false", false},
		{"MYSQL_ROOT_HOST", "localhost", false},
		{"MYSQL_ROOT_PORT", "3306", false},
		{"MYSQL_ROOT_USER", "root", false},
		{"MYSQL_ROOT_PASS", "", false},
		{"GODADDY_OAUTH_CLIENT_ID", "c16c68eb-0c20-437c-90bd-1c78911b3d48", false},
		{"GODADDY_API_BASE_URL", "https://api.dev-godaddy.com", false},
		{"AGENT_URL", "http://localhost:4000", false},
		{"DOWNLOAD_TEMP_DIR", "/tmp/apps/archives", true},
		{"ENABLE_AI_DEVTOOLS", "true", false},
	}

	var modeVars []struct {
		key    string
		value  string
		quoted bool
	}
	if v.GoCodeAuth == "s2s" {
		// Remove stale api-key-mode credentials so they don't shadow the S2S
		// placeholder. The BASE_URL vars stay (pinned below): leaving the old
		// LiteLLM proxy URL would route the IAM JWT to a backend that rejects it.
		for _, key := range []string{"OPENAI_API_KEY", "ANTHROPIC_API_KEY"} {
			if err := removeEnvVar(envPath, key); err != nil {
				return fmt.Errorf("removing %s: %w", key, err)
			}
		}
		modeVars = []struct {
			key    string
			value  string
			quoted bool
		}{
			{"GOCODE_USE_S2S_AUTH", "true", false},
			{"OPENAI_BASE_URL", preflight.S2SGoCodeEndpoint, true},
			{"ANTHROPIC_BASE_URL", preflight.S2SGoCodeEndpoint, true},
		}
	} else {
		modeVars = []struct {
			key    string
			value  string
			quoted bool
		}{
			{"GOCODE_USE_S2S_AUTH", "false", false},
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
	envs := map[string]struct{ appURL, ssoHost, mgmtURL string }{
		"app/.env.local.dev": {
			appURL:  "https://local.gasket.dev-godaddy.com:8443",
			ssoHost: "sso.dev-godaddy.com",
			mgmtURL: "http://localhost:4100",
		},
		"app/.env.local.test": {
			appURL:  "https://airo-builder.test-godaddy.com",
			ssoHost: "sso.test-godaddy.com",
			mgmtURL: "https://mgmt.nstk.net",
		},
		"app/.env.local.prod": {
			appURL:  "https://airo-builder.godaddy.com",
			ssoHost: "sso.godaddy.com",
			mgmtURL: "https://mgmt.woosaas.godaddy.com",
		},
	}

	for relPath, cfg := range envs {
		content := fmt.Sprintf(`# Environment-specific configuration (generated by dev-runner)
NEXT_PUBLIC_APP_URL=%s
SSO_LOGIN_URL=https://%s/login
SSO_LOGOUT_URL=https://%s/logout
SSO_HOST=%s
LOGIN_REDIRECT_URL=%s/
MGMT_AIRO_BASE_URL=%s
`, cfg.appURL, cfg.ssoHost, cfg.ssoHost, cfg.ssoHost, cfg.appURL, cfg.mgmtURL)

		if err := writeFileAtomic(filepath.Join(projectRoot, relPath), content); err != nil {
			return err
		}
	}
	return nil
}

func generateAgentsEnvSpecific(projectRoot string) error {
	envs := map[string]struct{ jwksURL, ssoHost string }{
		"agents/.env.local.dev": {
			jwksURL: "https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json",
			ssoHost: "sso.dev-godaddy.com",
		},
		"agents/.env.local.test": {
			jwksURL: "https://airo-builder.test-godaddy.com/.well-known/jwks.json",
			ssoHost: "sso.test-godaddy.com",
		},
		"agents/.env.local.prod": {
			jwksURL: "https://airo-builder.godaddy.com/.well-known/jwks.json",
			ssoHost: "sso.godaddy.com",
		},
	}

	for relPath, cfg := range envs {
		content := fmt.Sprintf(`# Environment-specific configuration (generated by dev-runner)
JWKS_URL=%s
SSO_HOST=%s
`, cfg.jwksURL, cfg.ssoHost)

		if err := writeFileAtomic(filepath.Join(projectRoot, relPath), content); err != nil {
			return err
		}
	}
	return nil
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

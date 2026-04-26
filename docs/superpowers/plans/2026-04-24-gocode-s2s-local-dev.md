# GoCode S2S Auth for Local Dev Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let local dev use GoCode via S2S (IAM JWT) auth with the developer's AWS SSO profile, routing to dev GoCode (`api.gocode.caas.dev-gdcorp.tools`), while keeping the current API-key path as the default.

**Architecture:** The S2S machinery already exists in `packages/ai-lib/src/utils/s2s-auth.ts` (gated by `GOCODE_USE_S2S_AUTH=true`). This plan wires two things: (1) a CDK change to let the developer SSO role assume the existing dev `airo-builder-gocode-access` role so `IamTokenClient` can mint an IAM JWT with an allowed principal; (2) a dev-runner TUI toggle (`GoCode Auth: api-key | s2s`) that writes the correct env vars into `agents/.env`. `AUTH_TYPE` (user→app JWT) is untouched.

**Tech Stack:** Go (dev-runner, Bubble Tea v2), TypeScript (CDK, aws-cdk-lib), pnpm workspaces.

---

## File Structure

**Create:**

- _(none)_

**Modify:**

- `cdk/lib/config.ts` - add dev SSO role ARN to `gocodeAssumeRoleArns` for the dev-private config.
- `dev-runner/internal/preflight/fixers/env.go` - add `GoCodeAuth` field to `EnvValues`, add form field, conditionally write `GOCODE_USE_S2S_AUTH`, skip API key when S2S.
- `dev-runner/internal/preflight/checks/env.go` - in `AgentsEnvCheck`, when `GOCODE_USE_S2S_AUTH=true` don't require `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`.
- `dev-runner/internal/preflight/fixers/image_search_env.go` - when S2S mode, skip copying `OPENAI_API_KEY` into image-search env (or fall back to the AWS profile path if it already supports that). Verify and only change if needed.

**Test:**

- `dev-runner/internal/preflight/fixers/env_test.go` - create; covers form fields, upsert behavior for both modes.
- `dev-runner/internal/preflight/checks/env_test.go` - create or extend; covers relaxed key requirement in S2S mode.

---

## Pre-flight

- [ ] **Step 0: Confirm dev SSO role ARN**

Need the exact ARN the `airobuild-dev-private-sso` profile assumes into. Run:

```bash
AWS_PROFILE=airobuild-dev-private-sso aws sts get-caller-identity
```

Expected output contains `"Arn": "arn:aws:sts::<acct>:assumed-role/<role-name>/<session>"`. Extract the underlying role ARN: `arn:aws:iam::<acct>:role/<role-name>`. This is the ARN to add to trust policy in Task 1.

If multiple developers will use this, prefer the canonical SSO role backing dev-private (commonly `GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser` at `arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser` - already present in `gocodeAssumeRoleArns`, so likely nothing to add). Verify which role is actually assumed; if it's already in the list, skip Task 1.

Record the ARN here before proceeding: `__________________________`.

---

## Task 1: CDK - trust dev SSO role on the GoCode-access role

**Files:**

- Modify: `cdk/lib/config.ts` (dev-private config block, `gocodeAssumeRoleArns` around line 98)

Only do this task if Step 0 found the dev SSO role is NOT already in `gocodeAssumeRoleArns`. If it is (`GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser` is already there), skip to Task 2.

- [ ] **Step 1: Add ARN to dev config**

Edit `cdk/lib/config.ts` dev-private `gocodeAssumeRoleArns` array, appending the ARN from Step 0 if missing. Example:

```typescript
gocodeAssumeRoleArns: [
  'arn:aws:iam::418549769352:role/pioneerc1-custom-pioneerc1-hybrid-instance-c4-onegroup',
  'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser',
  'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Ops',
  'arn:aws:iam::694282668781:role/airobuilde-custom-dev-gocode-spend-sync-role',
  'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment9411GlobalEcsTaskRole438D3922',
  // '<NEW ARN FROM STEP 0>',
],
```

- [ ] **Step 2: Synth to verify**

```bash
cd cdk && pnpm install && pnpm run synth -- --context env=dev-private
```

Expected: synth succeeds; diff shows the new principal added to `AiroBuilderStack`'s `GoCodeAccessRole` trust policy.

- [ ] **Step 3: Commit**

```bash
git add cdk/lib/config.ts
git commit -m "chore(cdk): allow dev SSO role to assume GoCode access role"
```

- [ ] **Step 4: Deploy (out-of-band)**

Deployment is a separate operation via the team's CDK pipeline. Note in the PR body that the stack must be deployed before devs can use S2S mode locally. Do not run `cdk deploy` from the plan.

---

## Task 2: AWS profile - document role chain for devs

**Files:**

- Modify: `GETTING_STARTED.md` (add section: "Optional: S2S auth for GoCode")
- Modify: `dev-runner/README.md` (mention the new GoCode Auth field briefly)

- [ ] **Step 1: Draft docs**

Add a section to `GETTING_STARTED.md`:

```markdown
### Optional: S2S auth for GoCode

As an alternative to the personal GoCode API key, local dev can authenticate to GoCode using your AWS SSO credentials and an IAM JWT (same mechanism deployed services use).

1. Select `GoCode Auth: s2s` in the dev-runner env form (or set `GOCODE_USE_S2S_AUTH=true` in `agents/.env`).
2. Ensure `AWS_PROFILE` points to a profile whose assumed role is trusted by `airobuilde-custom-dev-airo-builder-gocode-access`. The default `airobuild-dev-private-sso` profile is pre-configured.
3. Run `aws sso login --profile airobuild-dev-private-sso` before starting `pnpm run dev`.

This routes all GoCode/Anthropic calls through `https://api.gocode.caas.dev-gdcorp.tools` (dev GoCode, separate spend bucket from prod). No personal API key is needed.
```

- [ ] **Step 2: Commit**

```bash
git add GETTING_STARTED.md dev-runner/README.md
git commit -m "docs: document GoCode S2S auth option for local dev"
```

---

## Task 3: dev-runner - add GoCodeAuth to EnvValues

**Files:**

- Modify: `dev-runner/internal/preflight/fixers/env.go`

- [ ] **Step 1: Extend the struct**

Edit `EnvValues` (top of `env.go`) to add a `GoCodeAuth` field:

```go
type EnvValues struct {
    AIProvider  string
    APIKey      string
    BaseURL     string
    AuthType    string
    AWSProfile  string
    GoCodeAuth  string // "api-key" or "s2s"
}
```

- [ ] **Step 2: Extend defaults**

In `DefaultEnvValues()`:

```go
func DefaultEnvValues() *EnvValues {
    values := &EnvValues{
        BaseURL:    "https://caas-gocode-prod.caas-prod.prod.onkatana.net",
        AuthType:   "jwt",
        AWSProfile: defaultAWSProfile,
        GoCodeAuth: "api-key",
    }
    if envKey := os.Getenv("APPBUILDER_GOCODE_API_TOKEN"); envKey != "" {
        values.APIKey = envKey
    }
    return values
}
```

- [ ] **Step 3: Commit**

```bash
git add dev-runner/internal/preflight/fixers/env.go
git commit -m "feat(dev-runner): add GoCodeAuth field to EnvValues"
```

---

## Task 4: dev-runner - add GoCode Auth form field

**Files:**

- Modify: `dev-runner/internal/preflight/fixers/env.go` (`FormFields`, `SetFormValues`)

- [ ] **Step 1: Add form field**

Replace the returned slice in `FormFields()` with:

```go
return []preflight.FormField{
    {
        Key:     "gocodeAuth",
        Label:   "GoCode Auth",
        Description: "api-key = personal GoCode key (current default); s2s = AWS IAM JWT via dev GoCode",
        Default: defaults.GoCodeAuth,
        Options: []string{"api-key", "s2s"},
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
        Key:     "baseURL",
        Label:   "GoCode Base URL",
        Description: "Only used when GoCode Auth = api-key. Ignored in s2s mode (endpoint derives from NODE_ENV).",
        Default: defaults.BaseURL,
    },
    {
        Key:     "authType",
        Label:   "App Auth Type",
        Description: "User authentication to the app (unrelated to GoCode auth)",
        Default: defaults.AuthType,
        Options: []string{"jwt", "mock"},
    },
    {
        Key:         "awsProfile",
        Label:       "AWS Profile",
        Description: "AWS SSO profile for S2S auth (GoCode, logo, budget, knowledge services)",
        Default:     defaults.AWSProfile,
    },
}
```

Note: `apiKey.Required` drops to `false` because it is only required in `api-key` mode; we validate conditionally in the `Fix` path.

- [ ] **Step 2: Update SetFormValues**

```go
func (f *EnvFixer) SetFormValues(values map[string]string) {
    authType := strings.TrimSpace(values["authType"])
    if authType == "none" {
        authType = "mock"
    }
    gocodeAuth := strings.TrimSpace(values["gocodeAuth"])
    if gocodeAuth == "" {
        gocodeAuth = "api-key"
    }
    f.Values = &EnvValues{
        APIKey:     strings.TrimSpace(values["apiKey"]),
        BaseURL:    strings.TrimSpace(values["baseURL"]),
        AuthType:   authType,
        AWSProfile: strings.TrimSpace(values["awsProfile"]),
        GoCodeAuth: gocodeAuth,
    }
}
```

- [ ] **Step 3: Validate api-key requires key**

Add a guard at the top of `Fix` (before writing files):

```go
if f.Values != nil && f.Values.GoCodeAuth == "api-key" && f.Values.APIKey == "" {
    return fmt.Errorf("GoCode API key required when GoCode Auth = api-key")
}
```

- [ ] **Step 4: Build**

Run: `cd dev-runner && make check`
Expected: vet/lint/test pass.

- [ ] **Step 5: Commit**

```bash
git add dev-runner/internal/preflight/fixers/env.go
git commit -m "feat(dev-runner): add GoCode Auth selector to env form"
```

---

## Task 5: dev-runner - write S2S-mode agents/.env

**Files:**

- Modify: `dev-runner/internal/preflight/fixers/env.go` (`generateAgentsEnv`)

The existing function handles two paths: first-time create (template) and upsert. Both must honor S2S mode.

- [ ] **Step 1: Update the first-time template**

Replace the `fmt.Sprintf` template block in `generateAgentsEnv` with branching:

```go
if _, err := os.Stat(envPath); os.IsNotExist(err) {
    var content string
    if v.GoCodeAuth == "s2s" {
        content = fmt.Sprintf(`# Airo Builder - Agents Environment Configuration
# Generated by dev-runner preflight

NODE_ENV=development

AUTH_TYPE=%s

# S2S Authentication (GoCode, logo generation, budget service, knowledge service, etc.)
AWS_PROFILE=%s
GOCODE_USE_S2S_AUTH=true

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
`, v.AuthType, v.AWSProfile)
    } else {
        content = fmt.Sprintf(`# Airo Builder - Agents Environment Configuration
# Generated by dev-runner preflight

NODE_ENV=development

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
`, v.AuthType, v.AWSProfile, v.APIKey, v.BaseURL, v.APIKey, v.BaseURL)
    }

    if err := writeFileAtomic(envPath, content); err != nil {
        return err
    }
    return generateAgentsEnvSpecific(projectRoot)
}
```

- [ ] **Step 2: Update the upsert path**

Replace the static `vars` slice with a mode-dependent one:

```go
baseVars := []struct {
    key    string
    value  string
    quoted bool
}{
    {"NODE_ENV", "development", false},
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
    modeVars = []struct {
        key    string
        value  string
        quoted bool
    }{
        {"GOCODE_USE_S2S_AUTH", "true", false},
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
```

Note: we leave stale `OPENAI_*`/`ANTHROPIC_*` lines in place when switching to S2S. They're harmless (S2S path ignores them) and keeps the upsert simple. If a future task needs them removed, add a `removeEnvVar` helper then.

- [ ] **Step 3: Build**

Run: `cd dev-runner && make check`
Expected: pass.

- [ ] **Step 4: Manual smoke test**

```bash
cd dev-runner && make build
rm agents/.env  # force first-time path
./dist/dev-runner  # select GoCode Auth: s2s, fill AWS Profile
grep GOCODE_USE_S2S_AUTH ../agents/.env
```

Expected: `GOCODE_USE_S2S_AUTH=true` present; no `OPENAI_API_KEY` line.

Then repeat with `api-key`: restart, select `api-key`, provide a dummy key. Expected: `GOCODE_USE_S2S_AUTH=false`, `OPENAI_API_KEY="<dummy>"` present.

- [ ] **Step 5: Commit**

```bash
git add dev-runner/internal/preflight/fixers/env.go
git commit -m "feat(dev-runner): write GOCODE_USE_S2S_AUTH in s2s mode"
```

---

## Task 6: dev-runner - relax Agents env check in S2S mode

**Files:**

- Modify: `dev-runner/internal/preflight/checks/env.go` (`AgentsEnvCheck.Run`)

- [ ] **Step 1: Write failing test**

Create `dev-runner/internal/preflight/checks/env_test.go` if it doesn't exist:

```go
package checks

import (
    "context"
    "os"
    "path/filepath"
    "testing"

    "github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestAgentsEnvCheck_S2SMode_NoAPIKeyRequired(t *testing.T) {
    root := t.TempDir()
    if err := os.MkdirAll(filepath.Join(root, "agents"), 0o755); err != nil {
        t.Fatal(err)
    }
    content := `NODE_ENV=development
AUTH_TYPE=jwt
GOCODE_USE_S2S_AUTH=true
AWS_PROFILE=airobuild-dev-private-sso
`
    if err := os.WriteFile(filepath.Join(root, "agents/.env"), []byte(content), 0o644); err != nil {
        t.Fatal(err)
    }
    c := &AgentsEnvCheck{}
    res := c.Run(context.Background(), root)
    if res.Status != preflight.StatusPass {
        t.Fatalf("expected pass, got %v: %s", res.Status, res.Message)
    }
}

func TestAgentsEnvCheck_APIKeyMode_RequiresOpenAIKey(t *testing.T) {
    root := t.TempDir()
    if err := os.MkdirAll(filepath.Join(root, "agents"), 0o755); err != nil {
        t.Fatal(err)
    }
    content := `NODE_ENV=development
AUTH_TYPE=jwt
AWS_PROFILE=airobuild-dev-private-sso
`
    if err := os.WriteFile(filepath.Join(root, "agents/.env"), []byte(content), 0o644); err != nil {
        t.Fatal(err)
    }
    c := &AgentsEnvCheck{}
    res := c.Run(context.Background(), root)
    if res.Status == preflight.StatusPass {
        t.Fatalf("expected fail (missing OPENAI_API_KEY), got pass")
    }
}
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `cd dev-runner && go test ./internal/preflight/checks/... -run AgentsEnvCheck -v`
Expected: FAIL on the S2S test (still requires OPENAI_API_KEY).

- [ ] **Step 3: Update the check**

Edit `AgentsEnvCheck.Run` in `dev-runner/internal/preflight/checks/env.go`:

```go
func (c *AgentsEnvCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
    required := []string{
        "NODE_ENV",
        "AUTH_TYPE",
    }

    // Peek at GOCODE_USE_S2S_AUTH to decide whether API keys are required.
    env, _ := readEnvFile(filepath.Join(projectRoot, "agents/.env"))
    if strings.ToLower(strings.TrimSpace(env["GOCODE_USE_S2S_AUTH"])) == "true" {
        required = append(required, "AWS_PROFILE", "GOCODE_USE_S2S_AUTH")
    } else {
        required = append(required,
            "OPENAI_API_KEY",
            "OPENAI_BASE_URL",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_BASE_URL",
        )
    }

    result, _ := checkEnvFile(projectRoot, "agents/.env", required, c.Name(), c.Category())
    return result
}
```

If `readEnvFile` doesn't exist as a helper, reuse the parsing already inside `checkEnvFile`. Inspect `dev-runner/internal/preflight/checks/env.go` first; if no such helper exists, extract the parse step into a private helper (`parseEnvFile(path string) (map[string]string, error)`) and use it from both `checkEnvFile` and `AgentsEnvCheck.Run`.

- [ ] **Step 4: Run test to confirm it passes**

Run: `cd dev-runner && go test ./internal/preflight/checks/... -run AgentsEnvCheck -v`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add dev-runner/internal/preflight/checks/env.go dev-runner/internal/preflight/checks/env_test.go
git commit -m "feat(dev-runner): relax agents env check when GOCODE_USE_S2S_AUTH=true"
```

---

## Task 7: dev-runner - image-search env should not require GoCode key in S2S mode

**Files:**

- Modify: `dev-runner/internal/preflight/fixers/image_search_env.go` (only if it reads `OPENAI_API_KEY` from agents env)

- [ ] **Step 1: Inspect**

Read `dev-runner/internal/preflight/fixers/image_search_env.go` end-to-end. Note: the header comment says it "copies the GoCode API keys". If the fixer errors when the key is absent, it breaks S2S mode.

- [ ] **Step 2: If it fails on missing key, make it optional in S2S mode**

If needed, guard the API-key copy when agents' `GOCODE_USE_S2S_AUTH=true`: either skip populating the key or set a placeholder. Example pattern:

```go
s2sEnabled := strings.ToLower(strings.TrimSpace(env["GOCODE_USE_S2S_AUTH"])) == "true"
if s2sEnabled {
    // image-search service uses its own S2S/IAM path or does not need the key in this mode
    return nil // or write the subset of env vars that still apply
}
```

The exact change depends on image-search-service capabilities; if image-search does not support S2S, document the limitation and keep requiring the user-supplied API key in api-key mode only. Do not silently generate a fake key.

- [ ] **Step 3: Build and test**

```bash
cd dev-runner && make check
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add dev-runner/internal/preflight/fixers/image_search_env.go
git commit -m "fix(dev-runner): handle GoCode S2S mode in image-search env fixer"
```

If no changes were needed (the fixer is already tolerant), skip this commit and note the finding in the PR description.

---

## Task 8: End-to-end smoke test

- [ ] **Step 1: Run dev-runner in S2S mode**

```bash
aws sso login --profile airobuild-dev-private-sso
cd /Users/deverton/work/gdcorp-partners/airo-app-builder
rm -f agents/.env
./dev-runner/dist/dev-runner  # select GoCode Auth: s2s, AWS Profile: airobuild-dev-private-sso
```

Expected: preflight passes; TUI shows all processes green. `agents/.env` contains `GOCODE_USE_S2S_AUTH=true` and `AWS_PROFILE=...`, no `OPENAI_API_KEY`.

- [ ] **Step 2: Start agents and send a prompt**

In the running dev-runner, wait for agents to report ready (port 4000). Tail logs for `s2s.auth.token.*` domain. Send a message through the app UI that triggers an agent LLM call.

Expected: agents logs show a successful token fetch; the call goes to `api.gocode.caas.dev-gdcorp.tools/v1/...` (log the URL in dev or attach a breakpoint); the response arrives without `401`.

- [ ] **Step 3: Switch back to api-key mode**

Restart dev-runner, pick `GoCode Auth: api-key`, paste a personal key. Expected: `OPENAI_API_KEY` written, `GOCODE_USE_S2S_AUTH=false`, agents still works.

- [ ] **Step 4: Document results in the PR**

Record in the PR body: date, AWS profile used, token expiration observed, and any failures.

---

## Self-Review Notes

- **Spec coverage:** CDK trust, dev-runner form, env writer, env check, image-search fixer, docs, smoke test — all covered.
- **Out of scope (intentionally):** app/.env changes (user auth is independent), deployed environment changes, removal of stale `OPENAI_*` lines on mode switch, local:test inconsistency between `SSO_HOST` and `NODE_ENV`-derived GoCode endpoint.
- **Prod GoCode isolation:** preserved. S2S from local always routes to dev GoCode because `NODE_ENV=development` in agents/.env and the dev role has no access to prod GoCode.
- **Rollback:** revert the env.go change; existing agents/.env files keep working because `GOCODE_USE_S2S_AUTH` defaults to unset → `false`.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-04-24-gocode-s2s-local-dev.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** - execute tasks in this session using executing-plans.

Which approach?

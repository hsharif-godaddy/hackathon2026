package fixers

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestEvalProbeEnvFixer_FirstTimeCreate_S2S(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", `GOCODE_USE_S2S_AUTH=true
AWS_PROFILE=custom-dev-profile
OPENAI_BASE_URL=https://custom-gocode.example
OPENAI_API_KEY=sk-stale
`)

	if err := (&EvalProbeEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "evals/gosym-probe/.env"))
	assertEq(t, env, "GD_ENV", "local.dev")
	assertEq(t, env, "OPENAI_BASE_URL", "https://custom-gocode.example")
	assertEq(t, env, "AWS_PROFILE", "custom-dev-profile")
	assertEq(t, env, "OPENAI_MODEL", "claude-sonnet-4-6")
	assertAbsent(t, env, "OPENAI_API_KEY")
}

func TestEvalProbeEnvFixer_FirstTimeCreate_APIKey(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", `GOCODE_USE_S2S_AUTH=false
AWS_PROFILE=custom-dev-profile
OPENAI_BASE_URL=https://custom-gocode.example
OPENAI_API_KEY=sk-live
`)

	if err := (&EvalProbeEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "evals/gosym-probe/.env"))
	assertEq(t, env, "GD_ENV", "local.dev")
	assertEq(t, env, "OPENAI_BASE_URL", "https://custom-gocode.example")
	assertEq(t, env, "PROBE_OPENAI_API_KEY", "sk-live")
	assertAbsent(t, env, "OPENAI_API_KEY")
	assertEq(t, env, "AWS_PROFILE", "custom-dev-profile")
	assertEq(t, env, "OPENAI_MODEL", "claude-sonnet-4-6")
}

func TestEvalProbeEnvFixer_FirstTimeCreate_MissingAgentsEnvDefaults(t *testing.T) {
	root := t.TempDir()

	if err := (&EvalProbeEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "evals/gosym-probe/.env"))
	assertEq(t, env, "GD_ENV", "local.dev")
	assertEq(t, env, "OPENAI_BASE_URL", defaultGoCodeBaseURL)
	assertEq(t, env, "AWS_PROFILE", defaultAWSProfile)
	assertEq(t, env, "OPENAI_MODEL", "claude-sonnet-4-6")
	assertAbsent(t, env, "OPENAI_API_KEY")
}

func TestEvalProbeEnvFixer_UpsertPreservesCustomAndRemovesStaleKeyInS2S(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", `GOCODE_USE_S2S_AUTH=true
AWS_PROFILE=s2s-profile
OPENAI_BASE_URL=https://s2s-base.example
`)

	probeDir := filepath.Join(root, "evals/gosym-probe")
	if err := os.MkdirAll(probeDir, 0o755); err != nil {
		t.Fatalf("mkdir probe dir: %v", err)
	}
	existing := `GD_ENV=local.test
OPENAI_BASE_URL="https://old-base.example"
OPENAI_API_KEY="sk-old"
OPENAI_MODEL=old-model
MAX_CONCURRENCY=5
`
	if err := os.WriteFile(filepath.Join(probeDir, ".env"), []byte(existing), 0o600); err != nil {
		t.Fatalf("write probe .env: %v", err)
	}

	if err := (&EvalProbeEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "evals/gosym-probe/.env"))
	assertEq(t, env, "GD_ENV", "local.dev")
	assertEq(t, env, "OPENAI_BASE_URL", "https://s2s-base.example")
	assertEq(t, env, "AWS_PROFILE", "s2s-profile")
	assertEq(t, env, "OPENAI_MODEL", "claude-sonnet-4-6")
	assertEq(t, env, "MAX_CONCURRENCY", "5")
	assertAbsent(t, env, "PROBE_OPENAI_API_KEY")
	assertAbsent(t, env, "OPENAI_API_KEY")
}

func TestEvalProbeEnvFixer_UpsertWritesNewKeyAndRemovesLegacyInAPIKeyMode(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "agents", `GOCODE_USE_S2S_AUTH=false
AWS_PROFILE=dev-profile
OPENAI_BASE_URL=https://api-key-base.example
OPENAI_API_KEY=sk-agents-key
`)

	probeDir := filepath.Join(root, "evals/gosym-probe")
	if err := os.MkdirAll(probeDir, 0o755); err != nil {
		t.Fatalf("mkdir probe dir: %v", err)
	}
	existing := `GD_ENV=local.dev
OPENAI_BASE_URL="https://old-base.example"
OPENAI_API_KEY="sk-old-probe-key"
OPENAI_MODEL=claude-sonnet-4-5
MAX_CONCURRENCY=3
`
	if err := os.WriteFile(filepath.Join(probeDir, ".env"), []byte(existing), 0o600); err != nil {
		t.Fatalf("write probe .env: %v", err)
	}

	if err := (&EvalProbeEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	env := readEnvMap(t, filepath.Join(root, "evals/gosym-probe/.env"))
	assertEq(t, env, "PROBE_OPENAI_API_KEY", "sk-agents-key")
	assertAbsent(t, env, "OPENAI_API_KEY")
	assertEq(t, env, "OPENAI_BASE_URL", "https://api-key-base.example")
	assertEq(t, env, "GD_ENV", "local.dev")
	assertEq(t, env, "AWS_PROFILE", "dev-profile")
	assertEq(t, env, "OPENAI_MODEL", "claude-sonnet-4-6")
	assertEq(t, env, "MAX_CONCURRENCY", "3")
}

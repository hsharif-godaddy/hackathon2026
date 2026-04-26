package checks

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// clearShellConflictVars unsets all vars tracked by ShellEnvConflictCheck,
// restoring their prior values via t.Cleanup. Tests call this as their
// baseline, then t.Setenv the specific vars they want present.
func clearShellConflictVars(t *testing.T) {
	t.Helper()
	for _, key := range shellConflictVars {
		prev, had := os.LookupEnv(key)
		_ = os.Unsetenv(key)
		if had {
			key := key
			prev := prev
			t.Cleanup(func() { _ = os.Setenv(key, prev) })
		}
	}
}

func TestShellEnvConflictCheck_NoShellOverrides(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "NODE_ENV=development\nGOCODE_USE_S2S_AUTH=true\n")
	clearShellConflictVars(t)

	result := (&ShellEnvConflictCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Fatalf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestShellEnvConflictCheck_ShellOverridesDifferFromFile(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, strings.Join([]string{
		"NODE_ENV=development",
		"GOCODE_USE_S2S_AUTH=true",
	}, "\n"))
	clearShellConflictVars(t)
	t.Setenv("OPENAI_BASE_URL", "https://caas-gocode-prod.caas-prod.prod.onkatana.net")
	t.Setenv("OPENAI_API_KEY", "sk-some-shell-key")

	result := (&ShellEnvConflictCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Fatalf("expected Warn, got %v: %s", result.Status, result.Message)
	}
	if !strings.Contains(result.Message, "OPENAI_BASE_URL") || !strings.Contains(result.Message, "OPENAI_API_KEY") {
		t.Fatalf("expected both OPENAI_* vars in message, got: %s", result.Message)
	}
}

func TestShellEnvConflictCheck_ShellAndFileAgree(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, strings.Join([]string{
		"NODE_ENV=development",
		`OPENAI_BASE_URL="https://caas-gocode-prod.caas-prod.prod.onkatana.net"`,
	}, "\n"))
	clearShellConflictVars(t)
	t.Setenv("OPENAI_BASE_URL", "https://caas-gocode-prod.caas-prod.prod.onkatana.net")

	result := (&ShellEnvConflictCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Fatalf("expected Pass (values agree), got %v: %s", result.Status, result.Message)
	}
}

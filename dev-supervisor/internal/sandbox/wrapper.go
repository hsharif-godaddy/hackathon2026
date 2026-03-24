package sandbox

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// WrapCommand returns an exec.Cmd that runs the command inside the airo-sandbox
// binary with the given sandbox spec. The command's environment is built from
// baseEnv with AIRO_SANDBOX_CONFIG injected.
//
// If sandbox is disabled, returns (nil, nil) — caller should fall through to
// direct execution.
func WrapCommand(ctx context.Context, cfg Config, spec Spec, baseEnv []string) (*exec.Cmd, error) {
	if !cfg.Enabled {
		return nil, nil //nolint:nilnil // nil cmd signals "sandbox disabled, use direct exec"
	}

	// Validate that the sandbox binary exists before attempting to use it
	if _, err := os.Stat(cfg.BinaryPath); err != nil {
		return nil, fmt.Errorf("sandbox binary not found at %s: %w", cfg.BinaryPath, err)
	}

	env, err := BuildEnv(baseEnv, spec)
	if err != nil {
		return nil, err
	}

	//nolint:gosec // G204: Sandbox binary path is from trusted config
	cmd := exec.CommandContext(ctx, cfg.BinaryPath)
	cmd.Dir = spec.WorkDir
	cmd.Env = env

	return cmd, nil
}

// BuildEnv returns a copy of the base environment with AIRO_SANDBOX_CONFIG set.
// Any existing AIRO_SANDBOX_CONFIG is removed first.
//
// Returns an error if the spec cannot be serialized — callers must not fall
// through to unsandboxed execution on error.
func BuildEnv(baseEnv []string, spec Spec) ([]string, error) {
	// Always filter first so we never return stale config on error paths.
	filtered := FilterEnv(baseEnv, "AIRO_SANDBOX_CONFIG")

	configJSON, err := json.Marshal(spec)
	if err != nil {
		return nil, fmt.Errorf("sandbox: failed to marshal config: %w", err)
	}

	return append(filtered, "AIRO_SANDBOX_CONFIG="+string(configJSON)), nil
}

// FilterEnv returns a copy of environ with the named variable removed.
func FilterEnv(environ []string, name string) []string {
	prefix := name + "="
	filtered := make([]string, 0, len(environ))
	for _, entry := range environ {
		if !strings.HasPrefix(entry, prefix) {
			filtered = append(filtered, entry)
		}
	}
	return filtered
}

// airo-sandbox applies Landlock LSM restrictions before exec-ing a child command.
//
// It reads sandbox configuration from the AIRO_SANDBOX_CONFIG environment variable (JSON),
// removes that variable from the child environment, applies kernel-level filesystem and
// network restrictions (on Linux), and replaces itself with `sh -c <command>`.
//
// On non-Linux platforms, it logs a warning and execs the command without sandboxing.
package main

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
)

// exitCodeSandboxError is used for airo-sandbox's own failures (config parse,
// Landlock apply, exec failure). This distinguishes sandbox infrastructure errors
// from child process exit codes. Matches docker run's convention for daemon errors.
const exitCodeSandboxError = 125

func main() {
	configJSON := os.Getenv("AIRO_SANDBOX_CONFIG")
	if configJSON == "" {
		slog.Error("airo-sandbox: AIRO_SANDBOX_CONFIG environment variable is required")
		os.Exit(exitCodeSandboxError)
	}

	cfg, err := ParseConfig([]byte(configJSON))
	if err != nil {
		slog.Error("airo-sandbox: invalid config", "error", err)
		os.Exit(exitCodeSandboxError)
	}

	// Build child environment without AIRO_SANDBOX_CONFIG
	env := sandbox.FilterEnv(os.Environ(), "AIRO_SANDBOX_CONFIG")

	// Apply sandbox and exec (platform-specific)
	// On success, syscall.Exec replaces this process — we never return.
	// If we get here, exec failed (binary not found, Landlock error, etc.)
	if err := applySandboxAndExec(cfg, env); err != nil {
		slog.Error("airo-sandbox: failed", "error", err)
		os.Exit(exitCodeSandboxError)
	}
}

// findBinary locates a binary by checking common paths.
func findBinary(name string) (string, error) {
	paths := []string{
		"/bin/" + name,
		"/usr/bin/" + name,
	}
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("binary %q not found in /bin or /usr/bin", name)
}

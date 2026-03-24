//go:build !linux && !windows

package main

import (
	"fmt"
	"log/slog"
	"os"
	"syscall"
)

// applySandboxAndExec on non-Linux Unix platforms (e.g., macOS) logs a warning and
// execs without sandboxing. Landlock is Linux-specific; this fallback uses sh -c
// which requires a POSIX shell (not available on Windows).
func applySandboxAndExec(cfg *SandboxConfig, env []string) error {
	slog.Warn("airo-sandbox: landlock not available on this platform, executing without sandbox",
		"command", cfg.Command,
		"work_dir", cfg.WorkDir,
	)

	shPath, err := findBinary("sh")
	if err != nil {
		return err
	}

	// Change to working directory before exec
	if err := os.Chdir(cfg.WorkDir); err != nil {
		return fmt.Errorf("failed to chdir to %s: %w", cfg.WorkDir, err)
	}

	argv := []string{"sh", "-c", cfg.Command}

	// nosemgrep: go.lang.security.audit.dangerous-syscall-exec.dangerous-syscall-exec
	// Intentional: airo-sandbox is a security sandbox binary; on non-Linux platforms it falls
	// back to exec without Landlock (for local dev only).
	return syscall.Exec(shPath, argv, env)
}

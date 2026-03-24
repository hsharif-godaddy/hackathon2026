//go:build linux

package main

import (
	"fmt"
	"log/slog"
	"os"
	"syscall"

	"github.com/landlock-lsm/go-landlock/landlock"
	llsyscall "github.com/landlock-lsm/go-landlock/landlock/syscall"

	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
)

// pathToRule converts a PathRule to a Landlock rule. Returns (rule, true) on
// success or (zero, false) if the path doesn't exist or has no applicable rights.
func pathToRule(p sandbox.PathRule) (landlock.Rule, bool) {
	info, err := os.Stat(p.Path)
	if err != nil {
		return nil, false
	}
	access := modeToAccessFS(p.Mode)
	if !info.IsDir() {
		access = fileAccessOnly(access)
	}
	if access == 0 {
		slog.Debug("airo-sandbox: no applicable access rights for path",
			"path", p.Path, "mode", p.Mode, "is_dir", info.IsDir())
		return nil, false
	}
	return landlock.PathAccess(access, p.Path), true
}

// applySandboxAndExec applies Landlock restrictions, then replaces the process with sh -c <command>.
func applySandboxAndExec(cfg *SandboxConfig, env []string) error {
	// Build Landlock rules from config
	rules := buildLandlockRules(cfg)

	// Detect kernel Landlock support level and log it
	abiVersion, abiErr := llsyscall.LandlockGetABIVersion()
	if abiErr != nil {
		slog.Warn("airo-sandbox: landlock not supported by kernel", "error", abiErr)
	} else if abiVersion < 4 {
		slog.Warn("airo-sandbox: landlock ABI too old for network restrictions, only filesystem rules will apply",
			"kernel_abi", abiVersion, "requested_abi", 6)
	} else if abiVersion < 6 {
		slog.Warn("airo-sandbox: landlock ABI below requested version, some restrictions may not apply",
			"kernel_abi", abiVersion, "requested_abi", 6)
	}

	// Apply Landlock with BestEffort (degrades gracefully on older kernels)
	// Silent on success — airo-sandbox is a transparent wrapper, its stderr
	// becomes the child command's stderr which callers may parse.
	if err := landlock.V6.BestEffort().Restrict(rules...); err != nil {
		return fmt.Errorf("failed to apply landlock restrictions: %w", err)
	}

	return execCommand(cfg, env)
}

// modeToAccessFS converts an unveil-style mode string to Landlock AccessFSSet flags
// for a directory path. For regular files, pass the result through fileAccessOnly().
func modeToAccessFS(mode string) landlock.AccessFSSet {
	var access landlock.AccessFSSet
	for _, c := range mode {
		switch c {
		case 'r':
			access |= llsyscall.AccessFSReadFile | llsyscall.AccessFSReadDir
		case 'w':
			access |= llsyscall.AccessFSWriteFile | llsyscall.AccessFSTruncate
		case 'x':
			access |= llsyscall.AccessFSExecute
		case 'c':
			access |= llsyscall.AccessFSMakeReg | llsyscall.AccessFSMakeDir |
				llsyscall.AccessFSMakeSock | llsyscall.AccessFSMakeFifo |
				llsyscall.AccessFSMakeBlock | llsyscall.AccessFSMakeSym |
				llsyscall.AccessFSMakeChar | llsyscall.AccessFSRemoveFile |
				llsyscall.AccessFSRemoveDir | llsyscall.AccessFSRefer
		}
	}
	return access
}

// accessFSFileOnly are the Landlock access rights valid for regular files.
const accessFSFileOnly = llsyscall.AccessFSReadFile |
	llsyscall.AccessFSWriteFile |
	llsyscall.AccessFSExecute |
	llsyscall.AccessFSTruncate

// fileAccessOnly masks an AccessFSSet to only include rights valid for regular files.
// Landlock rejects directory-only rights (ReadDir, MakeReg, etc.) on regular files.
func fileAccessOnly(access landlock.AccessFSSet) landlock.AccessFSSet {
	return access & accessFSFileOnly
}

// buildLandlockRules constructs Landlock path and network rules from config.
func buildLandlockRules(cfg *SandboxConfig) []landlock.Rule {
	var rules []landlock.Rule

	// Apply default paths first (missing defaults are expected — multi-distro)
	if cfg.Defaults {
		defaultRulesStart := len(rules)
		for _, p := range defaultPaths() {
			if r, ok := pathToRule(p); ok {
				rules = append(rules, r)
			} else {
				slog.Debug("airo-sandbox: skipping non-existent default path",
					"path", p.Path, "mode", p.Mode)
			}
		}
		// Warn if defaults were requested but none were applied (possible security regression)
		if len(rules) == defaultRulesStart {
			slog.Warn("airo-sandbox: defaults enabled but no system paths found, sandbox may be ineffective")
		}
	}

	// Apply user-specified paths (missing user paths likely indicate misconfiguration)
	for _, p := range cfg.Paths {
		if r, ok := pathToRule(p); ok {
			rules = append(rules, r)
		} else {
			slog.Warn("airo-sandbox: user-specified path does not exist, skipping",
				"path", p.Path, "mode", p.Mode)
		}
	}

	// TCP connect ports (one rule per port)
	for _, port := range cfg.ConnectTCP {
		rules = append(rules, landlock.ConnectTCP(port))
	}

	// TCP bind ports (one rule per port)
	for _, port := range cfg.BindTCP {
		rules = append(rules, landlock.BindTCP(port))
	}

	return rules
}

// execCommand replaces the current process with sh -c <command>.
func execCommand(cfg *SandboxConfig, env []string) error {
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
	// Intentional: airo-sandbox applies Landlock restrictions then exec's the child command.
	// The command comes from AIRO_SANDBOX_CONFIG set by dev-supervisor, not user input.
	return syscall.Exec(shPath, argv, env)
}

// Package validation provides security-focused input validation for API requests.
// It validates commands, paths, environment variables, and prevents execution
// of potentially dangerous operations.
package validation

import (
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

const (
	// MaxEnvVarValueSize is the maximum allowed size for environment variable values (32KB)
	MaxEnvVarValueSize = 32768
	// MaxCommandLength is the maximum allowed length for commands (8KB)
	MaxCommandLength = 8192
)

// forkBombPattern detects classic bash fork bomb patterns like :(){ :|:& };:
// Landlock cannot restrict process creation, so this must be caught at validation time.
var forkBombPattern = regexp.MustCompile(`:\(\)\s*\{.*\|.*&\s*\}\s*;?\s*:`)

// chownRecursiveRootPattern matches recursive chown to the root user (privilege
// escalation). Covers `-r`, `-R`, combined flags (`-Rv`), and `--recursive`.
// Requires a word boundary after "root" so `rootless:rootless` does not match.
// Applied after strings.ToLower, so -R is seen as -r.
var chownRecursiveRootPattern = regexp.MustCompile(`\bchown\s+(?:-[a-z]*r[a-z]*|--recursive)\s+root(?:[:\s/]|$)`)

// ValidateProcessStartRequest validates a process start request
func ValidateProcessStartRequest(req ProcessStartRequest) error {
	if strings.TrimSpace(req.Command) == "" {
		return errors.New("command cannot be empty")
	}

	if isForkBomb(req.Command) {
		return errors.New("potentially dangerous command pattern detected")
	}

	// Defense in depth: the Landlock sandbox is the primary line of defense, but it can be
	// disabled (DEV_SUPERVISOR_SANDBOX_ENABLED=false) and is unavailable on kernels < 6.12.
	// These pre-exec checks give actionable errors and a baseline floor when sandbox is off.
	if isDangerousCommand(req.Command) {
		return errors.New("potentially dangerous command detected")
	}

	// Validate working directory if provided
	if req.WorkingDir != "" && !isValidPath(req.WorkingDir) {
		return errors.New("invalid working directory path")
	}

	// Validate environment variables
	for key, value := range req.Env {
		if !IsValidEnvVarName(key) {
			return fmt.Errorf("invalid environment variable name: %s", key)
		}
		if len(value) > MaxEnvVarValueSize {
			return fmt.Errorf("environment variable %s value too large (max %d bytes)", key, MaxEnvVarValueSize)
		}
	}

	return nil
}

// ValidateCommandRequest validates a command execution request
func ValidateCommandRequest(req CommandRequest) error {
	if strings.TrimSpace(req.Command) == "" {
		return errors.New("command cannot be empty")
	}

	if isForkBomb(req.Command) {
		return errors.New("potentially dangerous command pattern detected")
	}

	// See note on ValidateProcessStartRequest — same defense-in-depth rationale.
	if isDangerousCommand(req.Command) {
		return errors.New("potentially dangerous command detected")
	}

	// Check timeout limits
	if req.Timeout < 0 {
		return errors.New("timeout cannot be negative")
	}
	if req.Timeout > 3600 { // 1 hour max
		return errors.New("timeout cannot exceed 3600 seconds")
	}

	// Validate working directory if provided.
	// Accepts both absolute and relative paths (callers may send relative paths
	// that resolve against the executor's default working directory).
	if req.WorkingDir != "" && !isValidWorkingDir(req.WorkingDir) {
		return errors.New("invalid working directory path")
	}

	return nil
}

// ValidateEnvironmentSetRequest validates an environment set request
func ValidateEnvironmentSetRequest(req EnvironmentSetRequest) error {
	if len(req.Variables) == 0 {
		return errors.New("no variables provided")
	}

	if len(req.Variables) > 1000 { // Reasonable limit
		return errors.New("too many environment variables (max: 1000)")
	}

	for key, value := range req.Variables {
		if !IsValidEnvVarName(key) {
			return fmt.Errorf("invalid environment variable name: %s", key)
		}
		if len(value) > MaxEnvVarValueSize {
			return fmt.Errorf("environment variable %s value too large (max %d bytes)", key, MaxEnvVarValueSize)
		}
		if isProtectedEnvVar(key) {
			return fmt.Errorf("cannot modify protected environment variable: %s", key)
		}
	}

	return nil
}

// isValidPath checks if a path looks valid for process start requests.
// Requires absolute paths.
func isValidPath(path string) bool {
	if path == "" {
		return false
	}

	// Must be absolute path
	if !strings.HasPrefix(path, "/") {
		return false
	}

	// Check for path traversal attempts
	if strings.Contains(path, "..") {
		return false
	}

	// Check for null bytes
	if strings.Contains(path, "\x00") {
		return false
	}

	return true
}

// isValidWorkingDir checks if a working directory is safe for command execution.
// Accepts both absolute and relative paths (relative paths resolve against the
// executor's default working directory). Only blocks traversal and null bytes.
func isValidWorkingDir(path string) bool {
	if path == "" {
		return false
	}

	if strings.Contains(path, "..") {
		return false
	}

	if strings.Contains(path, "\x00") {
		return false
	}

	return true
}

// isProtectedEnvVar checks if an environment variable is protected
func isProtectedEnvVar(name string) bool {
	protected := []string{
		"PATH",
		"HOME",
		"USER",
		"SHELL",
		"TERM",
		"PWD",
		"OLDPWD",
		"UID",
		"GID",
		"EUID",
		"EGID",
	}

	name = strings.ToUpper(name)
	return slices.Contains(protected, name)
}

// IsValidEnvVarName checks if the environment variable name is valid
func IsValidEnvVarName(name string) bool {
	if name == "" {
		return false
	}

	// First character must be letter or underscore
	first := name[0]
	if first < 'A' || (first > 'Z' && first < '_') || (first > '_' && first < 'a') || first > 'z' {
		return false
	}

	// Remaining characters can be letters, digits, or underscore
	for i := 1; i < len(name); i++ {
		char := name[i]
		if char < '0' || (char > '9' && char < 'A') || (char > 'Z' && char < '_') || (char > '_' && char < 'a') ||
			char > 'z' {
			return false
		}
	}

	return true
}

// ValidateFilePath validates that a file path is safe for filesystem operations.
// It rejects empty paths, null bytes, ".." traversal, and paths outside the
// specified base directory. The resolved path is returned for use by callers.
func ValidateFilePath(path string, baseDir string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", errors.New("path cannot be empty")
	}

	if strings.Contains(path, "\x00") {
		return "", errors.New("path contains null bytes")
	}

	// Check for ".." as a path component (not just substring, so "foo..txt" is allowed)
	if slices.Contains(strings.Split(path, "/"), "..") {
		return "", errors.New("path contains directory traversal")
	}

	// Resolve to absolute path within baseDir
	var resolved string
	if filepath.IsAbs(path) {
		resolved = filepath.Clean(path)
	} else {
		resolved = filepath.Clean(filepath.Join(baseDir, path))
	}

	// Ensure the resolved path is within baseDir
	baseDirClean := filepath.Clean(baseDir)
	if resolved != baseDirClean && !strings.HasPrefix(resolved, baseDirClean+"/") {
		return "", fmt.Errorf("path escapes base directory %s", baseDirClean)
	}

	// Resolve symlinks to prevent sandbox escapes (e.g., /app/link -> /etc).
	resolved, err := resolveSymlinksWithinBase(resolved, baseDirClean)
	if err != nil {
		return "", err
	}

	return resolved, nil
}

// resolveSymlinksWithinBase resolves symlinks and verifies the real path stays within baseDir.
// For non-existent paths (write targets), it walks up ancestors to find the deepest existing
// directory and resolves symlinks there - preventing escapes through symlinked intermediates
// even when descendants don't exist yet.
func resolveSymlinksWithinBase(resolved string, baseDirClean string) (string, error) {
	realBase := baseDirClean
	if rb, evalErr := filepath.EvalSymlinks(baseDirClean); evalErr == nil {
		realBase = rb
	}

	// Fast path: full path exists, resolve directly
	if realPath, evalErr := filepath.EvalSymlinks(resolved); evalErr == nil {
		if !isWithinDir(realPath, realBase) {
			return "", fmt.Errorf("path escapes base directory %s via symlink", baseDirClean)
		}
		return realPath, nil
	}

	if resolved == baseDirClean {
		return resolved, nil
	}

	// Path doesn't exist. Walk up ancestors until we find one that exists,
	// then resolve its symlinks. This catches cases like escape/newdir/file.txt
	// where "escape" is a symlink out of the sandbox and "newdir" doesn't exist.
	tail := filepath.Base(resolved)
	ancestor := filepath.Dir(resolved)
	for ancestor != baseDirClean && ancestor != "/" && ancestor != "." {
		if realAnc, evalErr := filepath.EvalSymlinks(ancestor); evalErr == nil {
			if !isWithinDir(realAnc, realBase) {
				return "", fmt.Errorf("path escapes base directory %s via symlink", baseDirClean)
			}
			return filepath.Join(realAnc, tail), nil
		}
		tail = filepath.Join(filepath.Base(ancestor), tail)
		ancestor = filepath.Dir(ancestor)
	}

	return resolved, nil
}

// isWithinDir checks if path is equal to or a child of dir.
func isWithinDir(path string, dir string) bool {
	return path == dir || strings.HasPrefix(path, dir+"/")
}

// isForkBomb detects fork bomb patterns that Landlock cannot prevent.
// Landlock restricts filesystem and network access but cannot limit process creation.
func isForkBomb(command string) bool {
	return forkBombPattern.MatchString(command)
}

// isDangerousCommand checks for substrings that destroy host state, escalate privilege,
// or fall outside the Landlock sandbox's coverage. Kept as pre-exec defense in depth
// so we fail fast with actionable errors when the sandbox is disabled (opt-out for
// diagnostics, or kernels without Landlock ABI v6).
func isDangerousCommand(command string) bool {
	command = strings.ToLower(strings.TrimSpace(command))

	if chownRecursiveRootPattern.MatchString(command) {
		return true
	}

	// All patterns must be lowercase since command is lowered above.
	dangerousPatterns := []string{
		"rm -rf /",
		"dd if=",
		"mkfs.",
		"fdisk",
		"init 0",
		"init 6",
		"kill -9 1",
		"killall -9",
		"chmod -r 777 /",
		"rm -rf --no-preserve-root",
	}

	for _, pattern := range dangerousPatterns {
		idx := strings.Index(command, pattern)
		if idx == -1 {
			continue
		}
		// Word-boundary check: if the pattern ends with a digit, ensure it's not
		// followed by another digit. Prevents "kill -9 1" from matching "kill -9 12345".
		endIdx := idx + len(pattern)
		lastChar := pattern[len(pattern)-1]
		if lastChar >= '0' && lastChar <= '9' && endIdx < len(command) &&
			command[endIdx] >= '0' && command[endIdx] <= '9' {
			continue
		}
		return true
	}

	return false
}

// SanitizeCommand performs basic command sanitization
func SanitizeCommand(command string) string {
	// Remove null bytes
	command = strings.ReplaceAll(command, "\x00", "")

	// Limit length
	if len(command) > MaxCommandLength {
		command = command[:MaxCommandLength]
	}

	return strings.TrimSpace(command)
}

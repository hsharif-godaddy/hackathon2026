// Package validation provides security-focused input validation for API requests.
// It validates commands, paths, environment variables, and prevents execution
// of potentially dangerous operations.
package validation

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

const (
	// MaxEnvVarValueSize is the maximum allowed size for environment variable values (32KB)
	MaxEnvVarValueSize = 32768
	// MaxCommandLength is the maximum allowed length for commands (8KB)
	MaxCommandLength = 8192
)

// ValidateProcessStartRequest validates a process start request
func ValidateProcessStartRequest(req ProcessStartRequest) error {
	if strings.TrimSpace(req.Command) == "" {
		return errors.New("command cannot be empty")
	}

	// Check for potentially dangerous commands
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

	// Check for potentially dangerous commands
	if isDangerousCommand(req.Command) {
		return errors.New("potentially dangerous command detected")
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

// isDangerousCommand checks if a command might be dangerous to execute
func isDangerousCommand(command string) bool {
	command = strings.ToLower(strings.TrimSpace(command))

	// List of potentially dangerous command patterns.
	// All patterns must be lowercase since the command is lowered above.
	dangerousPatterns := []string{
		"rm -rf /",
		"dd if=",
		"mkfs.",
		"fdisk",
		"init 0",
		"init 6",
		"kill -9 1",
		"killall -9",
		":(){ :|:& };:", // Fork bomb
		"chmod -r 777 /",
		"chown -r",
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

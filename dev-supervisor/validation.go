package main

import (
	"fmt"
	"strings"
)

const (
	// MaxEnvVarValueSize is the maximum allowed size for environment variable values (32KB)
	MaxEnvVarValueSize = 32768
	// MaxCommandLength is the maximum allowed length for commands (8KB)
	MaxCommandLength = 8192
)

// validateProcessStartRequest validates a process start request
func validateProcessStartRequest(req ProcessStartRequest) error {
	if strings.TrimSpace(req.Command) == "" {
		return fmt.Errorf("command cannot be empty")
	}

	// Check for potentially dangerous commands
	if isDangerousCommand(req.Command) {
		return fmt.Errorf("potentially dangerous command detected")
	}

	// Validate working directory if provided
	if req.WorkingDir != "" && !isValidPath(req.WorkingDir) {
		return fmt.Errorf("invalid working directory path")
	}

	// Validate environment variables
	for key, value := range req.Env {
		if !isValidEnvVarName(key) {
			return fmt.Errorf("invalid environment variable name: %s", key)
		}
		if len(value) > MaxEnvVarValueSize {
			return fmt.Errorf("environment variable %s value too large (max %d bytes)", key, MaxEnvVarValueSize)
		}
	}

	return nil
}

// validateCommandRequest validates a command execution request
func validateCommandRequest(req CommandRequest) error {
	if strings.TrimSpace(req.Command) == "" {
		return fmt.Errorf("command cannot be empty")
	}

	// Check timeout limits
	if req.Timeout < 0 {
		return fmt.Errorf("timeout cannot be negative")
	}
	if req.Timeout > 3600 { // 1 hour max
		return fmt.Errorf("timeout cannot exceed 3600 seconds")
	}

	// Validate working directory if provided
	if req.WorkingDir != "" && !isValidPath(req.WorkingDir) {
		return fmt.Errorf("invalid working directory path")
	}

	// Check for potentially dangerous commands
	if isDangerousCommand(req.Command) {
		return fmt.Errorf("potentially dangerous command detected")
	}

	return nil
}

// validateEnvironmentSetRequest validates an environment set request
func validateEnvironmentSetRequest(req EnvironmentSetRequest) error {
	if len(req.Variables) == 0 {
		return fmt.Errorf("no variables provided")
	}

	if len(req.Variables) > 1000 { // Reasonable limit
		return fmt.Errorf("too many environment variables (max: 1000)")
	}

	for key, value := range req.Variables {
		if !isValidEnvVarName(key) {
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

	// List of potentially dangerous command patterns
	dangerousPatterns := []string{
		"rm -rf /",
		"dd if=",
		"mkfs.",
		"fdisk",
		"format",
		"shutdown",
		"reboot",
		"halt",
		"poweroff",
		"init 0",
		"init 6",
		"kill -9 1",
		"killall -9",
		":(){ :|:& };:", // Fork bomb
		"chmod -R 777 /",
		"chown -R",
		"rm -rf --no-preserve-root",
	}

	for _, pattern := range dangerousPatterns {
		if strings.Contains(command, pattern) {
			return true
		}
	}

	return false
}

// isValidPath checks if a path looks valid (basic validation)
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
	for _, p := range protected {
		if name == p {
			return true
		}
	}

	return false
}

// sanitizeCommand performs basic command sanitization
func sanitizeCommand(command string) string {
	// Remove null bytes
	command = strings.ReplaceAll(command, "\x00", "")

	// Limit length
	if len(command) > MaxCommandLength {
		command = command[:MaxCommandLength]
	}

	return strings.TrimSpace(command)
}

package main

import (
	"os"
	"testing"
)

func TestGetSocketPath(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		envValue string
		expected string
	}{
		{
			name:     "default path when env not set",
			envValue: "",
			expected: "/tmp/dev-supervisor.sock",
		},
		{
			name:     "custom path from environment",
			envValue: "/custom/path/supervisor.sock",
			expected: "/custom/path/supervisor.sock",
		},
		{
			name:     "relative path from environment",
			envValue: "./supervisor.sock",
			expected: "./supervisor.sock",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Save original value
			originalValue := os.Getenv("DEV_SUPERVISOR_SOCKET_PATH")
			defer func() {
				if originalValue == "" {
					os.Unsetenv("DEV_SUPERVISOR_SOCKET_PATH")
				} else {
					os.Setenv("DEV_SUPERVISOR_SOCKET_PATH", originalValue)
				}
			}()

			// Set test value
			if tt.envValue == "" {
				os.Unsetenv("DEV_SUPERVISOR_SOCKET_PATH")
			} else {
				os.Setenv("DEV_SUPERVISOR_SOCKET_PATH", tt.envValue)
			}

			// Test function
			result := getSocketPath()
			if result != tt.expected {
				t.Errorf("getSocketPath() = %s, expected %s", result, tt.expected)
			}
		})
	}
}

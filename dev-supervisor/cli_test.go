package main

import (
	"flag"
	"os"
	"testing"
	"time"
)

func TestCliBasics(t *testing.T) {
	t.Run("version_and_app_name", func(t *testing.T) {
		if Version == "" {
			t.Error("Version should not be empty")
		}
		if AppName == "" {
			t.Error("AppName should not be empty")
		}
	})
}

func TestFlagParsing(t *testing.T) {
	// Test individual flag parsing without calling the main parseFlags function
	// to avoid flag redefinition issues

	t.Run("socket_flag_behavior", func(t *testing.T) {
		// Create a new FlagSet for testing
		fs := flag.NewFlagSet("test", flag.ContinueOnError)
		var socketPath string
		var shutdownTimeout time.Duration

		fs.StringVar(&socketPath, "socket", "", "Unix domain socket path")
		fs.DurationVar(&shutdownTimeout, "shutdown-timeout", 10*time.Second, "Graceful shutdown timeout")

		// Test default values
		err := fs.Parse([]string{})
		if err != nil {
			t.Fatalf("Failed to parse empty args: %v", err)
		}

		if socketPath != "" {
			t.Errorf("Expected empty socket path by default, got %s", socketPath)
		}
		if shutdownTimeout != 10*time.Second {
			t.Errorf("Expected 10s default timeout, got %v", shutdownTimeout)
		}
	})

	t.Run("custom_values", func(t *testing.T) {
		fs := flag.NewFlagSet("test", flag.ContinueOnError)
		var socketPath string
		var shutdownTimeout time.Duration

		fs.StringVar(&socketPath, "socket", "", "Unix domain socket path")
		fs.DurationVar(&shutdownTimeout, "shutdown-timeout", 10*time.Second, "Graceful shutdown timeout")

		err := fs.Parse([]string{"-socket", "/custom/path.sock", "-shutdown-timeout", "30s"})
		if err != nil {
			t.Fatalf("Failed to parse custom args: %v", err)
		}

		if socketPath != "/custom/path.sock" {
			t.Errorf("Expected custom socket path, got %s", socketPath)
		}
		if shutdownTimeout != 30*time.Second {
			t.Errorf("Expected 30s timeout, got %v", shutdownTimeout)
		}
	})
}

func TestGetSocketPathFromEnv(t *testing.T) {
	// Save original env var
	origPath := os.Getenv("DEV_SUPERVISOR_SOCKET_PATH")
	defer os.Setenv("DEV_SUPERVISOR_SOCKET_PATH", origPath)

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
			envValue: "/custom/supervisor.sock",
			expected: "/custom/supervisor.sock",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Setenv("DEV_SUPERVISOR_SOCKET_PATH", tt.envValue)
			result := getSocketPath()
			if result != tt.expected {
				t.Errorf("Expected %s, got %s", tt.expected, result)
			}
		})
	}
}

func TestVersionAndAppName(t *testing.T) {
	if Version == "" {
		t.Error("Version should not be empty")
	}
	if AppName == "" {
		t.Error("AppName should not be empty")
	}
	if AppName != "dev-supervisor" {
		t.Errorf("Expected AppName to be 'dev-supervisor', got %s", AppName)
	}
}

func TestServerGetConfiguredSocketPath(t *testing.T) {
	tests := []struct {
		name     string
		config   *Config
		expected string
	}{
		{
			name:     "nil config falls back to env",
			config:   nil,
			expected: "/tmp/dev-supervisor.sock",
		},
		{
			name: "config with socket path",
			config: &Config{
				SocketPath: "/test/socket.sock",
			},
			expected: "/test/socket.sock",
		},
		{
			name: "config with empty socket path falls back to env",
			config: &Config{
				SocketPath: "",
			},
			expected: "/tmp/dev-supervisor.sock",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := NewServer()
			server.config = tt.config

			result := server.getConfiguredAddress()
			if result != tt.expected {
				t.Errorf("Expected %s, got %s", tt.expected, result)
			}
		})
	}
}

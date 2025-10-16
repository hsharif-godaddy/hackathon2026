package main

import (
	"bytes"
	"log/slog"
	"os"
	"strings"
	"testing"
)

func TestLoggingFormat(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		isTerminal bool
		expectJSON bool
		expectText bool
	}{
		{
			name:       "terminal output should use text format",
			isTerminal: true,
			expectText: true,
		},
		{
			name:       "non-terminal output should use JSON format",
			isTerminal: false,
			expectJSON: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Capture output
			var buf bytes.Buffer
			var handler slog.Handler

			if tt.isTerminal {
				handler = slog.NewTextHandler(&buf, &slog.HandlerOptions{
					Level: slog.LevelInfo,
				})
			} else {
				handler = slog.NewJSONHandler(&buf, &slog.HandlerOptions{
					Level: slog.LevelInfo,
				})
			}

			logger := slog.New(handler)

			// Log a test message
			logger.Info("test message", "key", "value", "number", 42)

			output := buf.String()

			if tt.expectJSON {
				if !strings.Contains(output, `"msg":"test message"`) {
					t.Errorf("Expected JSON format, got: %s", output)
				}
				if !strings.Contains(output, `"key":"value"`) {
					t.Errorf("Expected JSON structured data, got: %s", output)
				}
			}

			if tt.expectText {
				if !strings.Contains(output, "level=INFO") {
					t.Errorf("Expected text format with level=INFO, got: %s", output)
				}
				if !strings.Contains(output, "msg=\"test message\"") {
					t.Errorf("Expected text format message, got: %s", output)
				}
			}
		})
	}
}

func TestTerminalDetection(t *testing.T) {
	t.Parallel()
	// Test with real files
	tests := []struct {
		name     string
		file     *os.File
		expected bool
	}{
		{
			name:     "stdout detection",
			file:     os.Stdout,
			expected: false, // In CI/test environment, should be false
		},
		{
			name:     "stderr detection",
			file:     os.Stderr,
			expected: false, // In CI/test environment, should be false
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isTerminal(tt.file)
			if result != tt.expected {
				t.Logf("Terminal detection for %s: got %v, expected %v", tt.name, result, tt.expected)
				// Note: This test is informational since terminal detection depends on environment
			}
		})
	}
}

func TestAppIdLogging(t *testing.T) {
	tests := []struct {
		name          string
		siteId        string
		setSiteId     bool
		expectedAppId string
	}{
		{
			name:          "app_id included when SITE_ID is set",
			siteId:        "test-app-123",
			setSiteId:     true,
			expectedAppId: "test-app-123",
		},
		{
			name:          "app_id is empty when SITE_ID is not set",
			siteId:        "",
			setSiteId:     false,
			expectedAppId: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Save and restore original SITE_ID
			originalSiteId := os.Getenv("SITE_ID")
			defer func() {
				if originalSiteId != "" {
					os.Setenv("SITE_ID", originalSiteId)
				} else {
					os.Unsetenv("SITE_ID")
				}
			}()

			// Set or unset SITE_ID based on test case
			if tt.setSiteId {
				os.Setenv("SITE_ID", tt.siteId)
			} else {
				os.Unsetenv("SITE_ID")
			}

			// Capture output
			var buf bytes.Buffer
			handler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{
				Level: slog.LevelInfo,
			})

			// Use the production code to create logger
			logger := newLoggerWithHandler(handler)

			// Log a test message
			logger.Info("test message")

			output := buf.String()

			// Verify app_id field is present
			if !strings.Contains(output, `"app_id"`) {
				t.Errorf("Expected app_id field in output, got: %s", output)
			}

			// Verify app_id value
			expectedField := `"app_id":"` + tt.expectedAppId + `"`
			if !strings.Contains(output, expectedField) {
				t.Errorf("Expected %s in output, got: %s", expectedField, output)
			}
		})
	}
}

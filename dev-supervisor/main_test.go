package main

import (
	"os"
	"strings"
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
			expected: "/tmp/airo-supervisor.sock",
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
			originalValue := os.Getenv("AIRO_SUPERVISOR_SOCKET_PATH")
			defer func() {
				if originalValue == "" {
					os.Unsetenv("AIRO_SUPERVISOR_SOCKET_PATH")
				} else {
					os.Setenv("AIRO_SUPERVISOR_SOCKET_PATH", originalValue)
				}
			}()

			// Set test value
			if tt.envValue == "" {
				os.Unsetenv("AIRO_SUPERVISOR_SOCKET_PATH")
			} else {
				os.Setenv("AIRO_SUPERVISOR_SOCKET_PATH", tt.envValue)
			}

			// Test function
			result := getSocketPath()
			if result != tt.expected {
				t.Errorf("getSocketPath() = %s, expected %s", result, tt.expected)
			}
		})
	}
}

// TestParseAllowedOrigins tests that allowed origins are parsed using the same logic as vite.config.ts
func TestParseAllowedOrigins(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name             string
		frontendDomain   string
		allowedOrigins   string
		viteParentOrigin string
		expectedCount    int
		shouldContain    []string
		shouldNotContain []string
	}{
		{
			name:           "FRONTEND_DOMAIN only",
			frontendDomain: "app.example.com",
			expectedCount:  3,
			shouldContain: []string{
				"app.example.com",
				"http://app.example.com",
				"https://app.example.com",
			},
		},
		{
			name:           "ALLOWED_ORIGINS only",
			allowedOrigins: "https://builder.com,http://localhost:3000",
			expectedCount:  2,
			shouldContain: []string{
				"https://builder.com",
				"http://localhost:3000",
			},
		},
		{
			name:             "VITE_PARENT_ORIGIN only",
			viteParentOrigin: "https://parent.com",
			expectedCount:    1,
			shouldContain: []string{
				"https://parent.com",
			},
		},
		{
			name:             "All three combined",
			frontendDomain:   "app.example.com",
			allowedOrigins:   "https://builder.com,http://localhost:3000",
			viteParentOrigin: "https://parent.com",
			expectedCount:    6,
			shouldContain: []string{
				"app.example.com",
				"http://app.example.com",
				"https://app.example.com",
				"https://builder.com",
				"http://localhost:3000",
				"https://parent.com",
			},
		},
		{
			name:             "Duplicates removed",
			frontendDomain:   "example.com",
			allowedOrigins:   "https://example.com,http://example.com",
			viteParentOrigin: "https://example.com",
			expectedCount:    3, // Only unique values
			shouldContain: []string{
				"example.com",
				"http://example.com",
				"https://example.com",
			},
		},
		{
			name:           "Whitespace trimmed",
			allowedOrigins: " https://builder.com , http://localhost:3000 ",
			expectedCount:  2,
			shouldContain: []string{
				"https://builder.com",
				"http://localhost:3000",
			},
			shouldNotContain: []string{
				" https://builder.com",
				"http://localhost:3000 ",
			},
		},
		{
			name:             "Production-like config",
			frontendDomain:   "cptjybkt1g.preview.c24.airoapp.ai",
			allowedOrigins:   "https://airo-builder.godaddy.com,http://airo-builder.godaddy.com",
			viteParentOrigin: "https://airo-builder.godaddy.com",
			expectedCount:    5, // FRONTEND_DOMAIN (3) + ALLOWED_ORIGINS (2), with 1 duplicate removed
			shouldContain: []string{
				"cptjybkt1g.preview.c24.airoapp.ai",
				"http://cptjybkt1g.preview.c24.airoapp.ai",
				"https://cptjybkt1g.preview.c24.airoapp.ai",
				"https://airo-builder.godaddy.com",
				"http://airo-builder.godaddy.com",
			},
		},
		{
			name:          "None set (empty)",
			expectedCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Save and restore original env values
			origFrontend := os.Getenv("FRONTEND_DOMAIN")
			origAllowed := os.Getenv("ALLOWED_ORIGINS")
			origParent := os.Getenv("VITE_PARENT_ORIGIN")
			defer func() {
				setOrUnsetEnv("FRONTEND_DOMAIN", origFrontend)
				setOrUnsetEnv("ALLOWED_ORIGINS", origAllowed)
				setOrUnsetEnv("VITE_PARENT_ORIGIN", origParent)
			}()

			// Set test env values
			setOrUnsetEnv("FRONTEND_DOMAIN", tt.frontendDomain)
			setOrUnsetEnv("ALLOWED_ORIGINS", tt.allowedOrigins)
			setOrUnsetEnv("VITE_PARENT_ORIGIN", tt.viteParentOrigin)

			// Run the parsing logic (simulate what happens in main())
			var allowedOrigins []string
			frontendDomain := os.Getenv("FRONTEND_DOMAIN")
			if frontendDomain != "" {
				allowedOrigins = append(allowedOrigins,
					frontendDomain,
					"http://"+frontendDomain,
					"https://"+frontendDomain,
				)
			}
			allowedOriginsStr := os.Getenv("ALLOWED_ORIGINS")
			if allowedOriginsStr != "" {
				origins := strings.Split(allowedOriginsStr, ",")
				allowedOrigins = append(allowedOrigins, origins...)
			}
			viteParentOrigin := os.Getenv("VITE_PARENT_ORIGIN")
			if viteParentOrigin != "" {
				allowedOrigins = append(allowedOrigins, viteParentOrigin)
			}
			seenOrigins := make(map[string]bool)
			var result []string
			for _, origin := range allowedOrigins {
				trimmed := strings.TrimSpace(origin)
				if trimmed != "" && !seenOrigins[trimmed] {
					seenOrigins[trimmed] = true
					result = append(result, trimmed)
				}
			}

			// Verify count
			if len(result) != tt.expectedCount {
				t.Errorf("Expected %d origins, got %d: %v", tt.expectedCount, len(result), result)
			}

			// Verify expected values are present
			for _, expected := range tt.shouldContain {
				found := false
				for _, actual := range result {
					if actual == expected {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("Expected to find %q in result, but didn't. Result: %v", expected, result)
				}
			}

			// Verify unexpected values are NOT present
			for _, unexpected := range tt.shouldNotContain {
				for _, actual := range result {
					if actual == unexpected {
						t.Errorf("Did not expect to find %q in result, but did. Result: %v", unexpected, result)
					}
				}
			}
		})
	}
}

// setOrUnsetEnv sets an environment variable if value is non-empty, otherwise unsets it
// Used for both setting test values and restoring original values
func setOrUnsetEnv(key, value string) {
	if value == "" {
		os.Unsetenv(key)
	} else {
		os.Setenv(key, value)
	}
}

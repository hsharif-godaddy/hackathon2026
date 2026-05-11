package checks

import (
	"context"
	"os"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestSandboxCheck(t *testing.T) {
	const envVar = "DEV_SUPERVISOR_SANDBOX_ENABLED"

	tests := []struct {
		name     string
		setValue *string // nil means unset
		wantMsg  string
	}{
		{"unset reports default", nil, envVar + "=unset (default)"},
		{"set to true", ptr("true"), envVar + "=true"},
		{"set to false", ptr("false"), envVar + "=false"},
		{"set to empty string", ptr(""), envVar + "="},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withEnv(t, envVar, tt.setValue)

			result := (&SandboxCheck{}).Run(context.Background(), "")
			if result.Status != preflight.StatusPass {
				t.Errorf("Status = %v, want Pass", result.Status)
			}
			if result.Message != tt.wantMsg {
				t.Errorf("Message = %q, want %q", result.Message, tt.wantMsg)
			}
			if result.Name != "Sandbox" {
				t.Errorf("Name = %q, want Sandbox", result.Name)
			}
			if result.Category != preflight.CategoryTools {
				t.Errorf("Category = %q, want %q", result.Category, preflight.CategoryTools)
			}
		})
	}
}

func ptr(s string) *string { return &s }

// withEnv sets or unsets envVar for the test's duration and restores the
// original value on cleanup. t.Setenv only supports setting, not unsetting.
func withEnv(t *testing.T, key string, value *string) {
	t.Helper()
	prev, hadPrev := os.LookupEnv(key)
	t.Cleanup(func() {
		if hadPrev {
			_ = os.Setenv(key, prev)
		} else {
			_ = os.Unsetenv(key)
		}
	})
	if value == nil {
		if err := os.Unsetenv(key); err != nil {
			t.Fatalf("unsetenv: %v", err)
		}
		return
	}
	if err := os.Setenv(key, *value); err != nil {
		t.Fatalf("setenv: %v", err)
	}
}

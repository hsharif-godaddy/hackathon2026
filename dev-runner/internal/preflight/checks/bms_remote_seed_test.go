package checks

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestBMSRemoteSeedCheck_NoFile(t *testing.T) {
	dir := t.TempDir()
	check := &BMSRemoteSeedCheck{}
	result := check.Run(context.Background(), dir)

	if result.Status != preflight.StatusFail {
		t.Errorf("expected StatusFail, got %v", result.Status)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true")
	}
}

func TestBMSRemoteSeedCheck_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	idPath := filepath.Join(dir, preflight.BMSDevBudgetIDFile)
	os.MkdirAll(filepath.Dir(idPath), 0755)
	os.WriteFile(idPath, []byte(""), 0644)

	check := &BMSRemoteSeedCheck{}
	result := check.Run(context.Background(), dir)

	if result.Status != preflight.StatusFail {
		t.Errorf("expected StatusFail, got %v", result.Status)
	}
}

func TestBMSRemoteSeedCheck_TokenError(t *testing.T) {
	dir := t.TempDir()
	idPath := filepath.Join(dir, preflight.BMSDevBudgetIDFile)
	os.MkdirAll(filepath.Dir(idPath), 0755)
	os.WriteFile(idPath, []byte("some-budget-id\n"), 0644)

	origFunc := getBMSTokenFunc
	getBMSTokenFunc = func(_ context.Context, _ string) (string, error) {
		return "", fmt.Errorf("AWS SSO expired")
	}
	defer func() { getBMSTokenFunc = origFunc }()

	check := &BMSRemoteSeedCheck{}
	result := check.Run(context.Background(), dir)

	if result.Status != preflight.StatusFail {
		t.Errorf("expected StatusFail, got %v", result.Status)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true")
	}
	if !strings.Contains(result.Message, "cannot verify budget") {
		t.Errorf("expected token error message, got: %s", result.Message)
	}
}

func TestBMSRemoteSeedCheck_EmptyToken(t *testing.T) {
	dir := t.TempDir()
	idPath := filepath.Join(dir, preflight.BMSDevBudgetIDFile)
	os.MkdirAll(filepath.Dir(idPath), 0755)
	os.WriteFile(idPath, []byte("some-budget-id\n"), 0644)

	origFunc := getBMSTokenFunc
	getBMSTokenFunc = func(_ context.Context, _ string) (string, error) {
		return "", fmt.Errorf("empty token returned")
	}
	defer func() { getBMSTokenFunc = origFunc }()

	check := &BMSRemoteSeedCheck{}
	result := check.Run(context.Background(), dir)

	if result.Status != preflight.StatusFail {
		t.Errorf("expected StatusFail, got %v", result.Status)
	}
}

func TestBudgetCreditsExhausted(t *testing.T) {
	tests := []struct {
		name      string
		total     string
		used      string
		expected  bool
		expectErr bool
	}{
		{"not exhausted", "1000000.000000", "500.000000", false, false},
		{"exhausted", "1000.000000", "1000.000000", true, false},
		{"over budget", "1000.000000", "1500.000000", true, false},
		{"zero total (soft-deleted)", "0.000000", "0.000000", true, false},
		{"unparseable total", "abc", "0.000000", false, true},
		{"unparseable used", "1000.000000", "xyz", false, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := &bmsBudgetResponse{CreditsTotal: tt.total, CreditsUsed: tt.used}
			got, err := budgetCreditsExhausted(b)
			if tt.expectErr && err == nil {
				t.Fatal("expected error, got nil")
			}
			if !tt.expectErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.expected {
				t.Errorf("budgetCreditsExhausted() = %v, want %v", got, tt.expected)
			}
		})
	}
}

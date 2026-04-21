package checks

import (
	"context"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestAWSProfileCheck_NotSet(t *testing.T) {
	t.Setenv("AWS_PROFILE", "")
	result := (&AWSProfileCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestAWSProfileCheck_Set(t *testing.T) {
	t.Setenv("AWS_PROFILE", "my-profile")
	result := (&AWSProfileCheck{}).Run(context.Background(), "")
	if result.Status != preflight.StatusFail {
		t.Errorf("expected Fail, got %v: %s", result.Status, result.Message)
	}
	if !strings.Contains(result.Message, "my-profile") {
		t.Errorf("expected message to contain profile name, got: %s", result.Message)
	}
	if result.InstallHint == "" {
		t.Error("expected InstallHint")
	}
}

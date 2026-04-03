package gh

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestDryRunnerTrigger(t *testing.T) {
	dry := &DryRunner{Real: &mockRunner{}}

	result, err := dry.Trigger(context.Background(), "org/repo", "deploy.yml", "main", map[string]string{"env": "test"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.HasPrefix(result, "[DRY RUN]") {
		t.Errorf("expected DRY RUN prefix, got %q", result)
	}
	if !strings.Contains(result, "deploy.yml") {
		t.Errorf("expected workflow name in output, got %q", result)
	}
	if !strings.Contains(result, "org/repo") {
		t.Errorf("expected repo in output, got %q", result)
	}
}

func TestDryRunnerTriggerNeverCallsReal(t *testing.T) {
	realCalled := false
	real := &mockRunner{
		triggerFn: func(_ context.Context, _, _, _ string, _ map[string]string) (string, error) {
			realCalled = true
			return "", nil
		},
	}

	dry := &DryRunner{Real: real}
	_, _ = dry.Trigger(context.Background(), "org/repo", "deploy.yml", "", nil)

	if realCalled {
		t.Error("DryRunner.Trigger should not call Real.Trigger")
	}
}

func TestDryRunnerDelegatesReadOps(t *testing.T) {
	versionCalled := false
	authCalled := false
	repoCalled := false
	statusCalled := false
	logsCalled := false
	listCalled := false

	real := &mockRunner{
		versionFn: func(_ context.Context) (string, error) {
			versionCalled = true
			return "2.87.0", nil
		},
		authStatusFn: func(_ context.Context) error {
			authCalled = true
			return nil
		},
		checkRepoFn: func(_ context.Context, _ string) error {
			repoCalled = true
			return nil
		},
		statusFn: func(_ context.Context, _ string, _ int64) (*RunStatus, error) {
			statusCalled = true
			return &RunStatus{Status: "completed"}, nil
		},
		logsFn: func(_ context.Context, _ string, _ int64) (string, error) {
			logsCalled = true
			return "log content", nil
		},
		listRunsFn: func(_ context.Context, _, _, _ string, _ int) ([]RunListEntry, error) {
			listCalled = true
			return nil, nil
		},
	}

	dry := &DryRunner{Real: real}
	ctx := context.Background()

	compareCalled := false
	real.compareFn = func(_ context.Context, _, _, _ string) (*CompareResult, error) {
		compareCalled = true
		return &CompareResult{}, nil
	}

	dry.Version(ctx)
	dry.AuthStatus(ctx)
	dry.CheckRepoAccess(ctx, "org/repo")
	dry.Status(ctx, "org/repo", 123)
	dry.Logs(ctx, "org/repo", 123)
	dry.ListRuns(ctx, "org/repo", "w.yml", "success", 5)
	dry.Compare(ctx, "org/repo", "abc123", "main")

	if !versionCalled {
		t.Error("Version not delegated")
	}
	if !authCalled {
		t.Error("AuthStatus not delegated")
	}
	if !repoCalled {
		t.Error("CheckRepoAccess not delegated")
	}
	if !statusCalled {
		t.Error("Status not delegated")
	}
	if !logsCalled {
		t.Error("Logs not delegated")
	}
	if !listCalled {
		t.Error("ListRuns not delegated")
	}
	if !compareCalled {
		t.Error("Compare not delegated")
	}
}

func TestDryRunnerPropagatesErrors(t *testing.T) {
	real := &mockRunner{
		versionFn: func(_ context.Context) (string, error) {
			return "", fmt.Errorf("version error")
		},
	}

	dry := &DryRunner{Real: real}
	_, err := dry.Version(context.Background())
	if err == nil {
		t.Error("expected error from delegated Version call")
	}
}

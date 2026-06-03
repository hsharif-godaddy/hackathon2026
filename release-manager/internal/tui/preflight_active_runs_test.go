package tui

import (
	"context"
	"strings"
	"testing"

	"github.com/airo-ai-builder/release-manager/internal/config"
	"github.com/airo-ai-builder/release-manager/internal/gh"
)

// A GHA release paused at the approve-prod environment gate reports run status
// "waiting" — the manual TUI must still detect it and refuse to start.
func TestCheckActiveRunsDetectsWaitingRelease(t *testing.T) {
	runner := &capturingRunner{
		listRunsFn: func(_ context.Context, _, workflow, _ string, _ int) ([]gh.RunListEntry, error) {
			if workflow == "release.yml" {
				return []gh.RunListEntry{{Status: "waiting", Name: "Release Pipeline", URL: "https://x/runs/1"}}, nil
			}
			return nil, nil
		},
	}
	wfs := []config.DeployWorkflow{{Repo: "gdcorp-partners/airo-app-builder", Workflow: "release.yml"}}

	msg := checkActiveRuns(runner, context.Background(), wfs, 0, false)().(preflightResultMsg)
	if msg.passed {
		t.Fatal("expected preflight to FAIL when a release.yml run is waiting at approval")
	}
	if !strings.Contains(msg.err, "release.yml") || !strings.Contains(msg.err, "waiting") {
		t.Errorf("err should name the waiting release run, got: %q", msg.err)
	}

	// --force-lock downgrades it to a warning (passed, but message retained).
	forced := checkActiveRuns(runner, context.Background(), wfs, 0, true)().(preflightResultMsg)
	if !forced.passed {
		t.Error("--force-lock should downgrade an active run to a warning (passed=true)")
	}
	if forced.err == "" {
		t.Error("forced pass should still carry the warning message")
	}
}

// Completed (and other terminal) runs must not block a release.
func TestCheckActiveRunsIgnoresCompleted(t *testing.T) {
	runner := &capturingRunner{
		listRunsFn: func(_ context.Context, _, _, _ string, _ int) ([]gh.RunListEntry, error) {
			return []gh.RunListEntry{{Status: "completed", Name: "Release Pipeline", URL: "u"}}, nil
		},
	}
	wfs := []config.DeployWorkflow{{Repo: "gdcorp-partners/airo-app-builder", Workflow: "release.yml"}}

	msg := checkActiveRuns(runner, context.Background(), wfs, 0, false)().(preflightResultMsg)
	if !msg.passed {
		t.Errorf("completed runs must not block; got fail: %q", msg.err)
	}
}

// The ActiveRunFilter still applies: a same-workflow run whose title doesn't
// match the filter is ignored.
func TestCheckActiveRunsRespectsFilter(t *testing.T) {
	runner := &capturingRunner{
		listRunsFn: func(_ context.Context, _, _, _ string, _ int) ([]gh.RunListEntry, error) {
			return []gh.RunListEntry{{Status: "in_progress", Name: "unrelated job", URL: "u"}}, nil
		},
	}
	wfs := []config.DeployWorkflow{{Repo: "org/x", Workflow: "shared.yml", ActiveRunFilter: "airo-builder"}}

	msg := checkActiveRuns(runner, context.Background(), wfs, 0, false)().(preflightResultMsg)
	if !msg.passed {
		t.Errorf("run not matching ActiveRunFilter should be ignored; got fail: %q", msg.err)
	}
}

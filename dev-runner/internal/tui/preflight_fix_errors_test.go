package tui

import (
	"errors"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/e2e"
	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/probe"
	"github.com/airo-ai-builder/dev-runner/internal/process"
)

// preflightFixErrorsModel returns a Model with just enough state for the
// preflightFixDoneMsg / preflightVerifyDoneMsg branches of Update to run
// without panicking. The returned tea.Cmds are discarded; we assert against
// model state directly.
func preflightFixErrorsModel() Model {
	return Model{
		preflightFixErrors: make(map[string]error),
		preflightFixQueue:  nil,
		preflightFixIndex:  0,
		preflightRunner:    &preflight.Runner{},
		manager:            &process.Manager{},
		probeRunner:        &probe.Runner{},
		e2eRunner:          &e2e.Runner{},
		discoveryCache:     &probe.DiscoveryCache{},
	}
}

func TestPreflightFixDoneMsg_StashesErrorByCheckName(t *testing.T) {
	m := preflightFixErrorsModel()
	fixErr := errors.New("kaboom")

	result, _ := m.Update(preflightFixDoneMsg{Err: fixErr, FixerName: "BMS Remote Budget"})
	updated := result.(Model)

	got, ok := updated.preflightFixErrors["BMS Remote Budget"]
	if !ok {
		t.Fatalf("preflightFixErrors[\"BMS Remote Budget\"] missing, want %q", fixErr)
	}
	if got.Error() != fixErr.Error() {
		t.Errorf("preflightFixErrors[\"BMS Remote Budget\"] = %q, want %q", got, fixErr)
	}
}

func TestPreflightFixDoneMsg_ClearsErrorOnSuccess(t *testing.T) {
	m := preflightFixErrorsModel()
	m.preflightFixErrors["BMS Remote Budget"] = errors.New("stale failure")

	result, _ := m.Update(preflightFixDoneMsg{Err: nil, FixerName: "BMS Remote Budget"})
	updated := result.(Model)

	if _, ok := updated.preflightFixErrors["BMS Remote Budget"]; ok {
		t.Errorf("expected stale error to be cleared after successful fix; got %v",
			updated.preflightFixErrors["BMS Remote Budget"])
	}
}

func TestPreflightVerifyDoneMsg_PrunesNonFailingChecks(t *testing.T) {
	m := preflightFixErrorsModel()
	m.preflightFixErrors["Pass Check"] = errors.New("transient that resolved")
	m.preflightFixErrors["Warn Check"] = errors.New("partially resolved")
	m.preflightFixErrors["Skip Check"] = errors.New("no longer relevant")
	m.preflightFixErrors["Fail Check"] = errors.New("real underlying failure")

	msg := preflightVerifyDoneMsg{Results: []preflight.CheckResult{
		{Name: "Pass Check", Status: preflight.StatusPass},
		{Name: "Warn Check", Status: preflight.StatusWarn},
		{Name: "Skip Check", Status: preflight.StatusSkip},
		{Name: "Fail Check", Status: preflight.StatusFail},
	}}
	result, _ := m.Update(msg)
	updated := result.(Model)

	for _, name := range []string{"Pass Check", "Warn Check", "Skip Check"} {
		if _, ok := updated.preflightFixErrors[name]; ok {
			t.Errorf("expected error for non-failing %q to be pruned; got %v",
				name, updated.preflightFixErrors[name])
		}
	}
	if _, ok := updated.preflightFixErrors["Fail Check"]; !ok {
		t.Errorf("expected error for still-failing check to be retained")
	}
}

package tui

import (
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/e2e"
	"github.com/airo-ai-builder/dev-runner/internal/probe"
	"github.com/airo-ai-builder/dev-runner/internal/process"
)

// probeTickModel returns a minimal Model configured for tickMsg cache-invalidation tests.
// The runner starts at prevState and the discovery cache starts with zero invalidations.
func probeTickModel(prevState probe.State, currentState probe.State) (Model, *probe.DiscoveryCache) {
	runner := &probe.Runner{}
	runner.SetStateForTest(currentState)

	cache := &probe.DiscoveryCache{}

	m := Model{
		manager:        &process.Manager{},
		probeRunner:    runner,
		e2eRunner:      &e2e.Runner{},
		discoveryCache: cache,
		probePrevState: prevState,
		phase:          PhaseRunning,
	}
	return m, cache
}

// sendTick sends a tickMsg through the model's Update and returns the updated model.
func sendTick(m Model) Model {
	result, _ := m.Update(tickMsg(time.Now()))
	return result.(Model)
}

func TestTickMsg_RunningToStopped_InvalidatesCache(t *testing.T) {
	m, cache := probeTickModel(probe.StateRunning, probe.StateStopped)

	_ = sendTick(m)

	if got := cache.InvalidateCount(); got != 1 {
		t.Errorf("InvalidateCount = %d, want 1 (Running→Stopped should invalidate)", got)
	}
}

func TestTickMsg_RunningToErrored_InvalidatesCache(t *testing.T) {
	m, cache := probeTickModel(probe.StateRunning, probe.StateErrored)

	_ = sendTick(m)

	if got := cache.InvalidateCount(); got != 1 {
		t.Errorf("InvalidateCount = %d, want 1 (Running→Errored should invalidate)", got)
	}
}

func TestTickMsg_RunningToRunning_NoInvalidation(t *testing.T) {
	m, cache := probeTickModel(probe.StateRunning, probe.StateRunning)

	_ = sendTick(m)

	if got := cache.InvalidateCount(); got != 0 {
		t.Errorf("InvalidateCount = %d, want 0 (Running→Running should not invalidate)", got)
	}
}

func TestTickMsg_IdleToRunning_NoInvalidation(t *testing.T) {
	m, cache := probeTickModel(probe.StateIdle, probe.StateRunning)

	_ = sendTick(m)

	if got := cache.InvalidateCount(); got != 0 {
		t.Errorf("InvalidateCount = %d, want 0 (Idle→Running should not invalidate)", got)
	}
}

func TestTickMsg_StoppedToStopped_NoInvalidation(t *testing.T) {
	m, cache := probeTickModel(probe.StateStopped, probe.StateStopped)

	_ = sendTick(m)

	if got := cache.InvalidateCount(); got != 0 {
		t.Errorf("InvalidateCount = %d, want 0 (Stopped→Stopped should not invalidate)", got)
	}
}

func TestTickMsg_UpdatesProbePrevState(t *testing.T) {
	m, _ := probeTickModel(probe.StateIdle, probe.StateRunning)

	updated := sendTick(m)

	if updated.probePrevState != probe.StateRunning {
		t.Errorf("probePrevState = %v, want StateRunning (should track current state after tick)",
			updated.probePrevState)
	}
}

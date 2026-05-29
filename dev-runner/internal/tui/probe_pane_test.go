package tui

import (
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/e2e"
	"github.com/airo-ai-builder/dev-runner/internal/probe"
	"github.com/airo-ai-builder/dev-runner/internal/process"
)

// TestProbeTabDotColor verifies the dot color mapping for probe state + stack health + blink.
func TestProbeTabDotColor(t *testing.T) {
	cases := []struct {
		name         string
		state        probe.State
		stackHealthy bool
		blinkOn      bool
		wantColor    string // "green", "gray", "red"
	}{
		{"idle_healthy", probe.StateIdle, true, false, "green"},
		{"idle_unhealthy", probe.StateIdle, false, false, "gray"},
		{"stopped_healthy", probe.StateStopped, true, false, "green"},
		{"stopped_unhealthy", probe.StateStopped, false, false, "gray"},
		{"running_blink_on", probe.StateRunning, true, true, "green"},
		{"running_blink_off", probe.StateRunning, true, false, "gray"},
		{"running_blink_on_unhealthy", probe.StateRunning, false, true, "green"},
		{"running_blink_off_unhealthy", probe.StateRunning, false, false, "gray"},
		{"errored_healthy", probe.StateErrored, true, false, "red"},
		{"errored_unhealthy", probe.StateErrored, false, false, "red"},
		{"errored_blink_on", probe.StateErrored, true, true, "red"},
	}

	colorName := func(c interface{}) string {
		switch c {
		case statusRunning:
			return "green"
		case statusStopped:
			return "gray"
		case statusErrored:
			return "red"
		case statusStarting:
			return "yellow"
		default:
			return "unknown"
		}
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := probeTabDotColor(tc.state, tc.stackHealthy, tc.blinkOn)
			if got == nil {
				t.Fatal("probeTabDotColor returned nil")
			}
			gotName := colorName(got)
			if gotName != tc.wantColor {
				t.Errorf("probeTabDotColor(%v, stackHealthy=%v, blinkOn=%v) = %s, want %s",
					tc.state, tc.stackHealthy, tc.blinkOn, gotName, tc.wantColor)
			}
		})
	}
}

// TestTabCountIncludesProbe verifies tabCount() returns All + processes + E2E + Probe.
// Uses a zero-process model so processCount() == 0 and the result is 1 + 0 + 2 = 3.
func TestTabCountIncludesProbe(t *testing.T) {
	m := minimalModel()
	got := m.tabCount()
	// 1 (All) + 0 (processes) + 1 (E2E) + 1 (Probe) = 3
	if got != 3 {
		t.Errorf("tabCount() = %d, want 3 (All + 0 processes + E2E + Probe)", got)
	}
}

// TestProbeTabIndex verifies probeTabIndex() == e2eTabIndex() + 1.
func TestProbeTabIndex(t *testing.T) {
	m := minimalModel()
	e2e := m.e2eTabIndex()
	probe := m.probeTabIndex()
	if probe != e2e+1 {
		t.Errorf("probeTabIndex() = %d, e2eTabIndex() = %d; want probeTabIndex == e2eTabIndex + 1",
			probe, e2e)
	}
}

// minimalModel returns a Model with no processes, suitable for testing tab math.
// It does not start any goroutines or open files.
func minimalModel() Model {
	return Model{
		manager:     &process.Manager{},
		probeRunner: &probe.Runner{},
		e2eRunner:   &e2e.Runner{},
	}
}

// TestNewProbeMenu_NineItems verifies the root menu has all 9 items.
func TestNewProbeMenu_NineItems(t *testing.T) {
	pm := newProbeMenu("/probe", nil, 24)
	items := pm.stack[0].items
	const wantItems = 9
	if len(items) != wantItems {
		t.Errorf("newProbeMenu root items = %d, want %d", len(items), wantItems)
	}
}

// TestBuildGraduateScenarioMenuItems_SendsGraduatePickerMsg verifies each item
// fires probeOpenPickerMsg with graduate=true and the correct scenario name.
func TestBuildGraduateScenarioMenuItems_SendsGraduatePickerMsg(t *testing.T) {
	scenarios := []probe.ScenarioInfo{
		{Name: "landing-page", Suite: "golden-light"},
		{Name: "contact-form", Suite: "golden-light"},
	}
	items := buildGraduateScenarioMenuItems(scenarios)
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}

	for i, item := range items {
		ab, ok := item.Behavior.(ActionBehavior)
		if !ok || ab.Fn == nil {
			t.Fatalf("items[%d].Behavior is not ActionBehavior or Fn is nil", i)
		}
		cmd := ab.Fn()
		if cmd == nil {
			t.Fatalf("items[%d].Behavior.Fn() returned nil cmd", i)
		}
		msg := cmd()
		pickerMsg, ok := msg.(probeOpenPickerMsg)
		if !ok {
			t.Fatalf("items[%d]: cmd() returned %T, want probeOpenPickerMsg", i, msg)
		}
		if !pickerMsg.graduate {
			t.Errorf("items[%d]: graduate = false, want true", i)
		}
		wantScenario := scenarios[i].Name
		st, ok := pickerMsg.baseArgs.Target.(probe.ScenarioTarget)
		if !ok {
			t.Fatalf("items[%d]: Target is %T, want probe.ScenarioTarget", i, pickerMsg.baseArgs.Target)
		}
		if st.Name != wantScenario {
			t.Errorf("items[%d]: Target.Name = %q, want %q", i, st.Name, wantScenario)
		}
	}
}

// TestBuildGraduateSuiteMenuItems_SendsGraduatePickerMsg verifies each suite item
// fires probeOpenPickerMsg with graduate=true and the correct suite name.
func TestBuildGraduateSuiteMenuItems_SendsGraduatePickerMsg(t *testing.T) {
	suites := map[string][]probe.ScenarioInfo{
		"golden-light": {{Name: "sc1"}},
		"heavy":        {{Name: "sc2"}},
	}
	items := buildGraduateSuiteMenuItems(suites)
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}

	for _, item := range items {
		ab, ok := item.Behavior.(ActionBehavior)
		if !ok || ab.Fn == nil {
			t.Fatalf("item %q Behavior is not ActionBehavior or Fn is nil", item.Label)
		}
		cmd := ab.Fn()
		if cmd == nil {
			t.Fatalf("item %q Behavior.Fn() returned nil cmd", item.Label)
		}
		msg := cmd()
		pickerMsg, ok := msg.(probeOpenPickerMsg)
		if !ok {
			t.Fatalf("item %q cmd() returned %T, want probeOpenPickerMsg", item.Label, msg)
		}
		if !pickerMsg.graduate {
			t.Errorf("item %q: graduate = false, want true", item.Label)
		}
		st, ok := pickerMsg.baseArgs.Target.(probe.SuiteTarget)
		if !ok {
			t.Fatalf("item %q: Target is %T, want probe.SuiteTarget", item.Label, pickerMsg.baseArgs.Target)
		}
		if st.Name == "" {
			t.Errorf("item %q: Target.Name is empty, want non-empty", item.Label)
		}
	}
}

// TestBuildEnvViewContent_ShowsKeyRows verifies that env lines with keys appear
// in the rendered output and sensitive values are masked.
func TestBuildEnvViewContent_ShowsKeyRows(t *testing.T) {
	lines := []probe.EnvLine{
		{Key: "GD_ENV", Value: "local.dev"},
		{Key: "OPENAI_API_KEY", Value: "supersecret"},
		{Raw: "# comment"},
	}
	content := buildEnvViewContent(lines)

	if !contains(content, "GD_ENV") {
		t.Error("buildEnvViewContent: GD_ENV not in output")
	}
	if !contains(content, "local.dev") {
		t.Error("buildEnvViewContent: local.dev not in output")
	}
	if contains(content, "supersecret") {
		t.Error("buildEnvViewContent: supersecret should be masked, but appears in output")
	}
	if !contains(content, "***") {
		t.Error("buildEnvViewContent: *** mask not in output for sensitive key")
	}
}

func contains(s, substr string) bool {
	return strings.Contains(s, substr)
}

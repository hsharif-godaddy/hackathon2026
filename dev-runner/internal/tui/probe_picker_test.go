package tui

import (
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/probe"
)

// --- buildProbeRunArgsFromPicker ---

func TestBuildProbeRunArgsFromPicker_TrialsAndEnvOverride(t *testing.T) {
	base := probe.RunArgs{
		Command: probe.CmdEval,
		Target:  probe.SuiteTarget{Name: "my-suite"},
		Trials:  3,
		Env:     "local.dev",
	}
	got, err := buildProbeRunArgsFromPicker(base, "7", "local.test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Trials != 7 {
		t.Errorf("Trials = %d, want 7", got.Trials)
	}
	if got.Env != "local.test" {
		t.Errorf("Env = %q, want %q", got.Env, "local.test")
	}
	// Other fields preserved
	if st, ok := got.Target.(probe.SuiteTarget); !ok || st.Name != "my-suite" {
		t.Errorf("Target = %v, want SuiteTarget{Name: %q}", got.Target, "my-suite")
	}
	if got.Command != probe.CmdEval {
		t.Errorf("Command = %v, want CmdEval", got.Command)
	}
}

func TestBuildProbeRunArgsFromPicker_EmptyTrials_UsesBase(t *testing.T) {
	base := probe.RunArgs{Target: probe.SuiteTarget{Name: "s"}, Trials: 5}
	got, err := buildProbeRunArgsFromPicker(base, "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Trials != 5 {
		t.Errorf("Trials = %d, want 5 (base)", got.Trials)
	}
}

func TestBuildProbeRunArgsFromPicker_InvalidTrials_ReturnsError(t *testing.T) {
	base := probe.RunArgs{Target: probe.SuiteTarget{Name: "s"}}
	if _, err := buildProbeRunArgsFromPicker(base, "abc", ""); err == nil {
		t.Error("expected error for non-numeric trials, got nil")
	}
}

func TestBuildProbeRunArgsFromPicker_ZeroTrials_ReturnsError(t *testing.T) {
	base := probe.RunArgs{Target: probe.SuiteTarget{Name: "s"}}
	if _, err := buildProbeRunArgsFromPicker(base, "0", ""); err == nil {
		t.Error("expected error for zero trials, got nil")
	}
}

func TestBuildProbeRunArgsFromPicker_NegativeTrials_ReturnsError(t *testing.T) {
	base := probe.RunArgs{Target: probe.SuiteTarget{Name: "s"}}
	if _, err := buildProbeRunArgsFromPicker(base, "-3", ""); err == nil {
		t.Error("expected error for negative trials, got nil")
	}
}

func TestBuildProbeRunArgsFromPicker_DefaultEnvSentinel_UsesBaseEnv(t *testing.T) {
	base := probe.RunArgs{Target: probe.SuiteTarget{Name: "s"}, Env: "local.dev"}
	got, err := buildProbeRunArgsFromPicker(base, "", probePickerEnvDefault)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// probePickerEnvDefault sentinel must not overwrite the base env
	if got.Env != "local.dev" {
		t.Errorf("Env = %q, want %q (base preserved)", got.Env, "local.dev")
	}
}

// --- buildProbeGraduateArgsFromPicker ---

func TestBuildProbeGraduateArgsFromPicker_SetsGraduateAndStability(t *testing.T) {
	base := probe.RunArgs{Command: probe.CmdEval, Target: probe.ScenarioTarget{Name: "landing-page"}}
	got := buildProbeGraduateArgsFromPicker(base, "medium")
	if !got.Graduate {
		t.Error("Graduate = false, want true")
	}
	if got.Stability != "medium" {
		t.Errorf("Stability = %q, want %q", got.Stability, "medium")
	}
	if st, ok := got.Target.(probe.ScenarioTarget); !ok || st.Name != "landing-page" {
		t.Errorf("Target = %v, want ScenarioTarget{Name: %q} (base preserved)", got.Target, "landing-page")
	}
	if got.ParallelSuites {
		t.Error("ParallelSuites = true, want false for ScenarioTarget")
	}
}

func TestBuildProbeGraduateArgsFromPicker_SuiteTarget_SetsParallelSuites(t *testing.T) {
	base := probe.RunArgs{Command: probe.CmdEval, Target: probe.SuiteTarget{Name: "golden-light"}}
	got := buildProbeGraduateArgsFromPicker(base, "high")
	if !got.Graduate {
		t.Error("Graduate = false, want true")
	}
	if got.Stability != "high" {
		t.Errorf("Stability = %q, want %q", got.Stability, "high")
	}
	if !got.ParallelSuites {
		t.Error("ParallelSuites = false, want true for SuiteTarget")
	}
}

// --- probePickerActive / openProbeRunPicker / openProbeGraduatePicker / closeProbePickerForm ---

func TestProbePickerActive_FalseWhenFormNil(t *testing.T) {
	m := Model{}
	if m.probePickerActive() {
		t.Error("probePickerActive() = true, want false when form is nil")
	}
}

func TestOpenProbeRunPicker_SetsFormAndBindings(t *testing.T) {
	m := Model{}
	m.openProbeRunPicker(probe.RunArgs{Target: probe.SuiteTarget{Name: "golden-light"}, Trials: 3})

	if m.probePickerForm == nil {
		t.Fatal("probePickerForm is nil after openProbeRunPicker")
	}
	if m.probePickerTrials == nil {
		t.Error("probePickerTrials binding is nil")
	}
	if m.probePickerEnv == nil {
		t.Error("probePickerEnv binding is nil")
	}
	if !m.probePickerActive() {
		t.Error("probePickerActive() = false after openProbeRunPicker")
	}
	// Base args stored
	if st, ok := m.probePickerBaseArgs.Target.(probe.SuiteTarget); !ok || st.Name != "golden-light" {
		t.Errorf("probePickerBaseArgs.Target = %v, want SuiteTarget{Name: %q}", m.probePickerBaseArgs.Target, "golden-light")
	}
}

func TestOpenProbeGraduatePicker_SetsFormAndStabilityBinding(t *testing.T) {
	m := Model{}
	m.openProbeGraduatePicker(probe.RunArgs{Target: probe.ScenarioTarget{Name: "landing-page"}})

	if m.probePickerForm == nil {
		t.Fatal("probePickerForm is nil after openProbeGraduatePicker")
	}
	if m.probePickerStab == nil {
		t.Error("probePickerStab binding is nil")
	}
	if !m.probePickerActive() {
		t.Error("probePickerActive() = false after openProbeGraduatePicker")
	}
	if st, ok := m.probePickerBaseArgs.Target.(probe.ScenarioTarget); !ok || st.Name != "landing-page" {
		t.Errorf("probePickerBaseArgs.Target = %v, want ScenarioTarget{Name: %q}", m.probePickerBaseArgs.Target, "landing-page")
	}
}

func TestCloseProbePickerForm_ClearsFormAndBindings(t *testing.T) {
	m := Model{}
	m.openProbeRunPicker(probe.RunArgs{Target: probe.SuiteTarget{Name: "s"}})
	m.closeProbePickerForm()

	if m.probePickerForm != nil {
		t.Error("probePickerForm is not nil after closeProbePickerForm")
	}
	if m.probePickerTrials != nil {
		t.Error("probePickerTrials is not nil after closeProbePickerForm")
	}
	if m.probePickerEnv != nil {
		t.Error("probePickerEnv is not nil after closeProbePickerForm")
	}
	if m.probePickerStab != nil {
		t.Error("probePickerStab is not nil after closeProbePickerForm")
	}
	if m.probePickerActive() {
		t.Error("probePickerActive() = true after closeProbePickerForm")
	}
}

// --- Integration seam: picker form height ---

// TestOpenProbeRunPicker_FormHasHeight verifies the huh form is created with a
// non-zero height so the select list scrolls when options exceed visible rows.
func TestOpenProbeRunPicker_FormHasHeight(t *testing.T) {
	m := Model{width: 80}
	m.openProbeRunPicker(probe.RunArgs{Target: probe.SuiteTarget{Name: "s"}})
	if m.probePickerForm == nil {
		t.Fatal("probePickerForm is nil")
	}
	// We can't introspect huh.Form height directly; instead verify the form
	// renders without panicking (exercises the height code path).
	_ = m.probePickerForm.View()
}

func TestOpenProbeGraduatePicker_FormHasHeight(t *testing.T) {
	m := Model{width: 80}
	m.openProbeGraduatePicker(probe.RunArgs{Target: probe.ScenarioTarget{Name: "s"}})
	if m.probePickerForm == nil {
		t.Fatal("probePickerForm is nil")
	}
	_ = m.probePickerForm.View()
}

// --- buildCustomRunArgsFromForm ---

func TestBuildCustomRunArgsFromForm_ScenarioOnly(t *testing.T) {
	got, err := buildCustomRunArgsFromForm("my-scenario", "", "", "", "", "", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	st, ok := got.Target.(probe.ScenarioTarget)
	if !ok {
		t.Fatalf("Target = %T, want probe.ScenarioTarget", got.Target)
	}
	if st.Name != "my-scenario" {
		t.Errorf("Target.Name = %q, want %q", st.Name, "my-scenario")
	}
}

func TestBuildCustomRunArgsFromForm_SuiteOnly(t *testing.T) {
	got, err := buildCustomRunArgsFromForm("", "my-suite", "", "", "", "", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	st, ok := got.Target.(probe.SuiteTarget)
	if !ok {
		t.Fatalf("Target = %T, want probe.SuiteTarget", got.Target)
	}
	if st.Name != "my-suite" {
		t.Errorf("Target.Name = %q, want %q", st.Name, "my-suite")
	}
}

func TestBuildCustomRunArgsFromForm_NumericOverrides(t *testing.T) {
	got, err := buildCustomRunArgsFromForm("sc", "", "5", "2", "20", "", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Trials != 5 {
		t.Errorf("Trials = %d, want 5", got.Trials)
	}
	if got.Concurrency != 2 {
		t.Errorf("Concurrency = %d, want 2", got.Concurrency)
	}
	if got.MaxTurns != 20 {
		t.Errorf("MaxTurns = %d, want 20", got.MaxTurns)
	}
}

func TestBuildCustomRunArgsFromForm_EmptyNumeric_UsesZero(t *testing.T) {
	got, err := buildCustomRunArgsFromForm("sc", "", "", "", "", "", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Trials != 0 || got.Concurrency != 0 || got.MaxTurns != 0 {
		t.Errorf("expected zeros for empty numeric fields, got trials=%d concurrency=%d maxTurns=%d",
			got.Trials, got.Concurrency, got.MaxTurns)
	}
}

func TestBuildCustomRunArgsFromForm_Toggles(t *testing.T) {
	got, err := buildCustomRunArgsFromForm("", "s", "", "", "", "", true, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got.SkipBaseline {
		t.Error("SkipBaseline = false, want true")
	}
	if !got.ParallelSuites {
		t.Error("ParallelSuites = false, want true")
	}
}

func TestBuildCustomRunArgsFromForm_EnvOverride(t *testing.T) {
	got, err := buildCustomRunArgsFromForm("sc", "", "", "", "", "local.test", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Env != "local.test" {
		t.Errorf("Env = %q, want %q", got.Env, "local.test")
	}
}

func TestBuildCustomRunArgsFromForm_InvalidTrials_ReturnsError(t *testing.T) {
	if _, err := buildCustomRunArgsFromForm("sc", "", "bad", "", "", "", false, false); err == nil {
		t.Error("expected error for non-numeric trials, got nil")
	}
}

func TestBuildCustomRunArgsFromForm_ZeroTrials_ReturnsError(t *testing.T) {
	if _, err := buildCustomRunArgsFromForm("sc", "", "0", "", "", "", false, false); err == nil {
		t.Error("expected error for zero trials, got nil")
	}
}

func TestBuildCustomRunArgsFromForm_InvalidConcurrency_ReturnsError(t *testing.T) {
	if _, err := buildCustomRunArgsFromForm("sc", "", "", "-1", "", "", false, false); err == nil {
		t.Error("expected error for negative concurrency, got nil")
	}
}

func TestBuildCustomRunArgsFromForm_CommandIsEval(t *testing.T) {
	got, err := buildCustomRunArgsFromForm("sc", "", "", "", "", "", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Command != probe.CmdEval {
		t.Errorf("Command = %v, want CmdEval", got.Command)
	}
}

// --- Custom run form lifecycle ---

func TestProbeCustomRunActive_FalseWhenNil(t *testing.T) {
	m := Model{}
	if m.probeCustomRunActive() {
		t.Error("probeCustomRunActive() = true, want false when form is nil")
	}
}

func TestOpenProbeCustomRunForm_SetsFormAndBindings(t *testing.T) {
	m := Model{width: 80}
	m.openProbeCustomRunForm()
	if m.probeCustomRunForm == nil {
		t.Fatal("probeCustomRunForm is nil after openProbeCustomRunForm")
	}
	if !m.probeCustomRunActive() {
		t.Error("probeCustomRunActive() = false after open")
	}
}

func TestCloseProbeCustomRunForm_ClearsForm(t *testing.T) {
	m := Model{width: 80}
	m.openProbeCustomRunForm()
	m.closeProbeCustomRunForm()
	if m.probeCustomRunForm != nil {
		t.Error("probeCustomRunForm is not nil after close")
	}
	if m.probeCustomRunActive() {
		t.Error("probeCustomRunActive() = true after close")
	}
}

// --- Env edit form lifecycle ---

func TestProbeEnvEditActive_FalseWhenNil(t *testing.T) {
	m := Model{}
	if m.probeEnvEditActive() {
		t.Error("probeEnvEditActive() = true, want false when form is nil")
	}
}

func TestOpenProbeEnvEditInputForm_SetsFormAndBinding(t *testing.T) {
	m := Model{width: 80}
	m.openProbeEnvEditInputForm("GD_ENV", "local.dev", func(v string) error { return nil })
	if m.probeEnvEditForm == nil {
		t.Fatal("probeEnvEditForm is nil after open")
	}
	if !m.probeEnvEditActive() {
		t.Error("probeEnvEditActive() = false after open")
	}
}

func TestOpenProbeEnvSwitchForm_SetsForm(t *testing.T) {
	m := Model{width: 80}
	m.openProbeEnvSwitchForm(func(v string) error { return nil })
	if m.probeEnvEditForm == nil {
		t.Fatal("probeEnvEditForm is nil after openProbeEnvSwitchForm")
	}
}

func TestCloseProbeEnvEditForm_ClearsForm(t *testing.T) {
	m := Model{width: 80}
	m.openProbeEnvEditInputForm("K", "v", func(v string) error { return nil })
	m.closeProbeEnvEditForm()
	if m.probeEnvEditForm != nil {
		t.Error("probeEnvEditForm is not nil after close")
	}
	if m.probeEnvEditActive() {
		t.Error("probeEnvEditActive() = true after close")
	}
}

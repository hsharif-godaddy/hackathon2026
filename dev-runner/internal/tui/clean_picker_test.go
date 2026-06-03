package tui

import (
	"testing"

	tea "charm.land/bubbletea/v2"

	"github.com/airo-ai-builder/dev-runner/internal/clean"
	"github.com/airo-ai-builder/dev-runner/internal/config"
	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/process"
)

// TestCleanPickerDefaults captures the picker's pre-checked state. node_modules
// becoming a default-on group is a deliberate change (#4413 review thread):
// in practice it's a common reason people clean, and the cost of an
// unintentional reinstall is bounded (one extra `pnpm install` cycle).
func TestCleanPickerDefaults(t *testing.T) {
	var defaultIndices []int
	for i, g := range cleanGroups {
		if g.selected {
			defaultIndices = append(defaultIndices, i)
		}
	}
	got := assembleSelection(defaultIndices)
	want := clean.Selection{BuildArtifacts: true, NodeModules: true}
	if got != want {
		t.Errorf("default picker selection = %+v, want %+v", got, want)
	}
}

// TestSettingsMenuIncludesCleanRestart pins the menu shape expected by Matt's
// PR feedback — the action is reachable from `s` so users don't need to know
// the `c` shortcut from the dashboard or the --clean CLI flags.
func TestSettingsMenuIncludesCleanRestart(t *testing.T) {
	items := buildSettingsItems(&config.Config{})

	var foundLabel bool
	var foundAction bool
	for _, item := range items {
		if item.Label == "Clean + Restart..." {
			foundLabel = true
		}
		if item.Action == ActionCleanRestart {
			foundAction = true
		}
	}
	if !foundLabel {
		t.Error("settings menu missing 'Clean + Restart...' label")
	}
	if !foundAction {
		t.Error("settings menu missing ActionCleanRestart entry")
	}
}

// TestExecuteSettingsAction_CleanRestart_OpensPicker pins the action wiring:
// invoking ActionCleanRestart from the settings menu marks the return phase
// (so cancel paths know where to go) and transitions to the picker phase,
// reusing the same picker as dashboard 'c' and --clean.
func TestExecuteSettingsAction_CleanRestart_OpensPicker(t *testing.T) {
	m := Model{
		settingsItems: []SettingsItem{{Label: "Clean + Restart...", Action: ActionCleanRestart}},
		phase:         PhaseRunning,
		manager:       &process.Manager{},
	}

	_ = m.executeSettingsAction(0)

	if m.phase != PhasePreflightCleanPicker {
		t.Errorf("phase: got %v, want PhasePreflightCleanPicker", m.phase)
	}
	if m.cleanPickerReturnPhase != PhaseRunning {
		t.Errorf("cleanPickerReturnPhase: got %v, want PhaseRunning", m.cleanPickerReturnPhase)
	}
	if m.cleanPickerForm == nil {
		t.Error("cleanPickerForm should be initialized")
	}
}

// TestAdvancePastClean_FromRunning_RunsPreflightNotJustHooks captures the
// review-comment fix: clean+restart MUST run preflight, because preflight's
// fixers (EnvFixer, S2SCertsFixer, JWTKeysFixer, LCPEnvFixer, …) are the
// only path that regenerates env files & certs the clean removed. Skipping
// straight to PhaseHooks restarts processes against a tree missing config.
func TestAdvancePastClean_FromRunning_RunsPreflightNotJustHooks(t *testing.T) {
	m := Model{
		phase:                  PhasePreflightCleaning,
		cleanPickerReturnPhase: PhaseRunning,
		manager:                &process.Manager{}, // empty Processes; StopAll is a no-op
		preflightRunner:        &preflight.Runner{},
		// Pretend prior dashboard state existed so we can verify it's cleared.
		preflightResults: []preflight.CheckResult{{Status: preflight.StatusPass, Name: "stale"}},
	}

	cmd := m.advancePastClean()

	if m.phase != PhasePreflightChecking {
		t.Errorf("phase: got %v, want PhasePreflightChecking (skipping preflight strands env/certs)", m.phase)
	}
	if m.preflightResults != nil {
		t.Errorf("preflightResults should be cleared, got %+v", m.preflightResults)
	}
	if cmd == nil {
		t.Error("expected a tea.Cmd kicking off preflight RunAll, got nil")
	}
}

// TestAdvancePastClean_FromDashboard_GoesToVerifying preserves the
// dashboard-origin behavior so the new PhaseRunning case doesn't accidentally
// regress the prior path.
func TestAdvancePastClean_FromDashboard_GoesToVerifying(t *testing.T) {
	m := Model{
		phase:                  PhasePreflightCleaning,
		cleanPickerReturnPhase: PhasePreflightDashboard,
		manager:                &process.Manager{},
		preflightRunner:        &preflight.Runner{},
	}

	_ = m.advancePastClean()

	if m.phase != PhasePreflightVerifying {
		t.Errorf("phase: got %v, want PhasePreflightVerifying", m.phase)
	}
}

// TestAdvancePastClean_CleanOnly_Quits captures the `dev-runner clean`
// (interactive `pnpm run clean`) flow: the user wanted a clean, not a dev
// session, so a successful clean should quit instead of starting preflight.
func TestAdvancePastClean_CleanOnly_Quits(t *testing.T) {
	m := Model{
		phase:           PhasePreflightCleaning,
		cleanOnly:       true,
		manager:         &process.Manager{},
		preflightRunner: &preflight.Runner{},
	}

	cmd := m.advancePastClean()
	if cmd == nil {
		t.Fatal("expected tea.Quit cmd, got nil")
	}
	if _, ok := cmd().(tea.QuitMsg); !ok {
		t.Errorf("cleanOnly + success should return tea.Quit; got %T", cmd())
	}
	if !m.quitting {
		t.Error("m.quitting should be true after cleanOnly advance")
	}
}

// TestExitCleanPicker_CleanOnly_Quits covers the cancel path: pressing Esc
// in the picker from `dev-runner clean` should also quit, because there's
// no dev session to fall back into.
func TestExitCleanPicker_CleanOnly_Quits(t *testing.T) {
	m := Model{cleanOnly: true}

	cmd := m.exitCleanPicker()
	if cmd == nil {
		t.Fatal("expected tea.Quit cmd, got nil")
	}
	if _, ok := cmd().(tea.QuitMsg); !ok {
		t.Errorf("cleanOnly + cancel should return tea.Quit; got %T", cmd())
	}
}

// TestInitialPhase_CleanOnly_OpensPicker pins the cleanOnly startup wiring:
// `dev-runner clean` (no flags) should land directly on the picker phase.
func TestInitialPhase_CleanOnly_OpensPicker(t *testing.T) {
	got := initialPhase(false, false, true)
	if got != PhasePreflightCleanPicker {
		t.Errorf("initialPhase(cleanOnly=true) = %v, want PhasePreflightCleanPicker", got)
	}
}

func TestAssembleSelection(t *testing.T) {
	tests := []struct {
		name    string
		indices []int
		want    clean.Selection
	}{
		{
			name:    "empty slice → zero selection",
			indices: nil,
			want:    clean.Selection{},
		},
		{
			name:    "build only (default picker selection)",
			indices: []int{0},
			want:    clean.Selection{BuildArtifacts: true},
		},
		{
			name:    "all four groups",
			indices: []int{0, 1, 2, 3},
			want:    clean.All(),
		},
		{
			name:    "duplicate indices are idempotent",
			indices: []int{0, 0, 0},
			want:    clean.Selection{BuildArtifacts: true},
		},
		{
			name:    "out-of-range high is silently ignored",
			indices: []int{0, 99},
			want:    clean.Selection{BuildArtifacts: true},
		},
		{
			name:    "negative is silently ignored",
			indices: []int{-1, 1},
			want:    clean.Selection{RuntimeData: true},
		},
		{
			name:    "all-bogus → empty selection (does not panic)",
			indices: []int{-5, 99, 1000},
			want:    clean.Selection{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := assembleSelection(tt.indices)
			if got != tt.want {
				t.Errorf("assembleSelection(%v) = %+v, want %+v", tt.indices, got, tt.want)
			}
		})
	}
}

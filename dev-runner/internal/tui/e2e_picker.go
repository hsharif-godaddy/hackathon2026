package tui

import (
	"context"
	"fmt"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

	"github.com/airo-ai-builder/dev-runner/internal/e2e"
)

// E2EPickerStep represents which screen of the multi-step E2E picker is active.
//
// The picker is two huh forms in sequence rather than one form with three
// groups: between Step1 and Step2 we run `playwright test --list` (which can
// take several seconds), so we need a Loading screen with a spinner. huh
// doesn't expose mid-form async loading, so a state machine is cleaner.
type E2EPickerStep int

const (
	E2EPickerInactive E2EPickerStep = iota
	E2EPickerStep1ProjectEnv
	E2EPickerStepLoading
	E2EPickerStep2Tests
)

// e2ePickerEnvOptions mirrors the allowlist in scripts/e2e.sh:20.
var e2ePickerEnvOptions = []string{"local", "dev", "pre-test", "test", "prod"}

// e2ePickerProjectOptions enumerates the projects defined in
// playwright.config.ts. The labels expand the bare project name with timing
// hints; the value is the bare name passed to --project.
var e2ePickerProjectOptions = []struct {
	Value string
	Label string
}{
	{"e2e", "e2e (critical path, ~10 min)"},
	{"regression", "regression (full suite, ~30+ min)"},
}

// --- Bubble Tea messages ---

type e2eListLoadedMsg struct {
	Project string
	Env     string
	Tests   []string
	Err     error
}

// openE2EPicker starts step 1 of the picker (project + env).
func (m *Model) openE2EPicker() tea.Cmd {
	project := "e2e"
	env := "local"
	m.e2ePickerProject = &project
	m.e2ePickerEnv = &env
	m.e2ePickerStep = E2EPickerStep1ProjectEnv
	m.e2ePickerError = ""

	projectOpts := make([]huh.Option[string], len(e2ePickerProjectOptions))
	for i, p := range e2ePickerProjectOptions {
		projectOpts[i] = huh.NewOption(p.Label, p.Value)
	}

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Run E2E Tests — 1/2").
				Description("Pick the project (suite) and environment.").
				Options(projectOpts...).
				Value(&project),
			huh.NewSelect[string]().
				Title("Environment").
				Description("local = pnpm run dev on this machine; test/pre-test = CI envs; prod = production").
				Options(huhStringOptions(e2ePickerEnvOptions)...).
				Value(&env),
		),
	).WithShowHelp(true)

	m.e2ePickerForm = m.applyModalForm(form)
	return m.e2ePickerForm.Init()
}

// updateE2EPicker is the multi-step driver. Returns commands from the active
// huh form plus any transition triggered by completion of a step.
func (m *Model) updateE2EPicker(msg tea.Msg) tea.Cmd {
	switch m.e2ePickerStep {
	case E2EPickerStep1ProjectEnv:
		return m.updateE2EPickerStep1(msg)
	case E2EPickerStepLoading:
		// Loading screen consumes nothing — the e2eListLoadedMsg arrives via
		// the main Update which dispatches into transitionToTestList.
		return nil
	case E2EPickerStep2Tests:
		return m.updateE2EPickerStep2(msg)
	}
	return nil
}

func (m *Model) updateE2EPickerStep1(msg tea.Msg) tea.Cmd {
	if m.e2ePickerForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.e2ePickerForm, cmd = stepForm(m.e2ePickerForm, msg)

	switch m.e2ePickerForm.State {
	case huh.StateCompleted:
		project := *m.e2ePickerProject
		env := *m.e2ePickerEnv
		m.e2ePickerForm = nil
		m.e2ePickerStep = E2EPickerStepLoading
		// Derive a cancellable context from background so Esc on the loading
		// screen can SIGTERM the playwright subprocess. ListTests honors
		// ctx.Done via exec.CommandContext.
		ctx, cancel := context.WithCancel(context.Background())
		m.e2ePickerLoadCancel = cancel
		return tea.Batch(loadE2ETestsCmd(ctx, m.projectRoot, project, env), m.spinner.Tick)
	case huh.StateAborted:
		m.closeE2EPicker()
		return nil
	}
	return cmd
}

// transitionToTestList swaps the picker into step 2 once the test list is
// available. Called from the main Update on e2eListLoadedMsg.
func (m *Model) transitionToTestList(msg e2eListLoadedMsg) tea.Cmd {
	if m.e2ePickerStep != E2EPickerStepLoading {
		return nil
	}
	// Loading finished — release the cancel handle so a later Esc doesn't
	// signal a long-since-exited process.
	if m.e2ePickerLoadCancel != nil {
		m.e2ePickerLoadCancel()
		m.e2ePickerLoadCancel = nil
	}
	if msg.Err != nil {
		m.e2ePickerError = fmt.Sprintf("Could not list tests: %v", msg.Err)
		m.e2ePickerStep = E2EPickerInactive
		return nil
	}
	if len(msg.Tests) == 0 {
		m.e2ePickerError = fmt.Sprintf("No tests found in project %q", msg.Project)
		m.e2ePickerStep = E2EPickerInactive
		return nil
	}

	m.e2ePickerAvailable = msg.Tests

	// Pre-select all tests so "press Enter" runs the whole project — the
	// most common path. User can de-select individual tests with space.
	selected := make([]string, len(msg.Tests))
	copy(selected, msg.Tests)
	m.e2ePickerTests = &selected

	maxWidth := m.modalWidth()
	opts := make([]huh.Option[string], len(msg.Tests))
	for i, name := range msg.Tests {
		opts[i] = huh.NewOption(truncateMiddle(name, maxWidth-6), name).Selected(true)
	}

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewMultiSelect[string]().
				Title(fmt.Sprintf("Run E2E Tests — 2/2 (%s/%s)", msg.Project, msg.Env)).
				Description("Space toggles. All tests are pre-selected — press Enter to run.").
				Options(opts...).
				Value(&selected).
				Height(8),
		),
	).WithShowHelp(true)

	m.e2ePickerForm = m.applyModalForm(form)
	m.e2ePickerStep = E2EPickerStep2Tests
	return m.e2ePickerForm.Init()
}

func (m *Model) updateE2EPickerStep2(msg tea.Msg) tea.Cmd {
	if m.e2ePickerForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.e2ePickerForm, cmd = stepForm(m.e2ePickerForm, msg)

	switch m.e2ePickerForm.State {
	case huh.StateCompleted:
		project := *m.e2ePickerProject
		env := *m.e2ePickerEnv
		// If the user selected every test, omit the -g filter so we run the
		// whole project. With every-test selected, the filter is a no-op but
		// still pays a per-test regex match cost on the Playwright side.
		var tests []string
		if m.e2ePickerTests != nil && len(*m.e2ePickerTests) < len(m.e2ePickerAvailable) {
			tests = append(tests, *m.e2ePickerTests...)
		}
		m.closeE2EPicker()
		return m.startE2ERun(e2e.Args{Project: project, Env: env, TestNames: tests})
	case huh.StateAborted:
		m.closeE2EPicker()
		return nil
	}
	return cmd
}

func (m *Model) closeE2EPicker() {
	// Cancel any in-flight `playwright test --list` so the subprocess exits
	// instead of running to completion in the background.
	if m.e2ePickerLoadCancel != nil {
		m.e2ePickerLoadCancel()
		m.e2ePickerLoadCancel = nil
	}
	m.e2ePickerForm = nil
	m.e2ePickerStep = E2EPickerInactive
	m.e2ePickerProject = nil
	m.e2ePickerEnv = nil
	m.e2ePickerTests = nil
	m.e2ePickerAvailable = nil
}

// renderE2EPicker is called from view.go to draw the active picker step. The
// loading and step screens are rendered inline; the picker form is rendered
// as an overlay modal by the caller.
func (m Model) renderE2EPicker() string {
	if m.e2ePickerForm == nil {
		return ""
	}
	return settingsBoxStyle.Render(m.e2ePickerForm.View())
}

// renderE2EPickerLoading renders the spinner panel shown between step 1 and
// step 2 while playwright list is in flight. Wrapped in the same box style as
// other modals so the overlay placement math is consistent.
func (m Model) renderE2EPickerLoading() string {
	if m.e2ePickerStep != E2EPickerStepLoading {
		return ""
	}
	body := joinNonEmpty("\n",
		hookTitleStyle.Render("Loading test list..."),
		"",
		fmt.Sprintf("%s pnpm exec playwright test --list", m.spinner.View()),
		"",
		keyHintStyle.Render("Press Esc to cancel"),
	)
	return settingsBoxStyle.Render(body)
}

// renderE2EPickerError is shown after a list failure — sits in the modal slot
// until the user dismisses with any key. Returned to the caller via overlay.
func (m Model) renderE2EPickerError() string {
	if m.e2ePickerError == "" {
		return ""
	}
	body := joinNonEmpty("\n",
		errorLineStyle.Render(" Could not load tests "),
		"",
		m.e2ePickerError,
		"",
		keyHintStyle.Render("Press any key to dismiss"),
	)
	return settingsBoxStyle.Render(body)
}

// e2ePickerActive reports whether any picker overlay is currently in flight.
// Used by anyModalOpen to gate background interaction.
func (m Model) e2ePickerActive() bool {
	return m.e2ePickerStep != E2EPickerInactive || m.e2ePickerError != ""
}

// loadE2ETestsCmd runs `playwright test --list` and returns the parsed titles.
// Derives a 60s timeout from the caller-provided parent so the UI can cancel
// the in-flight subprocess on Esc — listing should finish in seconds, and
// anything longer is a stuck pnpm/playwright better off restarted.
func loadE2ETestsCmd(parent context.Context, projectRoot, project, env string) tea.Cmd {
	return func() tea.Msg {
		if parent == nil {
			parent = context.Background()
		}
		ctx, cancel := context.WithTimeout(parent, 60*time.Second)
		defer cancel()
		tests, err := e2e.ListTests(ctx, projectRoot, project)
		return e2eListLoadedMsg{Project: project, Env: env, Tests: tests, Err: err}
	}
}

func huhStringOptions(values []string) []huh.Option[string] {
	opts := make([]huh.Option[string], len(values))
	for i, v := range values {
		opts[i] = huh.NewOption(v, v)
	}
	return opts
}

// --- runner control ---

// startE2ERun kicks off the run and (on success) switches to the E2E tab. The
// TUI polls runner state via tickMsg → refreshPanes; no callbacks are involved.
//
// The Start() error check has to come first — otherwise a failure (e.g.,
// "run already in progress") leaves the user staring at an empty E2E pane
// with the error overlay floating over it, suggesting a run did start.
func (m *Model) startE2ERun(args e2e.Args) tea.Cmd {
	m.e2eRunner.ClearLines()
	if err := m.e2eRunner.Start(args); err != nil {
		m.e2ePickerError = err.Error()
		return nil
	}
	m.activeTab = m.e2eTabIndex()
	m.e2ePane.AutoFollow = true
	m.resizePanes()
	return nil
}

// stopE2ERun signals the runner to stop. The state transition becomes visible
// to the UI on the next refreshPanes tick.
func (m *Model) stopE2ERun() tea.Cmd {
	go m.e2eRunner.Stop()
	return nil
}

package tui

import (
	"fmt"
	"strconv"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

	"github.com/airo-ai-builder/dev-runner/internal/probe"
)

// probePickerEnvDefault is the sentinel value for "use the default GD_ENV from
// .env". Displayed as the first option in the env select; not written to RunArgs.
const probePickerEnvDefault = "default (from .env)"

var probePickerEnvOptions = []string{
	probePickerEnvDefault,
	"local.dev",
	"local.test",
	"local.prod",
}

var probePickerStabilityOptions = []string{"low", "medium", "high"}

// buildProbeRunArgsFromPicker merges picker-supplied overrides into baseArgs.
//
// trialsStr: empty → keep baseArgs.Trials; non-empty → must parse as a positive int.
// envStr: probePickerEnvDefault or empty → keep baseArgs.Env; otherwise → override.
func buildProbeRunArgsFromPicker(baseArgs probe.RunArgs, trialsStr, envStr string) (probe.RunArgs, error) {
	result := baseArgs
	if trialsStr != "" {
		n, err := strconv.Atoi(trialsStr)
		if err != nil || n <= 0 {
			return probe.RunArgs{}, fmt.Errorf("trials must be a positive integer, got %q", trialsStr)
		}
		result.Trials = n
	}
	if envStr != "" && envStr != probePickerEnvDefault {
		result.Env = envStr
	}
	return result, nil
}

// buildProbeGraduateArgsFromPicker sets Graduate=true and Stability on baseArgs.
func buildProbeGraduateArgsFromPicker(baseArgs probe.RunArgs, stability string) probe.RunArgs {
	result := baseArgs
	result.Graduate = true
	result.Stability = stability
	// nil Target (run-all) intentionally falls through; only suites use --fan-out.
	if _, ok := result.Target.(probe.SuiteTarget); ok {
		result.ParallelSuites = true
	}
	return result
}

// probePickerActive reports whether the probe run-options picker is open.
func (m Model) probePickerActive() bool {
	return m.probePickerForm != nil
}

// openProbeRunPicker opens a two-field modal form collecting optional trials and
// env overrides for a probe run. baseArgs stores the base RunArgs to augment on
// completion.
func (m *Model) openProbeRunPicker(baseArgs probe.RunArgs) tea.Cmd {
	trials := ""
	env := probePickerEnvDefault
	m.probePickerTrials = &trials
	m.probePickerEnv = &env
	m.probePickerStab = nil
	m.probePickerBaseArgs = baseArgs

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Run Options — Trials override").
				Description("Leave empty to use the scenario default. Must be a positive integer.").
				Placeholder("e.g. 5").
				Value(&trials),
			huh.NewSelect[string]().
				Title("Environment").
				Description("GD_ENV to use for this run.").
				Options(huhStringOptions(probePickerEnvOptions)...).
				Value(&env),
		),
	).WithShowHelp(true).WithHeight(12)

	m.probePickerForm = m.applyModalForm(form)
	return m.probePickerForm.Init()
}

// openProbeGraduatePicker opens a single-field modal form selecting a stability
// level for a graduation run.
func (m *Model) openProbeGraduatePicker(baseArgs probe.RunArgs) tea.Cmd {
	stab := "medium"
	m.probePickerStab = &stab
	m.probePickerTrials = nil
	m.probePickerEnv = nil
	m.probePickerBaseArgs = baseArgs

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Graduate — Stability Level").
				// Values must match STABILITY_TRIALS in evals/gosym-probe/src/scenarios/types.ts.
				Description("low=5 trials  medium=10 trials  high=20 trials").
				Options(huhStringOptions(probePickerStabilityOptions)...).
				Value(&stab),
		),
	).WithShowHelp(true).WithHeight(8)

	m.probePickerForm = m.applyModalForm(form)
	return m.probePickerForm.Init()
}

// updateProbePicker forwards msg to the open huh form and handles completion /
// abort. On completion assembles RunArgs and triggers a startProbeRun.
func (m *Model) updateProbePicker(msg tea.Msg) tea.Cmd {
	if m.probePickerForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.probePickerForm, cmd = stepForm(m.probePickerForm, msg)

	switch m.probePickerForm.State {
	case huh.StateCompleted:
		args, err := m.assemblePickerArgs()
		m.closeProbePickerForm()
		if err != nil {
			m.probeStatusMsg = "Invalid input: " + err.Error()
			return nil
		}
		return func() tea.Msg { return probeStartRunMsg{args: args} }

	case huh.StateAborted:
		m.closeProbePickerForm()
	}
	return cmd
}

// assemblePickerArgs builds the final RunArgs from the stored base args and
// bound picker field values.
func (m *Model) assemblePickerArgs() (probe.RunArgs, error) {
	if m.probePickerStab != nil {
		return buildProbeGraduateArgsFromPicker(m.probePickerBaseArgs, *m.probePickerStab), nil
	}
	trialsStr := ""
	if m.probePickerTrials != nil {
		trialsStr = *m.probePickerTrials
	}
	envStr := ""
	if m.probePickerEnv != nil {
		envStr = *m.probePickerEnv
	}
	return buildProbeRunArgsFromPicker(m.probePickerBaseArgs, trialsStr, envStr)
}

// closeProbePickerForm nils the form and all bound field pointers.
func (m *Model) closeProbePickerForm() {
	m.probePickerForm = nil
	m.probePickerTrials = nil
	m.probePickerEnv = nil
	m.probePickerStab = nil
}

// renderProbePicker renders the open picker form inside a settings box modal.
func (m Model) renderProbePicker() string {
	if m.probePickerForm == nil {
		return ""
	}
	return settingsBoxStyle.Render(m.probePickerForm.View())
}

// =============================================================================
// Custom Run Form
// =============================================================================

// buildCustomRunArgsFromForm assembles a RunArgs from the raw string/bool field
// values collected by the custom run form.
//
// scenario and suite are mutually exclusive; scenario takes precedence if both
// are non-empty. Empty numeric strings produce a zero value (use runner default).
func buildCustomRunArgsFromForm(
	scenario, suite string,
	trials, concurrency, maxTurns string,
	env string,
	skipBaseline, fanOut bool,
) (probe.RunArgs, error) {
	// Scenario takes precedence over suite when both are set.
	var target probe.Target
	switch {
	case scenario != "":
		target = probe.ScenarioTarget{Name: scenario}
	case suite != "":
		target = probe.SuiteTarget{Name: suite}
	}

	args := probe.RunArgs{
		Command:        probe.CmdEval,
		Target:         target,
		Env:            env,
		SkipBaseline:   skipBaseline,
		ParallelSuites: fanOut,
	}

	var err error
	if args.Trials, err = parsePositiveIntOrZero("trials", trials); err != nil {
		return probe.RunArgs{}, err
	}
	if args.Concurrency, err = parsePositiveIntOrZero("concurrency", concurrency); err != nil {
		return probe.RunArgs{}, err
	}
	if args.MaxTurns, err = parsePositiveIntOrZero("max-turns", maxTurns); err != nil {
		return probe.RunArgs{}, err
	}
	return args, nil
}

// parsePositiveIntOrZero parses s as a positive integer. An empty string
// returns 0 (meaning "use runner default"). A non-positive value is an error.
func parsePositiveIntOrZero(field, s string) (int, error) {
	if s == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer, got %q", field, s)
	}
	return n, nil
}

// probeCustomRunActive reports whether the custom run form is open.
func (m Model) probeCustomRunActive() bool {
	return m.probeCustomRunForm != nil
}

// openProbeCustomRunForm opens the multi-field custom run modal form.
func (m *Model) openProbeCustomRunForm() tea.Cmd {
	scenario := ""
	suite := ""
	trials := ""
	concurrency := ""
	maxTurns := ""
	env := probePickerEnvDefault
	skipBL := false
	fanOut := false

	m.probeCustomRunScenario = &scenario
	m.probeCustomRunSuite = &suite
	m.probeCustomRunTrials = &trials
	m.probeCustomRunConcurrency = &concurrency
	m.probeCustomRunMaxTurns = &maxTurns
	m.probeCustomRunEnv = &env
	m.probeCustomRunSkipBL = &skipBL
	m.probeCustomRunFanOut = &fanOut

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Scenario").
				Description("Leave blank to use suite or run all. Overrides suite if both set.").
				Placeholder("e.g. landing-page").
				Value(&scenario),
			huh.NewInput().
				Title("Suite").
				Description("Leave blank to use scenario or run all.").
				Placeholder("e.g. golden-light").
				Value(&suite),
			huh.NewSelect[string]().
				Title("Environment").
				Description("GD_ENV for this run.").
				Options(huhStringOptions(probePickerEnvOptions)...).
				Value(&env),
		),
		huh.NewGroup(
			huh.NewInput().
				Title("Trials").
				Description("Trials per scenario. Leave blank for default.").
				Placeholder("e.g. 3").
				Value(&trials),
			huh.NewInput().
				Title("Concurrency").
				Description("Max parallel trials. Leave blank for default.").
				Placeholder("e.g. 2").
				Value(&concurrency),
			huh.NewInput().
				Title("Max Turns").
				Description("Max conversation turns. Leave blank for default.").
				Placeholder("e.g. 30").
				Value(&maxTurns),
			huh.NewConfirm().
				Title("Skip Baseline").
				Description("Skip baseline comparison for this run.").
				Value(&skipBL),
			huh.NewConfirm().
				Title("Fan Out (parallel suites)").
				Description("Run scenarios in parallel (--fan-out flag).").
				Value(&fanOut),
		),
	).WithShowHelp(true).WithHeight(18)

	m.probeCustomRunForm = m.applyModalForm(form)
	return m.probeCustomRunForm.Init()
}

// closeProbeCustomRunForm nils the form and all bound field pointers.
func (m *Model) closeProbeCustomRunForm() {
	m.probeCustomRunForm = nil
	m.probeCustomRunScenario = nil
	m.probeCustomRunSuite = nil
	m.probeCustomRunTrials = nil
	m.probeCustomRunConcurrency = nil
	m.probeCustomRunMaxTurns = nil
	m.probeCustomRunEnv = nil
	m.probeCustomRunSkipBL = nil
	m.probeCustomRunFanOut = nil
}

// assembleCustomRunArgs builds RunArgs from the bound custom run form fields.
func (m *Model) assembleCustomRunArgs() (probe.RunArgs, error) {
	scenario, suite, trials, concurrency, maxTurns, env := "", "", "", "", "", ""
	skipBL, fanOut := false, false

	if m.probeCustomRunScenario != nil {
		scenario = *m.probeCustomRunScenario
	}
	if m.probeCustomRunSuite != nil {
		suite = *m.probeCustomRunSuite
	}
	if m.probeCustomRunTrials != nil {
		trials = *m.probeCustomRunTrials
	}
	if m.probeCustomRunConcurrency != nil {
		concurrency = *m.probeCustomRunConcurrency
	}
	if m.probeCustomRunMaxTurns != nil {
		maxTurns = *m.probeCustomRunMaxTurns
	}
	if m.probeCustomRunEnv != nil {
		env = *m.probeCustomRunEnv
	}
	if env == probePickerEnvDefault {
		env = ""
	}
	if m.probeCustomRunSkipBL != nil {
		skipBL = *m.probeCustomRunSkipBL
	}
	if m.probeCustomRunFanOut != nil {
		fanOut = *m.probeCustomRunFanOut
	}
	return buildCustomRunArgsFromForm(scenario, suite, trials, concurrency, maxTurns, env, skipBL, fanOut)
}

// updateProbeCustomRun forwards msg to the open custom run form and handles
// completion / abort.
func (m *Model) updateProbeCustomRun(msg tea.Msg) tea.Cmd {
	if m.probeCustomRunForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.probeCustomRunForm, cmd = stepForm(m.probeCustomRunForm, msg)

	switch m.probeCustomRunForm.State {
	case huh.StateCompleted:
		args, err := m.assembleCustomRunArgs()
		m.closeProbeCustomRunForm()
		if err != nil {
			m.probeStatusMsg = "Invalid input: " + err.Error()
			return nil
		}
		return func() tea.Msg { return probeStartRunMsg{args: args} }
	case huh.StateAborted:
		m.closeProbeCustomRunForm()
	}
	return cmd
}

// renderProbeCustomRun renders the open custom run form inside a settings box.
func (m Model) renderProbeCustomRun() string {
	if m.probeCustomRunForm == nil {
		return ""
	}
	return settingsBoxStyle.Render(m.probeCustomRunForm.View())
}

// =============================================================================
// Env Edit Form
// =============================================================================

// probeEnvEditActive reports whether the env edit form is open.
func (m Model) probeEnvEditActive() bool {
	return m.probeEnvEditForm != nil
}

// openProbeEnvEditInputForm opens a single-field Input modal for editing an env
// value. onComplete is called with the new value when the form completes.
func (m *Model) openProbeEnvEditInputForm(key, currentValue string, onComplete func(string) error) tea.Cmd {
	value := currentValue
	m.probeEnvEditValue = &value
	m.probeEnvEditOnComplete = onComplete

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title(fmt.Sprintf("Edit %s", key)).
				Description("Enter new value.").
				Value(&value),
		),
	).WithShowHelp(true).WithHeight(8)

	m.probeEnvEditForm = m.applyModalForm(form)
	return m.probeEnvEditForm.Init()
}

// openProbeEnvSwitchForm opens a single-field Select modal for choosing a GD_ENV value.
func (m *Model) openProbeEnvSwitchForm(onComplete func(string) error) tea.Cmd {
	value := "local.dev"
	m.probeEnvEditValue = &value
	m.probeEnvEditOnComplete = onComplete

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Switch Environment").
				Description("Select a GD_ENV to write to .env.").
				Options(huhStringOptions([]string{"local.dev", "local.test", "local.prod"})...).
				Value(&value),
		),
	).WithShowHelp(true).WithHeight(8)

	m.probeEnvEditForm = m.applyModalForm(form)
	return m.probeEnvEditForm.Init()
}

// closeProbeEnvEditForm nils the form and bound pointers.
func (m *Model) closeProbeEnvEditForm() {
	m.probeEnvEditForm = nil
	m.probeEnvEditValue = nil
	m.probeEnvEditOnComplete = nil
}

// updateProbeEnvEdit forwards msg to the open env edit form and handles
// completion / abort. On completion, calls onComplete then shows status.
func (m *Model) updateProbeEnvEdit(msg tea.Msg) tea.Cmd {
	if m.probeEnvEditForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.probeEnvEditForm, cmd = stepForm(m.probeEnvEditForm, msg)

	switch m.probeEnvEditForm.State {
	case huh.StateCompleted:
		value := ""
		if m.probeEnvEditValue != nil {
			value = *m.probeEnvEditValue
		}
		onComplete := m.probeEnvEditOnComplete
		m.closeProbeEnvEditForm()
		if onComplete != nil {
			if err := onComplete(value); err != nil {
				m.probeStatusMsg = fmt.Sprintf("Write failed: %v", err)
			} else {
				m.probeStatusMsg = "Saved."
			}
		}
	case huh.StateAborted:
		m.closeProbeEnvEditForm()
	}
	return cmd
}

// renderProbeEnvEdit renders the open env edit form inside a settings box.
func (m Model) renderProbeEnvEdit() string {
	if m.probeEnvEditForm == nil {
		return ""
	}
	return settingsBoxStyle.Render(m.probeEnvEditForm.View())
}

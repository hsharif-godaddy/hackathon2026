package tui

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/probe"
	"github.com/airo-ai-builder/dev-runner/internal/process"
)

// ringBellCmd returns a Cmd that asynchronously writes BEL to stderr.
// Running this async (rather than inline in Update) avoids interleaving
// with Bubble Tea's stdout renderer.
func ringBellCmd() tea.Cmd {
	return func() tea.Msg {
		fmt.Fprint(os.Stderr, "\a")
		return nil
	}
}

// shutdownCmd cancels hooks, waits for them to exit, stops all processes, then quits.
func (m *Model) shutdownCmd() tea.Cmd {
	if m.hookCancel != nil {
		m.hookCancel()
	}
	hookDone := m.hookDone
	mgr := m.manager
	e2eRunner := m.e2eRunner
	probeRunner := m.probeRunner
	return func() tea.Msg {
		// Wait for hook goroutine to finish (it will be killed by context cancel)
		if hookDone != nil {
			<-hookDone
		}
		e2eRunner.Stop()
		probeRunner.Stop()
		mgr.StopAll()
		return tea.QuitMsg{}
	}
}

// fixerExecCmd wraps a Fixer.Fix() call as a tea.ExecCommand so the TUI
// can suspend itself and give the fixer full terminal access (for sudo, etc.).
type fixerExecCmd struct {
	fixer       preflight.Fixer
	ctx         context.Context
	projectRoot string
	err         error
}

func (f *fixerExecCmd) Run() error {
	f.err = f.fixer.Fix(f.ctx, f.projectRoot)
	return f.err
}

func (f *fixerExecCmd) SetStdin(r io.Reader)  {}
func (f *fixerExecCmd) SetStdout(w io.Writer) {}
func (f *fixerExecCmd) SetStderr(w io.Writer) {}

// runNextFixer starts the next fixer in the fix queue.
// EnvFixers that need user input pause to show an inline form first.
// TerminalFixers suspend the TUI for full terminal access (sudo prompts).
// All other fixers run in a background goroutine.
func (m *Model) runNextFixer() tea.Cmd {
	if m.preflightFixIndex >= len(m.preflightFixQueue) {
		return nil
	}
	cwf := m.preflightFixQueue[m.preflightFixIndex]
	name := cwf.Check.Name()
	m.preflightFixStatus = "Fixing: " + name + "..."
	fixer := cwf.Fixer
	projectRoot := m.projectRoot

	// FormFixer with fields — pause and show inline form
	if ff, ok := fixer.(preflight.FormFixer); ok && len(ff.FormFields()) > 0 {
		m.initFixerForm(ff)
		m.phase = PhasePreflightEnvForm
		return m.envFormInit()
	}

	// TerminalFixer — suspend TUI so stdin reaches the subprocess (sudo, etc.)
	if tf, ok := fixer.(preflight.TerminalFixer); ok && tf.NeedsTerminal() {
		cmd := &fixerExecCmd{fixer: fixer, ctx: context.Background(), projectRoot: projectRoot}
		return tea.Exec(cmd, func(err error) tea.Msg {
			// Prefer the fixer's own error over the exec wrapper error
			if cmd.err != nil {
				err = cmd.err
			}
			return preflightFixDoneMsg{Err: err, FixerName: name}
		})
	}

	// All other fixers run in a goroutine
	return func() tea.Msg {
		err := fixer.Fix(context.Background(), projectRoot)
		return preflightFixDoneMsg{Err: err, FixerName: name}
	}
}

// Update handles all Bubble Tea messages.
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.help.SetWidth(msg.Width)
		m.ready = true
		m.resizePanes()
		m.refreshPanes()
		m.refreshPreflightViewport()
		m.refreshHookViewport()
		m.refreshPrewarmViewport()
		m.resizeForms()
		m.fixProgress.SetWidth(max(min(msg.Width-10, 60), 1))
		return m, nil

	case spinner.TickMsg:
		if m.phase == PhasePreflightChecking || m.phase == PhasePreflightFixing || m.phase == PhasePreflightVerifying ||
			m.phase == PhasePreflightCleaning ||
			m.e2ePickerStep == E2EPickerStepLoading || m.probeDiscoveryLoading ||
			m.prewarmRunning {
			var cmd tea.Cmd
			m.spinner, cmd = m.spinner.Update(msg)
			cmds = append(cmds, cmd)
		}

	case tea.KeyPressMsg:
		cmd := m.handleKey(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		if m.quitting {
			return m, tea.Batch(cmds...)
		}

	case tea.PasteMsg, tea.PasteStartMsg, tea.PasteEndMsg:
		if cmd := m.forwardToActiveForm(msg); cmd != nil {
			cmds = append(cmds, cmd)
		}

	case preflightAllChecksDoneMsg:
		m.preflightResults = msg.Results
		if preflight.HasIssues(msg.Results) {
			// Failures or warnings — pause for user to review
			m.phase = PhasePreflightDashboard
		} else {
			// All pass — show briefly then auto-advance
			m.phase = PhasePreflightDashboard
			cmds = append(cmds, tea.Tick(1*time.Second, func(_ time.Time) tea.Msg {
				return preflightAutoAdvanceMsg{}
			}))
		}

	case preflightAutoAdvanceMsg:
		if m.phase == PhasePreflightDashboard && !preflight.HasIssues(m.preflightResults) {
			m.phase = PhaseHooks
			m.hookRunning = true
			ctx, cancel := context.WithCancel(context.Background())
			m.hookCancel = cancel
			hookCmd, hookDone := startHookRun(ctx, m.projectRoot, m.config.Hooks.PreStart)
			m.hookDone = hookDone
			cmds = append(cmds, hookCmd)
		}

	case cleanPickerOpenMsg:
		// Init() emits this when starting in PhasePreflightCleanPicker.
		// Mutations on the picker form must happen here, where m is mutable.
		if m.phase == PhasePreflightCleanPicker {
			cmds = append(cmds, m.initCleanPicker())
		}

	case prewarmLineMsg:
		// Live progress: append the streamed line, refresh the scrollable tail
		// (auto-follows to the bottom), and keep listening.
		m.prewarmOutput += string(msg) + "\n"
		m.refreshPrewarmViewport()
		cmds = append(cmds, waitForPrewarm(m.prewarmCh))

	case prewarmDoneMsg:
		m.prewarmRunning = false
		m.prewarmErr = msg.Err
		m.prewarmCh = nil
		if msg.Err == nil {
			// Success: clear overlay immediately.
			m.prewarmOutput = ""
		} else {
			// Failure: keep the overlay and lay out the final tail at the
			// current size so the user can scroll the full, un-truncated log.
			m.refreshPrewarmViewport()
		}

	case cleanDoneMsg:
		m.cleanRunning = false
		m.cleanOutput = msg.Output
		m.cleanErr = msg.Err
		// On error, stay on PhasePreflightCleaning so the user sees the
		// failure (renderCleaning surfaces it). The cleaning-phase key
		// handler advances on Enter or quits on q. Auto-advancing here
		// would silently move past a failed/partial clean and then the
		// failure would be invisible — preflight checks tooling/env, not
		// delete success, so a permission-denied RemoveAll or non-zero
		// `make clean` would never resurface.
		if msg.Err == nil {
			cmds = append(cmds, m.advancePastClean())
		}

	case preflightFixDoneMsg:
		if msg.Err != nil {
			m.preflightFixStatus = fmt.Sprintf("Fix failed: %v", msg.Err)
			// Stash by check name so the dashboard can surface it next render
			// (preflightFixStatus is overwritten by the next fixer's "Fixing: ..."
			// line and is gone by the time we reach PhasePreflightDashboard).
			m.preflightFixErrors[msg.FixerName] = msg.Err
		} else {
			delete(m.preflightFixErrors, msg.FixerName)
		}
		// Always advance to avoid retrying the same fixer in a loop
		// (e.g., SSO device flow repeatedly opening browser tabs).
		m.preflightFixIndex++

		if m.preflightFixIndex >= len(m.preflightFixQueue) {
			// All fixes attempted — re-run ALL checks since fixes may
			// unlock previously-skipped checks (e.g., creating .env files
			// enables S2S certs, Commerce OAuth, etc.)
			m.phase = PhasePreflightVerifying
			runner := m.preflightRunner
			projectRoot := m.projectRoot
			cmds = append(cmds, m.spinner.Tick, func() tea.Msg {
				results := runner.RunAll(context.Background(), projectRoot)
				return preflightVerifyDoneMsg{Results: results}
			})
		} else {
			// Run next fixer
			cmds = append(cmds, m.runNextFixer())
		}

	case preflightVerifyDoneMsg:
		// Replace all results with fresh check results
		m.preflightResults = msg.Results

		// Drop fix errors for any check that no longer fails — Pass means
		// the issue is resolved; Warn/Skip mean the fix accomplished what
		// it could and the original failure context is no longer
		// meaningful. Only retain errors for checks that are still failing.
		for _, r := range m.preflightResults {
			if r.Status != preflight.StatusFail {
				delete(m.preflightFixErrors, r.Name)
			}
		}

		if preflight.HasIssues(m.preflightResults) {
			// Still has failures or warnings — pause for review
			m.phase = PhasePreflightDashboard
		} else {
			m.phase = PhasePreflightDashboard
			cmds = append(cmds, tea.Tick(1*time.Second, func(_ time.Time) tea.Msg {
				return preflightAutoAdvanceMsg{}
			}))
		}

	case hookOutputMsg:
		m.hookOutput = append(m.hookOutput, msg.Output)
		m.refreshHookViewport()
		// Re-subscribe to get the next hook output message
		cmds = append(cmds, waitForHookEvent(msg.outputCh, msg.doneCh))

	case hooksCompleteMsg:
		m.hookRunning = false
		m.hookErr = msg.Err
		m.refreshHookViewport()
		if msg.Err == nil {
			m.phase = PhaseRunning
			m.manager.StartAll()
			cmds = append(cmds, m.scheduleHealthChecks())
			// Start the recurring fault poll only if one isn't already running,
			// so a restart (this fires again) doesn't add a second chain.
			if !m.faultPollScheduled {
				m.faultPollScheduled = true
				cmds = append(cmds, scheduleFaultPoll())
			}
		}

	case healthCheckMsg:
		// Discard results from a previous generation (before restart)
		if msg.Index < 0 || msg.Index >= len(m.manager.Processes) {
			break
		}
		if msg.Generation != m.healthGeneration[msg.Index] {
			break
		}
		healthy := msg.Healthy
		m.manager.Processes[msg.Index].Healthy = &healthy
		hc := m.config.Processes[msg.Index].HealthCheck
		if hc != nil {
			idx := msg.Index
			gen := m.healthGeneration[msg.Index]
			interval := hc.UnhealthyInterval
			if healthy {
				interval = hc.HealthyInterval
			}
			cmds = append(cmds, tea.Tick(interval, func(_ time.Time) tea.Msg {
				return healthCheckCmd(idx, hc, gen)()
			}))
		}
		if m.prewarmOnHealthy != nil && !m.prewarmAutoFired && m.allHealthCheckedHealthy() {
			m.prewarmAutoFired = true
			cmds = append(cmds, m.runPrewarm(*m.prewarmOnHealthy))
		}

	case tickMsg:
		m.blinkOn = !m.blinkOn
		m.refreshPanes()
		// Invalidate discovery cache when a probe run completes (Running → Stopped/Errored).
		currentProbeState := m.probeRunner.GetState()
		if m.probePrevState == probe.StateRunning &&
			(currentProbeState == probe.StateStopped || currentProbeState == probe.StateErrored) {
			m.discoveryCache.Invalidate()
		}
		m.probePrevState = currentProbeState
		// Check for new errors and ring bell
		for i, p := range m.manager.Processes {
			current := p.ErrorCount
			if current > m.lastErrorCount[i] && m.bellAllowed {
				m.bellAllowed = false
				cmds = append(cmds,
					ringBellCmd(),
					tea.Tick(process.DefaultBellDebounce, func(time.Time) tea.Msg {
						return bellResetMsg{}
					}),
				)
			}
			m.lastErrorCount[i] = current
		}
		cmds = append(cmds, m.tickCmd())

	case bellResetMsg:
		m.bellAllowed = true

	case devSettingsPresetMsg:
		if msg.Err == nil {
			m.devSettingsPreset = msg.Preset
		} else {
			m.devSettingsError = fmt.Sprintf("Failed to apply preset: %v", msg.Err)
			cmds = append(cmds, m.openDevSettings(), tea.Tick(5*time.Second, func(_ time.Time) tea.Msg {
				return devSettingsErrorClearMsg{}
			}))
		}

	case devSettingsErrorClearMsg:
		m.devSettingsError = ""

	case e2eListLoadedMsg:
		if cmd := m.transitionToTestList(msg); cmd != nil {
			cmds = append(cmds, cmd)
		}

	case probeStartRunMsg:
		if cmd := m.startProbeRun(msg.args); cmd != nil {
			cmds = append(cmds, cmd)
		}

	case probeBaselineCheckResultMsg:
		if msg.err != nil {
			m.probeStatusMsg = fmt.Sprintf("Baseline check failed: %v", msg.err)
		} else if !msg.has {
			m.probeStatusMsg = "No " + msg.suite + " baseline — run option 1 on main branch first."
		} else {
			m.probeStatusMsg = ""
			if cmd := m.startProbeRun(probe.RunArgs{
				Command:        probe.CmdEval,
				Target:         probe.SuiteTarget{Name: msg.suite},
				Trials:         3,
				ParallelSuites: true,
				SkipBaseline:   false,
			}); cmd != nil {
				cmds = append(cmds, cmd)
			}
		}

	case probeDiscoveryLoadingMsg:
		m.probeDiscoveryLoading = true

	case probeDiscoverySuitesResultMsg:
		m.probeDiscoveryLoading = false
		if msg.err != nil {
			m.probeStatusMsg = fmt.Sprintf("Failed to load suites: %v", msg.err)
		} else if len(msg.suites) == 0 {
			m.probeStatusMsg = "No suites found."
		} else {
			m.probeMenu.Push(buildSuiteMenuItems(msg.suites))
		}

	case probeDiscoveryScenariosResultMsg:
		m.probeDiscoveryLoading = false
		if msg.err != nil {
			m.probeStatusMsg = fmt.Sprintf("Failed to load scenarios: %v", msg.err)
		} else if len(msg.scenarios) == 0 {
			m.probeStatusMsg = "No scenarios found."
		} else {
			m.probeMenu.Push(buildScenarioMenuItems(msg.scenarios))
		}

	case probeDirectRunsResultMsg:
		m.probeMenu.Push(buildDirectRunMenuItems(m.probeRunner.ProbeDir, msg.runs))

	case probeOpenPickerMsg:
		var cmd tea.Cmd
		if msg.graduate {
			cmd = m.openProbeGraduatePicker(msg.baseArgs)
		} else {
			cmd = m.openProbeRunPicker(msg.baseArgs)
		}
		if cmd != nil {
			cmds = append(cmds, cmd)
		}

	case probeShowViewMsg:
		m.probeDiscoveryLoading = false
		m.probeShowingView = true
		m.probeViewContent = msg.content
		m.probeViewViewport.SetContent(msg.content)
		m.probeViewViewport.GotoTop()

	case probeGraduateScenariosResultMsg:
		m.probeDiscoveryLoading = false
		if msg.err != nil {
			m.probeStatusMsg = fmt.Sprintf("Failed to load scenarios: %v", msg.err)
		} else if len(msg.scenarios) == 0 {
			m.probeStatusMsg = "No scenarios found."
		} else {
			m.probeMenu.Push(buildGraduateScenarioMenuItems(msg.scenarios))
		}

	case probeGraduateSuitesResultMsg:
		m.probeDiscoveryLoading = false
		if msg.err != nil {
			m.probeStatusMsg = fmt.Sprintf("Failed to load suites: %v", msg.err)
		} else if len(msg.suites) == 0 {
			m.probeStatusMsg = "No suites found."
		} else {
			m.probeMenu.Push(buildGraduateSuiteMenuItems(msg.suites))
		}

	case probeOpenCustomRunMsg:
		if cmd := m.openProbeCustomRunForm(); cmd != nil {
			cmds = append(cmds, cmd)
		}

	case probeEnvKeysLoadedMsg:
		m.probeDiscoveryLoading = false
		if msg.err != nil {
			m.probeStatusMsg = fmt.Sprintf("Error reading .env: %v", msg.err)
		} else {
			items := buildEnvKeyMenuItems(msg.lines, msg.envPath)
			if len(items) == 0 {
				m.probeStatusMsg = ".env has no key=value entries."
			} else {
				m.probeMenu.Push(items)
			}
		}

	case probeOpenEnvEditMsg:
		path := msg.envPath
		key := msg.key
		cmd := m.openProbeEnvEditInputForm(msg.key, msg.currentValue, func(newValue string) error {
			return probe.UpdateEnvFile(path, key, newValue)
		})
		if cmd != nil {
			cmds = append(cmds, cmd)
		}

	case probeOpenEnvSwitchMsg:
		path := msg.envPath
		cmd := m.openProbeEnvSwitchForm(func(newValue string) error {
			return probe.UpdateEnvFile(path, "GD_ENV", newValue)
		})
		if cmd != nil {
			cmds = append(cmds, cmd)
		}

	case faultActionDoneMsg:
		if msg.err != nil {
			m.faultActionErr = msg.err.Error()
		} else {
			m.faultActionErr = ""
		}
		// One-shot poll (scheduled=false) so the indicator reflects the new arm
		// state promptly without forking a second recurring chain.
		cmds = append(cmds, pollFaultStateCmd())

	case faultStatePolledMsg:
		m.faultState = msg.status
		// Only the recurring tick re-arms; a one-shot poll must not, or it would
		// fork a parallel chain. Let the chain lapse when not running.
		if msg.scheduled {
			if m.phase == PhaseRunning {
				cmds = append(cmds, scheduleFaultPoll())
			} else {
				m.faultPollScheduled = false
			}
		}

	case clickHintMsg:
		m.clickHint = false

	case tea.MouseClickMsg:
		if !m.clickHint {
			m.clickHint = true
			cmds = append(cmds, tea.Tick(2500*time.Millisecond, func(_ time.Time) tea.Msg {
				return clickHintMsg{}
			}))
		}

	case tea.MouseWheelMsg:
		if m.phase >= PhasePreflightChecking && m.phase <= PhasePreflightCleaning {
			switch msg.Button {
			case tea.MouseWheelUp:
				m.preflightAutoFollow = false
				m.preflightViewport.ScrollUp(3)
			case tea.MouseWheelDown:
				m.preflightViewport.ScrollDown(3)
				if m.preflightViewport.AtBottom() {
					m.preflightAutoFollow = true
				}
			}
		} else if m.phase == PhaseHooks {
			switch msg.Button {
			case tea.MouseWheelUp:
				m.hookAutoFollow = false
				m.hookViewport.ScrollUp(3)
			case tea.MouseWheelDown:
				m.hookViewport.ScrollDown(3)
				if m.hookViewport.AtBottom() {
					m.hookAutoFollow = true
				}
			}
		} else if m.activeTab == m.probeTabIndex() && m.probeShowingView {
			switch msg.Button {
			case tea.MouseWheelUp:
				m.probeViewViewport.ScrollUp(3)
			case tea.MouseWheelDown:
				m.probeViewViewport.ScrollDown(3)
			}
		} else {
			pane := m.activePanePtr()
			if pane != nil {
				switch msg.Button {
				case tea.MouseWheelUp:
					pane.AutoFollow = false
					pane.Viewport.ScrollUp(3)
				case tea.MouseWheelDown:
					pane.Viewport.ScrollDown(3)
					if pane.Viewport.AtBottom() {
						pane.AutoFollow = true
					}
				}
			}
		}

	default:
		// huh drives its state machine via internal messages (nextFieldMsg,
		// nextGroupMsg, etc.) emitted as tea.Cmds. Forward anything we don't
		// otherwise consume so the active form can advance to StateCompleted
		// when the user presses Enter.
		if cmd := m.forwardToActiveForm(msg); cmd != nil {
			cmds = append(cmds, cmd)
		}
	}

	// Forward to active viewport for keyboard scrolling
	if m.ready && !m.anyModalOpen() && !m.searchOpen && m.phase == PhaseRunning {
		pane := m.activePanePtr()
		if pane != nil {
			prevOffset := pane.Viewport.YOffset()
			vp, cmd := pane.Viewport.Update(msg)
			pane.Viewport = vp
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Auto-disable follow on scroll up, re-enable at bottom
			if vp.YOffset() < prevOffset {
				pane.AutoFollow = false
			}
			if vp.AtBottom() && vp.YOffset() != prevOffset {
				pane.AutoFollow = true
			}
		}
	}

	// Keep preflight viewport in sync with current phase content
	if m.phase >= PhasePreflightChecking && m.phase <= PhasePreflightCleaning {
		m.refreshPreflightViewport()
	}

	return m, tea.Batch(cmds...)
}

func (m *Model) handleKey(msg tea.KeyPressMsg) tea.Cmd {
	// Always quit on ctrl+c, regardless of state
	if msg.String() == "ctrl+c" {
		if m.quitting {
			return tea.Quit
		}
		m.quitting = true
		return m.shutdownCmd()
	}

	if m.quitConfirmForm != nil {
		return m.updateQuitConfirm(msg)
	}

	if m.searchOpen {
		return m.handleSearchKey(msg)
	}

	if m.settingsForm != nil {
		return m.updateSettings(msg)
	}

	// Preflight phase key handling
	if m.phase == PhasePreflightDashboard {
		switch {
		case key.Matches(msg, m.preflightKeys.Fix):
			fixable := m.preflightRunner.FixableChecks(m.preflightResults)
			if len(fixable) > 0 {
				m.phase = PhasePreflightSelectFixes
				return m.initFixSelector(fixable)
			}
			if !preflight.HasFailures(m.preflightResults) {
				m.phase = PhaseHooks
				m.hookRunning = true
				ctx, cancel := context.WithCancel(context.Background())
				m.hookCancel = cancel
				hookCmd, hookDone := startHookRun(ctx, m.projectRoot, m.config.Hooks.PreStart)
				m.hookDone = hookDone
				return hookCmd
			}
		case key.Matches(msg, m.preflightKeys.Skip):
			if !preflight.HasUnfixableFailures(m.preflightResults) {
				m.phase = PhaseHooks
				m.hookRunning = true
				ctx, cancel := context.WithCancel(context.Background())
				m.hookCancel = cancel
				hookCmd, hookDone := startHookRun(ctx, m.projectRoot, m.config.Hooks.PreStart)
				m.hookDone = hookDone
				return hookCmd
			}
		case key.Matches(msg, m.preflightKeys.Expand):
			m.preflightExpandPassing = !m.preflightExpandPassing
			m.refreshPreflightViewport()
			return nil
		case key.Matches(msg, m.preflightKeys.Clean):
			m.cleanPickerReturnPhase = PhasePreflightDashboard
			m.phase = PhasePreflightCleanPicker
			return m.initCleanPicker()
		case key.Matches(msg, m.preflightKeys.Mouse):
			m.mouseEnabled = !m.mouseEnabled
			return nil
		case key.Matches(msg, m.preflightKeys.Quit):
			m.quitting = true
			return tea.Quit
		}
		return nil
	}

	if m.phase == PhasePreflightSelectFixes {
		if key.Matches(msg, m.preflightKeys.Quit) {
			m.quitting = true
			return tea.Quit
		}
		// Intercept 'm' before the huh form sees it so users can release
		// mouse capture mid-selection — same as the dashboard and clean
		// phases.
		if key.Matches(msg, m.preflightKeys.Mouse) {
			m.mouseEnabled = !m.mouseEnabled
			return nil
		}
		return m.updateFixSelector(msg)
	}

	if m.phase == PhasePreflightCleaning {
		// 'm' toggles mouse capture in any state — including mid-clean — so
		// the user can prepare to copy any errors that surface when cleaning
		// finishes.
		if key.Matches(msg, m.preflightKeys.Mouse) {
			m.mouseEnabled = !m.mouseEnabled
			return nil
		}
		// While cleaning is in flight, swallow keys so the user can't
		// abandon mid-removal. Once cleaning finishes with an error,
		// renderCleaning shows the failure and waits for the user:
		// Enter usually advances into preflight, q quits.
		if m.cleanRunning {
			return nil
		}
		switch {
		case key.Matches(msg, m.preflightKeys.Quit):
			m.quitting = true
			return tea.Quit
		case msg.String() == "enter":
			// `dev-runner clean` (interactive, cleanOnly): user is done,
			// quit. No dev session to advance to either way.
			if m.cleanOnly {
				m.quitting = true
				return tea.Quit
			}
			// All other origins (dashboard, --clean / --clean-all
			// startup, settings → "Clean + Restart") advance through
			// preflight on Enter regardless of clean success. From
			// settings the picker confirm already stopped the running
			// processes, so there's no healthy environment left to
			// preserve — advancePastClean re-runs preflight + hooks
			// + restart.
			return m.advancePastClean()
		}
		return nil
	}

	if m.phase == PhasePreflightCleanPicker {
		if key.Matches(msg, m.preflightKeys.Quit) {
			m.quitting = true
			return tea.Quit
		}
		// Intercept 'm' before the huh form sees it, so it can't be confused
		// with a printable character inside any text input field that ships
		// with the picker in the future.
		if key.Matches(msg, m.preflightKeys.Mouse) {
			m.mouseEnabled = !m.mouseEnabled
			return nil
		}
		return m.updateCleanPicker(msg)
	}

	if m.phase == PhasePreflightEnvForm {
		return m.updateEnvForm(msg)
	}

	if m.phase < PhaseHooks {
		return nil
	}

	if m.phase == PhaseHooks {
		return nil
	}

	if m.devSettingsForm != nil {
		return m.updateDevSettings(msg)
	}

	if m.e2ePickerError != "" {
		// Any key dismisses the error overlay.
		m.e2ePickerError = ""
		return nil
	}

	if m.e2ePickerStep != E2EPickerInactive {
		// Esc on any picker step (including loading) cancels the flow.
		if msg.String() == "esc" {
			m.closeE2EPicker()
			return nil
		}
		return m.updateE2EPicker(msg)
	}

	// Probe picker intercepts ALL keys when open (mirrors e2e picker pattern).
	if m.probePickerForm != nil {
		return m.updateProbePicker(msg)
	}
	if m.probeCustomRunForm != nil {
		return m.updateProbeCustomRun(msg)
	}
	if m.probeEnvEditForm != nil {
		return m.updateProbeEnvEdit(msg)
	}

	// Fault picker intercepts all keys while open.
	if m.faultPickerForm != nil {
		return m.updateFaultPicker(msg)
	}

	// Prewarm picker intercepts all keys while open.
	if m.prewarmPickerForm != nil {
		return m.updatePrewarmPicker(msg)
	}
	// While prewarm is running, the only interaction is scrolling the
	// streamed-output tail; everything else is swallowed.
	if m.prewarmRunning {
		return m.scrollPrewarmViewport(msg)
	}
	// After a prewarm failure, Enter/Esc dismisses the result overlay and
	// scroll keys page through the captured log.
	if m.prewarmErr != nil {
		if msg.String() == "enter" || msg.String() == "esc" {
			m.prewarmErr = nil
			m.prewarmOutput = ""
			return nil
		}
		return m.scrollPrewarmViewport(msg)
	}

	// When the Probe tab is active and the runner is idle, keys are handled by
	// the view-content display or the navigation menu.
	// Tab/ShiftTab are excluded so they always reach the tab-cycling handler.
	// Global shortcuts (m/d/s) are also excluded so they reach the main handler.
	if m.activeTab == m.probeTabIndex() && m.probeRunner.GetState() == probe.StateIdle &&
		!key.Matches(msg, m.keys.Tab) && !key.Matches(msg, m.keys.ShiftTab) &&
		!key.Matches(msg, m.keys.Mouse) && !key.Matches(msg, m.keys.DevSetting) &&
		!key.Matches(msg, m.keys.Settings) && !key.Matches(msg, m.keys.Inject) {
		// Esc exits the "View Scenarios" display back to the menu.
		if m.probeShowingView && msg.String() == "esc" {
			m.probeShowingView = false
			m.probeViewContent = ""
			return nil
		}
		// Forward keys to the scrollable viewport when showing view content.
		if m.probeShowingView {
			vp, cmd := m.probeViewViewport.Update(msg)
			m.probeViewViewport = vp
			return cmd
		}
		// Absorb keys while discovery is loading to prevent spurious menu actions.
		if m.probeDiscoveryLoading {
			return nil
		}
		var cmd tea.Cmd
		m.probeMenu, cmd = m.probeMenu.Update(msg)
		return cmd
	}

	// Probe tab Esc: first Esc stops a running eval; second Esc returns to menu.
	if m.activeTab == m.probeTabIndex() && msg.String() == "esc" {
		switch m.probeRunner.GetState() {
		case probe.StateRunning:
			return m.stopProbeRun()
		case probe.StateStopped, probe.StateErrored:
			m.probeRunner.Reset()
			return nil
		}
	}

	switch {
	case key.Matches(msg, m.keys.Quit):
		return m.openQuitConfirm()
	case key.Matches(msg, m.keys.ClearErr):
		for _, p := range m.manager.Processes {
			p.ClearErrors()
		}
	case key.Matches(msg, m.keys.Tab):
		m.activeTab = (m.activeTab + 1) % m.tabCount()
		m.resizePanes()
		m.refreshPanes()
	case key.Matches(msg, m.keys.ShiftTab):
		m.activeTab--
		if m.activeTab < 0 {
			m.activeTab = m.tabCount() - 1
		}
		m.resizePanes()
		m.refreshPanes()
	case key.Matches(msg, m.keys.All):
		m.activeTab = 0
		m.resizePanes()
		m.refreshPanes()
	case key.Matches(msg, m.keys.Proc1):
		if m.processCount() >= 1 {
			m.activeTab = 1
			m.resizePanes()
			m.refreshPanes()
		}
	case key.Matches(msg, m.keys.Proc2):
		if m.processCount() >= 2 {
			m.activeTab = 2
			m.resizePanes()
			m.refreshPanes()
		}
	case key.Matches(msg, m.keys.Proc3):
		if m.processCount() >= 3 {
			m.activeTab = 3
			m.resizePanes()
			m.refreshPanes()
		}
	case key.Matches(msg, m.keys.DevSetting):
		if m.authType == "jwt" {
			return nil
		}
		return m.openDevSettings()
	case key.Matches(msg, m.keys.Mouse):
		m.mouseEnabled = !m.mouseEnabled
	case key.Matches(msg, m.keys.Settings):
		return m.openSettings()
	case key.Matches(msg, m.keys.Prewarm):
		if m.phase == PhaseRunning {
			return m.openPrewarmPicker()
		}
	case key.Matches(msg, m.keys.Inject):
		if m.phase == PhaseRunning && m.activeTab == m.llmProxyTabIndex() {
			return m.openFaultPicker()
		}
	case key.Matches(msg, m.keys.Follow):
		pane := m.activePanePtr()
		if pane != nil {
			pane.AutoFollow = !pane.AutoFollow
			if pane.AutoFollow {
				pane.Viewport.GotoBottom()
			}
		}
	case key.Matches(msg, m.keys.Top):
		pane := m.activePanePtr()
		if pane != nil {
			pane.Viewport.GotoTop()
			pane.AutoFollow = false
		}
	case key.Matches(msg, m.keys.Bottom):
		pane := m.activePanePtr()
		if pane != nil {
			pane.Viewport.GotoBottom()
			pane.AutoFollow = true
		}
	case key.Matches(msg, m.keys.Search):
		if m.activeTab != 0 {
			m.searchOpen = true
			m.searchInput.Reset()
			m.searchInput.Focus()
			m.resizePanes()
		}
		return nil
	case key.Matches(msg, m.keys.NextMatch):
		pane := m.activePanePtr()
		if pane != nil && pane.searchQuery != "" {
			pane.NextMatch()
		}
	case key.Matches(msg, m.keys.PrevMatch):
		pane := m.activePanePtr()
		if pane != nil && pane.searchQuery != "" {
			pane.PrevMatch()
		}
	}

	return nil
}

func (m *Model) handleSearchKey(msg tea.KeyPressMsg) tea.Cmd {
	switch {
	case key.Matches(msg, m.searchKeys.Close):
		m.searchOpen = false
		m.searchInput.Blur()
		m.resizePanes()
		return nil
	case key.Matches(msg, m.searchKeys.Confirm), key.Matches(msg, m.searchKeys.Next):
		pane := m.activePanePtr()
		if pane != nil {
			pane.NextMatch()
		}
		return nil
	case key.Matches(msg, m.searchKeys.Prev):
		pane := m.activePanePtr()
		if pane != nil {
			pane.PrevMatch()
		}
		return nil
	}

	var cmd tea.Cmd
	m.searchInput, cmd = m.searchInput.Update(msg)

	query := m.searchInput.Value()
	switch {
	case m.activeTab == 0:
		for i := range m.panes {
			m.panes[i].SetSearch(query)
		}
		m.e2ePane.SetSearch(query)
		m.probePane.SetSearch(query)
	case m.activeTab == m.e2eTabIndex():
		m.e2ePane.SetSearch(query)
	case m.activeTab == m.probeTabIndex():
		m.probePane.SetSearch(query)
	default:
		idx := m.activeTab - 1
		if idx >= 0 && idx < len(m.panes) {
			m.panes[idx].SetSearch(query)
		}
	}
	m.refreshPanes()

	return cmd
}

func (m *Model) executeSettingsAction(idx int) tea.Cmd {
	if idx < 0 || idx >= len(m.settingsItems) {
		return nil
	}
	item := m.settingsItems[idx]

	switch item.Action {
	case ActionRestartAll:
		m.phase = PhaseHooks
		m.hookRunning = true
		m.hookOutput = nil
		m.hookErr = nil
		for _, p := range m.manager.Processes {
			p.Healthy = nil
		}
		m.manager.StopAll()
		return m.runPreStartHooks()

	case ActionRestartProcess:
		if item.ProcessIndex >= 0 && item.ProcessIndex < len(m.manager.Processes) {
			m.manager.Processes[item.ProcessIndex].Healthy = nil
			go m.manager.Processes[item.ProcessIndex].Restart()
			// Bump this process's generation to kill the old probe chain,
			// then schedule a fresh one
			if hc := m.config.Processes[item.ProcessIndex].HealthCheck; hc != nil {
				return m.scheduleHealthCheck(item.ProcessIndex, hc)
			}
		}

	case ActionClearLogs:
		for _, p := range m.manager.Processes {
			p.ClearLines()
		}
		m.refreshPanes()

	case ActionClearErrors:
		for _, p := range m.manager.Processes {
			p.ClearErrors()
		}

	case ActionRunE2E:
		return m.openE2EPicker()

	case ActionStopE2E:
		return m.stopE2ERun()

	case ActionCleanRestart:
		// Open the clean picker; the post-clean transition is determined
		// by cleanPickerReturnPhase (PhaseRunning → stop processes, re-run
		// hooks, restart). Cancel in the picker returns here without
		// touching processes — they keep running.
		m.cleanPickerReturnPhase = PhaseRunning
		m.phase = PhasePreflightCleanPicker
		return m.initCleanPicker()

	case ActionExit:
		m.quitting = true
		return m.shutdownCmd()
	}

	return nil
}

func (m *Model) resizePanes() {
	if !m.ready {
		return
	}
	// Available: total height minus tab bar (1) and status bar (1 or 2)
	contentHeight := m.height - 1 - m.statusBarHeight()
	if m.searchOpen {
		contentHeight--
	}
	if contentHeight < 1 {
		contentHeight = 1
	}

	switch {
	case m.activeTab == 0:
		// "All" view splits across process panes plus the E2E and Probe panes
		// when they have output. Header rows (1 per pane) come out of the
		// viewport allotment, matching the pre-E2E layout.
		includeE2E := len(m.e2eRunner.GetLines()) > 0
		includeProbe := len(m.probeRunner.GetLines()) > 0
		visible := m.allViewProcessIndexes()
		nPanes := len(visible)
		total := nPanes
		if includeE2E {
			total++
		}
		if includeProbe {
			total++
		}
		if total < 1 {
			total = 1
		}
		perPane := contentHeight / total
		viewportHeight := perPane - 1
		if viewportHeight < 1 {
			viewportHeight = 1
		}
		remainder := contentHeight - (perPane * total)
		lastProcessPane := -1
		if nPanes > 0 {
			lastProcessPane = visible[nPanes-1]
		}
		for _, i := range visible {
			vpH := viewportHeight
			if !includeE2E && !includeProbe && i == lastProcessPane {
				vpH += remainder
			}
			m.panes[i].SetSize(m.width, vpH)
		}
		if includeE2E && !includeProbe {
			m.e2ePane.SetSize(m.width, viewportHeight+remainder)
		} else if includeE2E {
			m.e2ePane.SetSize(m.width, viewportHeight)
		}
		if includeProbe {
			m.probePane.SetSize(m.width, viewportHeight+remainder)
		}
	case m.activeTab == m.e2eTabIndex():
		// E2E single view: minus the header line that renderE2EContent prints.
		viewportHeight := contentHeight - 1
		if viewportHeight < 1 {
			viewportHeight = 1
		}
		m.e2ePane.SetSize(m.width, viewportHeight)
	case m.activeTab == m.probeTabIndex():
		// Probe single view: minus the header line printed by renderProbeContent.
		viewportHeight := contentHeight - 1
		if viewportHeight < 1 {
			viewportHeight = 1
		}
		m.probePane.SetSize(m.width, viewportHeight)
		m.probeMenu.SetHeight(viewportHeight)
		// View viewport: subtract 1 more for the hint line
		viewVPHeight := viewportHeight - 1
		if viewVPHeight < 1 {
			viewVPHeight = 1
		}
		m.probeViewViewport.SetWidth(m.width)
		m.probeViewViewport.SetHeight(viewVPHeight)
	default:
		viewportHeight := contentHeight
		idx := m.activeTab - 1
		if idx >= 0 && idx < len(m.panes) {
			m.panes[idx].SetSize(m.width, viewportHeight)
		}
	}
}

func (m *Model) refreshPanes() {
	switch {
	case m.activeTab == 0:
		for _, i := range m.allViewProcessIndexes() {
			m.panes[i].UpdateContent(m.manager.Processes[i].GetLines(), false)
		}
		if len(m.e2eRunner.GetLines()) > 0 {
			m.e2ePane.UpdateContent(m.e2eRunner.GetLines(), false)
		}
		if len(m.probeRunner.GetLines()) > 0 {
			m.probePane.UpdateContent(m.probeRunner.GetLines(), false)
		}
	case m.activeTab == m.e2eTabIndex():
		m.e2ePane.UpdateContent(m.e2eRunner.GetLines(), false)
	case m.activeTab == m.probeTabIndex():
		m.probePane.UpdateContent(m.probeRunner.GetLines(), false)
	default:
		idx := m.activeTab - 1
		if idx >= 0 && idx < len(m.panes) {
			m.panes[idx].UpdateContent(m.manager.Processes[idx].GetLines(), false)
		}
	}
}

func (m *Model) refreshPreflightViewport() {
	if !m.ready {
		return
	}
	h := m.height
	if h < 1 {
		h = 1
	}

	var content string
	switch m.phase {
	case PhasePreflightChecking:
		content = m.renderPreflightChecking()
	case PhasePreflightDashboard:
		content = m.renderPreflightDashboard()
	case PhasePreflightSelectFixes:
		content = m.renderPreflightSelectFixes()
	case PhasePreflightEnvForm:
		content = m.renderPreflightEnvForm()
	case PhasePreflightFixing:
		content = m.renderPreflightFixing()
	case PhasePreflightVerifying:
		content = m.renderPreflightVerifying()
	case PhasePreflightCleanPicker:
		content = m.renderCleanPicker()
	case PhasePreflightCleaning:
		content = m.renderCleaning()
	}

	savedOffset := m.preflightViewport.YOffset()
	m.preflightViewport.SetWidth(m.width)
	m.preflightViewport.SetHeight(h)
	m.preflightViewport.SetContent(content)
	if m.preflightAutoFollow {
		m.preflightViewport.GotoBottom()
	} else {
		m.preflightViewport.SetYOffset(savedOffset)
	}
}

func (m *Model) refreshHookViewport() {
	if !m.ready {
		return
	}
	viewportHeight := m.height
	if viewportHeight < 1 {
		viewportHeight = 1
	}

	var b strings.Builder
	if m.hookErr != nil {
		b.WriteString(hookTitleStyle.Render("⏳ Pre-start hooks"))
		b.WriteString("\n\n")
	} else {
		b.WriteString(hookTitleStyle.Render("⏳ Running pre-start hooks..."))
		b.WriteString("\n\n")
	}

	for _, out := range m.hookOutput {
		prefix := hookTitleStyle.Render(fmt.Sprintf("[%s] ", out.HookName))
		style := hookOutputStyle
		if out.IsError {
			style = errorLineStyle
		}
		b.WriteString(prefix + style.Render(out.Line) + "\n")
	}

	if m.hookErr != nil {
		b.WriteString("\n")
		b.WriteString(errorLineStyle.Render(fmt.Sprintf(" Hook failed: %v ", m.hookErr)))
		b.WriteString("\n\nPress 's' to open settings and retry, or Ctrl+C to exit.")
	}

	savedOffset := m.hookViewport.YOffset()
	m.hookViewport.SetWidth(m.width)
	m.hookViewport.SetHeight(viewportHeight)
	m.hookViewport.SetContent(b.String())
	if m.hookAutoFollow {
		m.hookViewport.GotoBottom()
	} else {
		m.hookViewport.SetYOffset(savedOffset)
	}
}

// refreshPrewarmViewport rebuilds the prewarm progress viewport from
// prewarmOutput and re-sizes it to the current terminal. Mirrors
// refreshHookViewport: content is rebuilt from the source string each call and
// the viewport auto-follows the tail until the user scrolls up. The viewport
// soft-wraps, so long lines (e.g. health-check URLs) wrap instead of being
// truncated to an ellipsis. Only the streamed log lines live here; the spinner
// header and dismissal hint are drawn around it by renderPrewarming.
func (m *Model) refreshPrewarmViewport() {
	if !m.ready {
		return
	}
	w, h := m.prewarmModalSize()

	dim := lipgloss.NewStyle().Foreground(lipgloss.Color("250")).Background(modalBg)
	content := dim.Render(strings.TrimRight(m.prewarmOutput, "\n"))

	savedOffset := m.prewarmViewport.YOffset()
	m.prewarmViewport.SetWidth(w)
	m.prewarmViewport.SetHeight(h)
	m.prewarmViewport.SetContent(content)
	if m.prewarmAutoFollow {
		m.prewarmViewport.GotoBottom()
	} else {
		m.prewarmViewport.SetYOffset(savedOffset)
	}
}

// scrollPrewarmViewport forwards a key to the prewarm output viewport and
// re-derives auto-follow: scrolling up off the bottom pins the view (so a
// streaming run doesn't yank it back down), and scrolling back to the bottom
// re-arms tailing. Mirrors the hook/preflight auto-follow toggles.
func (m *Model) scrollPrewarmViewport(msg tea.KeyPressMsg) tea.Cmd {
	vp, cmd := m.prewarmViewport.Update(msg)
	m.prewarmViewport = vp
	m.prewarmAutoFollow = m.prewarmViewport.AtBottom()
	return cmd
}

func (m *Model) activePanePtr() *Pane {
	if m.activeTab == 0 {
		return nil
	}
	if m.activeTab == m.e2eTabIndex() {
		return &m.e2ePane
	}
	if m.activeTab == m.probeTabIndex() {
		// When the runner is idle the menu is showing — return nil so arrow
		// keys are not forwarded to the viewport, letting the menu intercept them.
		if m.probeRunner.GetState() == probe.StateIdle {
			return nil
		}
		return &m.probePane
	}
	idx := m.activeTab - 1
	if idx >= 0 && idx < len(m.panes) {
		return &m.panes[idx]
	}
	return nil
}

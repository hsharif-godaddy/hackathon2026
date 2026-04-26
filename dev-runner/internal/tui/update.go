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

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
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
	return func() tea.Msg {
		// Wait for hook goroutine to finish (it will be killed by context cancel)
		if hookDone != nil {
			<-hookDone
		}
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
		m.resizeForms()
		m.fixProgress.SetWidth(max(min(msg.Width-10, 60), 1))
		return m, nil

	case spinner.TickMsg:
		if m.phase == PhasePreflightChecking || m.phase == PhasePreflightFixing || m.phase == PhasePreflightVerifying {
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

	case preflightFixDoneMsg:
		if msg.Err != nil {
			m.preflightFixStatus = fmt.Sprintf("Fix failed: %v", msg.Err)
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

	case tickMsg:
		m.refreshPanes()
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

	case clickHintMsg:
		m.clickHint = false

	case tea.MouseClickMsg:
		if !m.clickHint {
			m.clickHint = true
			cmds = append(cmds, tea.Tick(3*time.Second, func(_ time.Time) tea.Msg {
				return clickHintMsg{}
			}))
		}

	case tea.MouseWheelMsg:
		if m.phase >= PhasePreflightChecking && m.phase <= PhasePreflightVerifying {
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
	if m.phase >= PhasePreflightChecking && m.phase <= PhasePreflightVerifying {
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
		return m.updateFixSelector(msg)
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
		return m.openDevSettings()
	case key.Matches(msg, m.keys.Mouse):
		m.mouseEnabled = !m.mouseEnabled
	case key.Matches(msg, m.keys.Settings):
		return m.openSettings()
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
	if m.activeTab == 0 {
		for i := range m.panes {
			m.panes[i].SetSearch(query)
		}
	} else {
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

	if m.activeTab == 0 {
		n := max(len(m.panes), 1)
		// Each pane: header(1) + viewport; last pane gets remainder rows
		perPane := contentHeight / n
		viewportHeight := perPane - 1
		if viewportHeight < 1 {
			viewportHeight = 1
		}
		remainder := contentHeight - (perPane * n)
		for i := range m.panes {
			vpH := viewportHeight
			if i == n-1 {
				vpH += remainder
			}
			m.panes[i].SetSize(m.width, vpH)
		}
	} else {
		viewportHeight := contentHeight
		idx := m.activeTab - 1
		if idx >= 0 && idx < len(m.panes) {
			m.panes[idx].SetSize(m.width, viewportHeight)
		}
	}
}

func (m *Model) refreshPanes() {
	if m.activeTab == 0 {
		for i, p := range m.manager.Processes {
			m.panes[i].UpdateContent(p.GetLines(), false)
		}
	} else {
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

func (m *Model) activePanePtr() *Pane {
	if m.activeTab == 0 {
		return nil
	}
	idx := m.activeTab - 1
	if idx >= 0 && idx < len(m.panes) {
		return &m.panes[idx]
	}
	return nil
}

package tui

import (
	"context"
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/clean"
)

// cleanGroup describes one row in the clean picker. The set() callback turns
// a selected index into a Selection mutation, decoupling the picker labels
// from the clean.Selection field names.
type cleanGroup struct {
	label    string
	selected bool
	set      func(*clean.Selection)
}

var cleanGroups = []cleanGroup{
	{
		label:    "Build artifacts (dist/, .turbo/, app/.next, *.tsbuildinfo, …)",
		selected: true,
		set:      func(s *clean.Selection) { s.BuildArtifacts = true },
	},
	{
		label:    "Runtime data (control-plane DB, .dev-bms/)",
		selected: false,
		set:      func(s *clean.Selection) { s.RuntimeData = true },
	},
	{
		label:    "Env files & certs (.env, certs/) — re-fetches secrets on regen",
		selected: false,
		set:      func(s *clean.Selection) { s.EnvFiles = true },
	},
	{
		// node_modules turns out to be a common reason people clean
		// (corrupt installs, stale lockfile state, weird symlink
		// breakage). Default it on; users with a healthy install can
		// untoggle to skip the slow `pnpm install` afterward.
		label:    "node_modules (slow — requires pnpm install after)",
		selected: true,
		set:      func(s *clean.Selection) { s.NodeModules = true },
	},
}

// initCleanPicker builds the multi-select form. The picker is reachable from
// two paths: --clean at startup, and `c` on the preflight dashboard. The caller
// is responsible for setting m.cleanPickerReturnPhase before invoking this.
func (m *Model) initCleanPicker() tea.Cmd {
	opts := make([]huh.Option[int], len(cleanGroups))
	for i, g := range cleanGroups {
		opts[i] = huh.NewOption(g.label, i).Selected(g.selected)
	}

	selected := make([]int, 0, len(cleanGroups))
	for i, g := range cleanGroups {
		if g.selected {
			selected = append(selected, i)
		}
	}

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewMultiSelect[int]().
				Title("Clean which groups?").
				Description("Space toggles, Enter confirms, Esc cancels.").
				Options(opts...).
				Value(&selected).
				Height(len(cleanGroups) + 2),
		),
	).WithShowHelp(true)

	m.cleanPickerForm = m.applyInlineForm(form)
	m.cleanPickerValue = &selected
	return m.cleanPickerForm.Init()
}

// updateCleanPicker forwards messages to the picker form and dispatches on
// completion/abort.
func (m *Model) updateCleanPicker(msg tea.Msg) tea.Cmd {
	if m.cleanPickerForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.cleanPickerForm, cmd = stepForm(m.cleanPickerForm, msg)

	switch m.cleanPickerForm.State {
	case huh.StateCompleted:
		sel := assembleSelection(*m.cleanPickerValue)
		m.cleanPickerForm = nil
		m.cleanPickerValue = nil

		if sel.Empty() {
			return m.exitCleanPicker()
		}

		// Settings → "Clean + Restart": stop running processes BEFORE we
		// start deleting their files. Otherwise selecting node_modules
		// (default-on) yanks deps out from under live watchers /
		// Next.js, and BuildArtifacts/RuntimeData can corrupt running
		// services similarly. The actual StopAll happens inside the
		// runClean tea.Cmd (it can take up to ShutdownTimeout per
		// process group) — calling it here would freeze the event loop.
		// Quick state mutations (Healthy reset) stay synchronous.
		stopFirst := m.cleanPickerReturnPhase == PhaseRunning
		if stopFirst {
			for _, p := range m.manager.Processes {
				p.Healthy = nil
			}
		}

		m.phase = PhasePreflightCleaning
		m.cleanRunning = true
		m.cleanOutput = ""
		m.cleanErr = nil
		return tea.Batch(m.spinner.Tick, m.runClean(sel, stopFirst))

	case huh.StateAborted:
		m.cleanPickerForm = nil
		m.cleanPickerValue = nil
		return m.exitCleanPicker()
	}
	return cmd
}

// exitCleanPicker routes back to the phase the picker was launched from.
// From --clean startup we still need to run preflight; from the dashboard
// we just return to the dashboard. From `dev-runner clean` (cleanOnly) we
// quit — there's no dev session to return to.
func (m *Model) exitCleanPicker() tea.Cmd {
	if m.cleanOnly {
		m.quitting = true
		return tea.Quit
	}
	m.phase = m.cleanPickerReturnPhase
	if m.phase == PhasePreflightChecking {
		return m.startInitialPreflight()
	}
	return nil
}

// assembleSelection turns picker indices into a clean.Selection. Indices
// outside cleanGroups are silently ignored — defensive against future
// list edits that might leave stale Value entries from a saved state.
func assembleSelection(indices []int) clean.Selection {
	var sel clean.Selection
	for _, i := range indices {
		if i >= 0 && i < len(cleanGroups) {
			cleanGroups[i].set(&sel)
		}
	}
	return sel
}

// runClean spawns a goroutine that optionally stops running processes
// (settings → "Clean + Restart"), then runs clean.RunWithStreams with
// output captured to a buffer, and emits cleanDoneMsg on completion.
// StopAll lives in here rather than the synchronous Update path because
// it can block up to process.ShutdownTimeout per group; running it on
// the goroutine keeps the TUI's event loop responsive (the spinner
// keeps animating, keys are still consumed, etc.).
//
// The capture sink is a clean.SafeBuffer because we plumb it as both
// out and errOut into RunWithStreams — exec spawns independent copier
// goroutines for cmd.Stdout/Stderr that would otherwise race on a bare
// bytes.Buffer.
func (m *Model) runClean(sel clean.Selection, stopProcessesFirst bool) tea.Cmd {
	mgr := m.manager
	projectRoot := m.projectRoot
	return func() tea.Msg {
		if stopProcessesFirst && mgr != nil {
			mgr.StopAll()
		}
		var buf clean.SafeBuffer
		err := clean.RunWithStreams(projectRoot, sel, true, &buf, &buf, strings.NewReader(""))
		return cleanDoneMsg{Output: buf.String(), Err: err}
	}
}

// startInitialPreflight mirrors the kickoff in Init() so the post-clean path
// from --clean startup arrives at the dashboard with fresh check results.
func (m *Model) startInitialPreflight() tea.Cmd {
	runner := m.preflightRunner
	projectRoot := m.projectRoot
	return func() tea.Msg {
		results := runner.RunAll(context.Background(), projectRoot)
		return preflightAllChecksDoneMsg{Results: results}
	}
}

// advancePastClean transitions from PhasePreflightCleaning into whatever
// follows, based on where the clean was launched from:
//
//   - PhasePreflightDashboard: re-verify (dashboard 'c'); the user already
//     has results, so we re-run all checks under the "Verifying fixes…"
//     header.
//   - PhaseRunning: full restart (settings → "Clean + Restart"); stop
//     processes, then run the initial preflight. Going through preflight is
//     load-bearing: deleting Env files / Runtime data leaves env files,
//     certs, and the LCP DB missing, and only preflight's fixers
//     (EnvFixer, S2SCertsFixer, JWTKeysFixer, LCPEnvFixer, …) regenerate
//     them. Skipping straight to hooks would restart processes against a
//     tree missing their config. Preflight → dashboard → hooks → running
//     handles the rest of the chain.
//   - PhasePreflightChecking (default): first-time launch (--clean /
//     --clean-all startup); kick off the initial preflight so the user
//     lands at the dashboard.
func (m *Model) advancePastClean() tea.Cmd {
	if m.cleanOnly {
		// `dev-runner clean` (interactive, no flags): the user wanted a
		// clean, not a dev session. Successful clean → quit.
		m.quitting = true
		return tea.Quit
	}
	runner := m.preflightRunner
	projectRoot := m.projectRoot
	switch m.cleanPickerReturnPhase {
	case PhasePreflightDashboard:
		m.phase = PhasePreflightVerifying
		return tea.Batch(m.spinner.Tick, func() tea.Msg {
			results := runner.RunAll(context.Background(), projectRoot)
			return preflightVerifyDoneMsg{Results: results}
		})
	case PhaseRunning:
		// Processes were already stopped (asynchronously) inside
		// runClean before the clean started — see updateCleanPicker
		// where we read cleanPickerReturnPhase to decide. Healthy reset
		// happened there too. Just drop any prior preflight results so
		// the dashboard renders the new run cleanly, and kick off
		// preflight: its fixers regenerate any env files / certs the
		// clean removed before hooks → restart.
		m.preflightResults = nil
		m.phase = PhasePreflightChecking
		return tea.Batch(m.spinner.Tick, func() tea.Msg {
			results := runner.RunAll(context.Background(), projectRoot)
			return preflightAllChecksDoneMsg{Results: results}
		})
	}
	m.phase = PhasePreflightChecking
	return tea.Batch(m.spinner.Tick, func() tea.Msg {
		results := runner.RunAll(context.Background(), projectRoot)
		return preflightAllChecksDoneMsg{Results: results}
	})
}

// renderCleanPicker renders the picker phase: a header plus the form view.
func (m Model) renderCleanPicker() string {
	var b strings.Builder
	b.WriteString(preflightHeaderStyle.Render("Clean"))
	b.WriteString("\n\n")
	if m.cleanPickerForm != nil {
		b.WriteString(m.cleanPickerForm.View())
	}
	return b.String()
}

// renderCleaning shows a spinner while clean.RunWithStreams is in flight.
// On success the cleanDoneMsg handler advances to preflight immediately
// (no terminal state rendered). On failure the captured error and output
// are surfaced and the user must press Enter or q — otherwise a
// half-cleaned tree would silently roll into preflight.
//
// Footer copy diverges only for cleanOnly (`dev-runner clean`): there is
// no dev session to advance into, so Enter exits. All other origins —
// including settings → "Clean + Restart" (which stops processes
// pre-clean) — share the same "continue with preflight" hint, and
// Enter routes through advancePastClean.
func (m Model) renderCleaning() string {
	var b strings.Builder
	b.WriteString(preflightHeaderStyle.Render("Cleaning"))
	b.WriteString("\n\n")
	dim := lipgloss.NewStyle().Foreground(lipgloss.Color("244"))
	if m.cleanRunning {
		b.WriteString(dim.Render(m.spinner.View() + " Cleaning… (node_modules can take a moment)"))
		return b.String()
	}
	if m.cleanErr != nil {
		b.WriteString(preflightFailStyle.Render(fmt.Sprintf("✗ Clean failed: %v", m.cleanErr)))
		b.WriteString("\n\n")
		if m.cleanOutput != "" {
			b.WriteString(dim.Render(strings.TrimSpace(m.cleanOutput)))
			b.WriteString("\n\n")
		}
		hint := "Press Enter to continue with preflight, q to quit."
		if m.cleanOnly {
			hint = "Press Enter to exit, q to quit."
		}
		b.WriteString(preflightFooterStyle.Render(hint))
	}
	return b.String()
}

package tui

import (
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// fixSelectorHeight is the visible row count for the MultiSelect viewport.
// Smaller than huh's default (10) because the preflight check results panel
// above consumes most of the terminal. Items beyond this height scroll.
const fixSelectorHeight = 8

// initFixSelector builds a huh.MultiSelect form over the fixable checks,
// preselecting every non-opt-in item. Selected indices are collected when
// the form completes.
func (m *Model) initFixSelector(fixable []preflight.CheckWithFixer) tea.Cmd {
	m.fixSelectorItems = fixable

	// Bind selections by index so we can map back to CheckWithFixer. Using int
	// rather than pointer means equality works as huh expects.
	opts := make([]huh.Option[int], len(fixable))
	for i, cwf := range fixable {
		opts[i] = huh.NewOption(cwf.Check.Name(), i).Selected(!cwf.OptIn)
	}

	selected := make([]int, 0, len(fixable))
	for i, cwf := range fixable {
		if !cwf.OptIn {
			selected = append(selected, i)
		}
	}

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewMultiSelect[int]().
				Title("Select items to fix").
				Options(opts...).
				Value(&selected).
				Height(fixSelectorHeight),
		),
	).WithShowHelp(true)

	m.fixSelectorForm = m.applyInlineForm(form)
	m.fixSelectorValue = &selected
	return m.fixSelectorForm.Init()
}

// updateFixSelector forwards a message to the embedded huh form and handles
// state transitions (completion runs the selected fixes; abort returns to the
// dashboard).
func (m *Model) updateFixSelector(msg tea.Msg) tea.Cmd {
	if m.fixSelectorForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.fixSelectorForm, cmd = stepForm(m.fixSelectorForm, msg)

	switch m.fixSelectorForm.State {
	case huh.StateCompleted:
		queue := make([]preflight.CheckWithFixer, 0, len(*m.fixSelectorValue))
		for _, idx := range *m.fixSelectorValue {
			if idx >= 0 && idx < len(m.fixSelectorItems) {
				queue = append(queue, m.fixSelectorItems[idx])
			}
		}
		m.fixSelectorForm = nil
		m.fixSelectorValue = nil

		if len(queue) == 0 {
			m.phase = PhasePreflightDashboard
			return nil
		}
		m.preflightFixQueue = queue
		m.preflightFixIndex = 0
		// Clear stale errors for the checks we are retrying so the dashboard
		// won't show last run's failure during this fix pass; entries for
		// checks not being retried are intentionally kept and pruned later
		// only if those checks pass on verify.
		for _, cwf := range queue {
			delete(m.preflightFixErrors, cwf.Check.Name())
		}
		m.phase = PhasePreflightFixing
		return tea.Batch(m.runNextFixer(), m.spinner.Tick)
	case huh.StateAborted:
		m.fixSelectorForm = nil
		m.fixSelectorValue = nil
		m.phase = PhasePreflightDashboard
		return nil
	}
	return cmd
}

// renderPreflightSelectFixes renders the check results at top followed by the
// embedded huh MultiSelect.
func (m Model) renderPreflightSelectFixes() string {
	var b strings.Builder
	b.WriteString(preflightHeaderStyle.Render("Preflight Checks"))
	b.WriteString("\n")
	b.WriteString(m.renderCheckResults())
	b.WriteString("\n")
	if m.fixSelectorForm != nil {
		b.WriteString(m.fixSelectorForm.View())
	}
	b.WriteString("\n")
	b.WriteString(preflightFooterStyle.Render(mouseToggleHelp(m.mouseEnabled)))
	if m.clickHint {
		b.WriteString("\n")
		b.WriteString(clickHintMessage())
	}
	return b.String()
}

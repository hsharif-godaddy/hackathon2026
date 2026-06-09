package tui

import (
	"context"
	"errors"
	"strings"
	"sync"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/prewarm"
)

// prewarmGroup describes one row in the prewarm picker. set() turns a selected
// index into a prewarm.Selection mutation.
type prewarmGroup struct {
	label    string
	selected bool
	set      func(*prewarm.Selection)
}

var prewarmGroups = []prewarmGroup{
	{
		label:    "API routes — compile Next.js routes",
		selected: true,
		set:      func(s *prewarm.Selection) { s.API = true },
	},
	{
		label:    "Docker images — warm container image cache",
		selected: true,
		set:      func(s *prewarm.Selection) { s.Docker = true },
	},
}

// assemblePrewarmSelection turns picker indices into a prewarm.Selection.
func assemblePrewarmSelection(indices []int) prewarm.Selection {
	var sel prewarm.Selection
	for _, i := range indices {
		if i >= 0 && i < len(prewarmGroups) {
			prewarmGroups[i].set(&sel)
		}
	}
	return sel
}

// openPrewarmPicker builds the multi-select overlay form (both default-on).
func (m *Model) openPrewarmPicker() tea.Cmd {
	opts := make([]huh.Option[int], len(prewarmGroups))
	selected := make([]int, 0, len(prewarmGroups))
	for i, g := range prewarmGroups {
		opts[i] = huh.NewOption(g.label, i).Selected(g.selected)
		if g.selected {
			selected = append(selected, i)
		}
	}
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewMultiSelect[int]().
				Title("Prewarm which targets?").
				Description("Space toggles, Enter confirms, Esc cancels.").
				Options(opts...).
				Value(&selected).
				Height(len(prewarmGroups) + 2),
		),
	).WithShowHelp(true)

	m.prewarmPickerForm = m.applyModalForm(form)
	m.prewarmPickerValue = &selected
	return m.prewarmPickerForm.Init()
}

// updatePrewarmPicker forwards messages to the picker and runs on completion.
func (m *Model) updatePrewarmPicker(msg tea.Msg) tea.Cmd {
	if m.prewarmPickerForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.prewarmPickerForm, cmd = stepForm(m.prewarmPickerForm, msg)

	switch m.prewarmPickerForm.State {
	case huh.StateCompleted:
		sel := assemblePrewarmSelection(*m.prewarmPickerValue)
		m.prewarmPickerForm = nil
		m.prewarmPickerValue = nil
		if sel.Empty() {
			return nil
		}
		return m.runPrewarm(sel)
	case huh.StateAborted:
		m.prewarmPickerForm = nil
		m.prewarmPickerValue = nil
		return nil
	}
	return cmd
}

// runPrewarm starts a goroutine that runs the selected warmers, streaming each
// output line as a prewarmLineMsg over m.prewarmCh and emitting a terminal
// prewarmDoneMsg. Shared by the picker confirm and the auto-fire path.
func (m *Model) runPrewarm(sel prewarm.Selection) tea.Cmd {
	m.prewarmRunning = true
	m.prewarmOutput = ""
	m.prewarmErr = nil
	m.prewarmAutoFollow = true
	m.refreshPrewarmViewport() // size + clear the viewport before lines arrive

	appURL := appBaseURL(m.config)
	cpURL := m.controlPlaneBaseURL
	// Buffered so the warming goroutine isn't blocked between Update cycles;
	// the Update loop re-issues waitForPrewarm after every line to keep draining.
	ch := make(chan tea.Msg, 256)
	m.prewarmCh = ch

	go func() {
		w := &chanWriter{ch: ch}
		// API route warming and Docker image warming are independent, so run
		// them concurrently rather than serializing one behind the other. Each
		// reports into the same (concurrency-safe) chanWriter; the terminal
		// error is the first non-nil of the two.
		var wg sync.WaitGroup
		var apiErr, dockerErr error
		if sel.API {
			wg.Add(1)
			go func() {
				defer wg.Done()
				apiErr = prewarm.WarmAPI(context.Background(), appURL, w)
			}()
		}
		if sel.Docker {
			wg.Add(1)
			go func() {
				defer wg.Done()
				dockerErr = prewarm.WarmImages(context.Background(), cpURL, w)
			}()
		}
		wg.Wait()
		// WarmImages streams only its start/success lines, so a Docker-warm
		// failure leaves no streamed trace. Emit each non-nil error as a line
		// before the terminal message, and join both so a failure in either
		// warmer surfaces even when the other also fails.
		if apiErr != nil {
			ch <- prewarmLineMsg("API warm failed: " + apiErr.Error())
		}
		if dockerErr != nil {
			ch <- prewarmLineMsg("Docker warm failed: " + dockerErr.Error())
		}
		ch <- prewarmDoneMsg{Err: errors.Join(apiErr, dockerErr)}
		close(ch)
	}()

	return tea.Batch(m.spinner.Tick, waitForPrewarm(ch))
}

// waitForPrewarm blocks on the next streamed message — a prewarmLineMsg or the
// terminal prewarmDoneMsg — so the Update loop renders live progress. The
// Update handler re-issues it after each line and stops on prewarmDoneMsg.
func waitForPrewarm(ch chan tea.Msg) tea.Cmd {
	return func() tea.Msg {
		msg, ok := <-ch
		if !ok {
			return nil
		}
		return msg
	}
}

// chanWriter adapts the warmers' io.Writer output into per-line tea messages.
// WarmAPI and WarmImages now run concurrently and share one chanWriter, so the
// mutex keeps each multi-line Write's lines contiguous rather than interleaved
// with the other warmer's output mid-write.
type chanWriter struct {
	mu sync.Mutex
	ch chan<- tea.Msg
}

func (w *chanWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, line := range strings.Split(strings.TrimRight(string(p), "\n"), "\n") {
		w.ch <- prewarmLineMsg(line)
	}
	return len(p), nil
}

// renderPrewarmPicker renders the picker overlay box.
func (m Model) renderPrewarmPicker() string {
	if m.prewarmPickerForm == nil {
		return ""
	}
	// Wrap in the shared modal box (opaque double border) so the overlay is
	// legible against the log content behind it — mirrors renderProbePicker.
	return settingsBoxStyle.Render(m.prewarmPickerForm.View())
}

// renderPrewarming renders the in-progress spinner / failure overlay around
// the scrollable, soft-wrapping prewarm viewport (which auto-follows the tail).
// On success the prewarmDoneMsg handler clears state, so this is only shown
// while running or after a failure (awaiting dismissal). The viewport content
// and scroll position are maintained by refreshPrewarmViewport; this method
// only lays out the box.
func (m Model) renderPrewarming() string {
	width, _ := m.prewarmModalSize()

	// Outer fill: lay every line out at the fixed interior width over modalBg so
	// soft-wrapped short lines don't leave a ragged terminal-default (black)
	// right edge — settingsBoxStyle fills the surrounding chrome with the same
	// color. Each text span below also carries modalBg explicitly, because a
	// pre-styled span (the spinner, the fail marker) emits an ANSI reset that
	// would otherwise drop this background for the rest of its line.
	panel := lipgloss.NewStyle().Width(width).Background(modalBg).Foreground(modalFg)
	bg := lipgloss.NewStyle().Background(modalBg)
	hint := bg.Foreground(lipgloss.Color("244"))

	var b strings.Builder
	if m.prewarmRunning {
		b.WriteString(bg.Render(m.spinner.View()) + bg.Foreground(modalFg).Render(" Prewarming…"))
		b.WriteString("\n\n")
		b.WriteString(m.prewarmViewport.View())
		b.WriteString("\n\n")
		b.WriteString(hint.Render("↑/↓ scroll · auto-follows newest output"))
	} else {
		// Failure (success path clears state and renders no overlay).
		b.WriteString(bg.Foreground(statusErrored).Bold(true).Render("✗ Prewarm failed"))
		b.WriteString("\n\n")
		if m.prewarmErr != nil {
			b.WriteString(bg.Foreground(modalFg).Render(m.prewarmErr.Error()))
			b.WriteString("\n\n")
		}
		b.WriteString(m.prewarmViewport.View())
		b.WriteString("\n\n")
		b.WriteString(hint.Render("Press Enter or Esc to dismiss."))
	}
	// Render the assembled body at the fixed interior width over modalBg, then
	// wrap in the shared modal box (DoubleBorder + Padding — the modalBoxChrome
	// that prewarmModalSize already subtracted).
	return settingsBoxStyle.Render(panel.Render(b.String()))
}

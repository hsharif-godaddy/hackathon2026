package tui

import (
	"fmt"
	"image/color"
	"strings"
	"time"

	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/e2e"
)

// renderE2EContent renders the E2E tab body. The pane content is delegated to
// the same `Pane` viewport used by service tabs (search, follow, scroll all
// work identically); we only own the header and the empty-state hint.
func (m Model) renderE2EContent() string {
	header := m.renderE2EHeader()
	if m.e2eRunner.GetState() == e2e.StateIdle {
		return header + "\n" + m.renderE2EEmpty()
	}
	return header + "\n" + m.e2ePane.Viewport.View()
}

func (m Model) renderE2EHeader() string {
	state := m.e2eRunner.GetState()
	args := m.e2eRunner.GetArgs()
	last := m.e2eRunner.LastRun()

	var summary string
	switch state {
	case e2e.StateIdle:
		summary = "no run yet"
	case e2e.StateRunning:
		summary = fmt.Sprintf("running %s/%s — %s", args.Project, args.Env, testCountLabel(args.TestNames))
	case e2e.StateStopped:
		if last != nil {
			summary = fmt.Sprintf("done %s/%s — exit %d in %s", args.Project, args.Env, last.ExitCode, last.EndAt.Sub(last.StartAt).Truncate(time.Second))
		} else {
			summary = "done"
		}
	case e2e.StateErrored:
		if last != nil {
			summary = fmt.Sprintf("failed %s/%s — exit %d", args.Project, args.Env, last.ExitCode)
		} else {
			summary = "failed"
		}
	}

	return paneHeaderStyle.Width(m.width).Render(fmt.Sprintf(" E2E (Playwright) — %s ", summary))
}

func (m Model) renderE2EEmpty() string {
	hint := "No E2E run yet.\n\nPress " +
		keyStyle.Render("s") +
		" → " +
		keyStyle.Render("Run E2E Tests...") +
		" to pick a project, env, and tests."
	return lipgloss.NewStyle().
		Foreground(lipgloss.Color("244")).
		Padding(2, 4).
		Render(hint)
}

// e2eTabIndex returns the tab index for the E2E pane (the last tab).
func (m Model) e2eTabIndex() int {
	return 1 + m.processCount()
}

// e2eStateColor returns the dot color for the E2E tab indicator. Mirrors
// statusColorForState in view.go but uses the e2e package's State type.
func e2eStateColor(state e2e.State) color.Color {
	switch state {
	case e2e.StateRunning:
		return statusStarting
	case e2e.StateStopped:
		return statusRunning
	case e2e.StateErrored:
		return statusErrored
	default:
		return statusStopped
	}
}

func testCountLabel(names []string) string {
	switch len(names) {
	case 0:
		return "all tests"
	case 1:
		return "1 test"
	default:
		return fmt.Sprintf("%d tests", len(names))
	}
}

// truncateMiddle is used by the picker form when test titles are long enough to
// run past the modal width. Keeps the leading and trailing context.
func truncateMiddle(s string, max int) string {
	if max < 8 || len(s) <= max {
		return s
	}
	keep := (max - 3) / 2
	return s[:keep] + "..." + s[len(s)-keep:]
}

// joinNonEmpty drops empty strings from in and joins the rest with sep.
// Used for the picker summary line which mixes optional fields.
func joinNonEmpty(sep string, in ...string) string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return strings.Join(out, sep)
}

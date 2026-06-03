package tui

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func (m Model) renderPreflightChecking() string {
	var b strings.Builder
	b.WriteString(preflightHeaderStyle.Render("Preflight Checks"))
	b.WriteString("\n\n")
	b.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color("244")).Render(m.spinner.View() + " Checking prerequisites..."))
	b.WriteString("\n")

	if len(m.preflightResults) > 0 {
		b.WriteString(m.renderCheckResults())
	}

	return b.String()
}

func (m Model) renderPreflightDashboard() string {
	var b strings.Builder

	failCount := 0
	warnCount := 0
	for _, r := range m.preflightResults {
		if r.Status == preflight.StatusFail {
			failCount++
		}
		if r.Status == preflight.StatusWarn {
			warnCount++
		}
	}

	header := "Preflight Checks"
	if failCount > 0 {
		header += fmt.Sprintf("  %s",
			preflightFailStyle.Render(fmt.Sprintf("%d error(s)", failCount)))
		if warnCount > 0 {
			header += fmt.Sprintf("  %s",
				preflightWarnStyle.Render(fmt.Sprintf("%d warning(s)", warnCount)))
		}
	} else if warnCount > 0 {
		header += fmt.Sprintf("  %s",
			preflightWarnStyle.Render(fmt.Sprintf("%d warning(s)", warnCount)))
	} else {
		header += "  " + preflightPassStyle.Render("All clear ✓")
	}
	b.WriteString(preflightHeaderStyle.Render(header))
	b.WriteString("\n")

	b.WriteString(m.renderCheckResults())

	m.preflightKeys.Mouse.SetHelp("m", mouseLabel(m.mouseEnabled))

	b.WriteString("\n")
	fixable := m.preflightRunner.FixableChecks(m.preflightResults)
	if len(fixable) > 0 {
		b.WriteString(preflightFooterStyle.Render(
			fmt.Sprintf("%d item(s) can be auto-fixed. ", len(fixable)) + m.help.View(m.preflightKeys)))
	} else if failCount > 0 {
		b.WriteString(preflightFooterStyle.Render(
			"No auto-fixes available. Install missing tools and run again. " + m.help.View(m.preflightKeys)))
	} else if warnCount > 0 {
		b.WriteString(preflightFooterStyle.Render(m.help.View(m.preflightKeys)))
	}
	if m.clickHint {
		b.WriteString("\n")
		b.WriteString(clickHintMessage())
	}

	return b.String()
}

func (m Model) renderPreflightFixing() string {
	var b strings.Builder
	b.WriteString(preflightFixTitleStyle.Render("Fixing Issues"))
	b.WriteString("\n\n")

	if total := len(m.preflightFixQueue); total > 0 {
		pct := float64(m.preflightFixIndex) / float64(total)
		b.WriteString("  " + m.fixProgress.ViewAs(pct))
		fmt.Fprintf(&b, "  %d / %d", m.preflightFixIndex, total)
		b.WriteString("\n\n")
	}

	for i, cwf := range m.preflightFixQueue {
		name := cwf.Check.Name()
		if i < m.preflightFixIndex {
			b.WriteString(preflightPassStyle.Render("  ✓ " + name))
			b.WriteString("\n")
		} else if i == m.preflightFixIndex {
			b.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color("62")).Bold(true).
				Render("  " + m.spinner.View() + " " + name + "..."))
			b.WriteString("\n")
		} else {
			b.WriteString(preflightSkipStyle.Render("  · " + name))
			b.WriteString("\n")
		}
	}

	if m.preflightFixStatus != "" {
		b.WriteString("\n")
		b.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color("244")).Render(m.preflightFixStatus))
	}

	return b.String()
}

func (m Model) renderPreflightVerifying() string {
	var b strings.Builder
	b.WriteString(preflightHeaderStyle.Render(m.spinner.View() + " Verifying fixes..."))
	b.WriteString("\n\n")
	b.WriteString(m.renderCheckResults())
	return b.String()
}

func (m Model) renderCheckResults() string {
	var b strings.Builder

	// Group by category preserving order
	type catGroup struct {
		name    string
		results []preflight.CheckResult
	}
	var groups []catGroup
	seen := make(map[string]int)

	for _, r := range m.preflightResults {
		idx, ok := seen[r.Category]
		if !ok {
			idx = len(groups)
			seen[r.Category] = idx
			groups = append(groups, catGroup{name: r.Category})
		}
		groups[idx].results = append(groups[idx].results, r)
	}

	dim := lipgloss.NewStyle().Foreground(lipgloss.Color("244"))

	for _, g := range groups {
		b.WriteString(preflightCategoryStyle.Render("  " + g.name))
		b.WriteString("\n")

		var passing []preflight.CheckResult
		for _, r := range g.results {
			if r.Status == preflight.StatusPass && !m.preflightExpandPassing {
				passing = append(passing, r)
				continue
			}
			icon, style := statusIcon(r.Status)
			fmt.Fprintf(&b, "    %s %-24s %s\n",
				style.Render(icon), r.Name, dim.Render(r.Message))

			if (r.Status == preflight.StatusFail || r.Status == preflight.StatusWarn) && r.InstallHint != "" && !r.FixAvailable {
				for _, hint := range strings.Split(r.InstallHint, "\n") {
					fmt.Fprintf(&b, "      %s\n", dim.Italic(true).Render(hint))
				}
			}

			if r.Status == preflight.StatusFail || r.Status == preflight.StatusWarn {
				if err, ok := m.preflightFixErrors[r.Name]; ok && err != nil {
					msg := strings.TrimRight(err.Error(), "\n")
					if msg == "" {
						msg = "(no error message)"
					}
					lines := strings.Split(msg, "\n")
					const maxFixErrorLines = 6
					truncated := false
					if len(lines) > maxFixErrorLines {
						lines = lines[:maxFixErrorLines]
						truncated = true
					}
					for i, line := range lines {
						prefix := "        "
						if i == 0 {
							prefix = "      " + preflightFailStyle.Render("↳ last fix failed: ")
						}
						fmt.Fprintf(&b, "%s%s\n", prefix, dim.Italic(true).Render(line))
					}
					if truncated {
						fmt.Fprintf(&b, "        %s\n", dim.Italic(true).Render("(…truncated)"))
					}
				}
			}
		}
		if n := len(passing); n > 0 {
			fmt.Fprintf(&b, "    %s %s\n",
				preflightPassStyle.Render("✓"),
				dim.Render(fmt.Sprintf("%d passed (v to expand)", n)))
		}
	}

	return b.String()
}

func statusIcon(s preflight.Status) (string, lipgloss.Style) {
	switch s {
	case preflight.StatusPass:
		return "✓", preflightPassStyle
	case preflight.StatusFail:
		return "✗", preflightFailStyle
	case preflight.StatusWarn:
		return "⚠", preflightWarnStyle
	case preflight.StatusSkip:
		return "○", preflightSkipStyle
	default:
		return "?", preflightSkipStyle
	}
}

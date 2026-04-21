package tui

import (
	"fmt"
	"image/color"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/process"
)

// View renders the full TUI.
func (m Model) View() tea.View {
	var content string

	if m.quitting {
		content = "Shutting down... (Ctrl+C to force quit)\n"
	} else if !m.ready {
		content = "Initializing...\n"
	} else {
		var sections []string

		switch m.phase {
		case PhasePreflightChecking, PhasePreflightDashboard,
			PhasePreflightSelectFixes, PhasePreflightEnvForm,
			PhasePreflightFixing, PhasePreflightVerifying:
			sections = append(sections, m.preflightViewport.View())
		case PhaseHooks:
			sections = append(sections, m.renderHookView())
		case PhaseRunning:
			if m.hookErr != nil {
				sections = append(sections, m.renderHookView())
			} else {
				sections = append(sections, m.renderTabBar())
				sections = append(sections, m.renderContent())
				if m.searchOpen {
					sections = append(sections, m.renderSearchBar())
				}
				sections = append(sections, m.renderStatusBar())
			}
		}

		base := lipgloss.JoinVertical(lipgloss.Left, sections...)

		if m.confirmQuit {
			content = lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, m.renderQuitConfirm())
		} else if m.devSettingsOpen {
			content = lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, m.renderDevSettings())
		} else if m.settingsOpen {
			content = lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, m.renderSettings())
		} else {
			content = truncateHeight(base, m.height)
		}
	}

	v := tea.NewView(content)
	v.AltScreen = true
	if m.mouseEnabled {
		v.MouseMode = tea.MouseModeCellMotion
	}
	return v
}

func (m Model) renderTabBar() string {
	var tabs []string

	label := " All "
	if m.activeTab == 0 {
		tabs = append(tabs, activeTabStyle.Render(label))
	} else {
		tabs = append(tabs, inactiveTabStyle.Render(label))
	}

	for i, p := range m.manager.Processes {
		name := p.Config.Name
		state := p.GetState()
		tabIdx := i + 1
		active := m.activeTab == tabIdx

		// Pick background based on active state
		bg := lipgloss.Color("236")
		nameFg := lipgloss.Color("250")
		if active {
			bg = lipgloss.Color("62")
			nameFg = lipgloss.Color("15")
		}

		// Dot with state color + tab background
		dotColor := statusColorForState(state)
		dot := lipgloss.NewStyle().Foreground(dotColor).Background(bg).Render(" ●")

		// Name + optional error count, all within the tab
		label := name
		if p.ErrorCount > 0 {
			label += fmt.Sprintf(" 🔔%d", p.ErrorCount)
		}
		nameStr := lipgloss.NewStyle().Foreground(nameFg).Background(bg).
			Bold(active).Render(fmt.Sprintf(" %s ", label))

		tabs = append(tabs, dot+nameStr)
	}

	row := lipgloss.JoinHorizontal(lipgloss.Top, tabs...)
	pad := m.width - lipgloss.Width(row)
	if pad > 0 {
		row += lipgloss.NewStyle().Background(lipgloss.Color("236")).Render(strings.Repeat(" ", pad))
	}
	return row
}

func (m Model) renderContent() string {
	if m.activeTab == 0 {
		return m.renderCombinedView()
	}
	return m.renderSingleView()
}

func (m Model) renderCombinedView() string {
	if len(m.panes) == 0 {
		return ""
	}

	var rendered []string
	for i := range m.panes {
		header := paneHeaderStyle.Width(m.width).
			Render(fmt.Sprintf(" %s ", m.manager.Processes[i].Config.Name))
		rendered = append(rendered, header+"\n"+m.panes[i].Viewport.View())
	}

	return lipgloss.JoinVertical(lipgloss.Left, rendered...)
}

func (m Model) renderSingleView() string {
	idx := m.activeTab - 1
	if idx < 0 || idx >= len(m.panes) {
		return ""
	}
	return m.panes[idx].Viewport.View()
}

func (m Model) renderHookView() string {
	return m.hookViewport.View()
}

func (m Model) renderSearchBar() string {
	pane := m.activePanePtr()
	matchInfo := ""
	if pane != nil && pane.searchQuery != "" {
		matchInfo = fmt.Sprintf(" %d/%d matches", pane.CurrentMatchIndex(), pane.MatchCount())
	}

	return searchBarStyle.Width(m.width).Render(
		fmt.Sprintf("/ %s%s  %s", m.searchInput.View(), matchInfo, m.help.View(m.searchKeys)),
	)
}

// statusBarHeight returns 2 when the status and hints won't fit on one line, 1 otherwise.
func (m Model) statusBarHeight() int {
	left := m.renderStatusLeft()
	right := m.renderStatusRight()
	if lipgloss.Width(left)+lipgloss.Width(right)+1 > m.width {
		return 2
	}
	return 1
}

func (m Model) renderStatusBar() string {
	barBg := lipgloss.Color("236")
	left := m.renderStatusLeft()
	right := m.renderStatusRight()

	if lipgloss.Width(left)+lipgloss.Width(right)+1 > m.width {
		// Two-line layout: status on top, controls on bottom
		padTop := m.width - lipgloss.Width(left)
		if padTop < 0 {
			padTop = 0
		}
		topLine := left + lipgloss.NewStyle().Background(barBg).Render(strings.Repeat(" ", padTop))

		padBot := m.width - lipgloss.Width(right)
		if padBot < 0 {
			padBot = 0
		}
		botLine := lipgloss.NewStyle().Background(barBg).Render(strings.Repeat(" ", padBot)) + right

		return topLine + "\n" + botLine
	}

	// Single-line layout
	gap := m.width - lipgloss.Width(left) - lipgloss.Width(right)
	if gap < 1 {
		gap = 1
	}
	pad := lipgloss.NewStyle().Background(barBg).Render(strings.Repeat(" ", gap))
	return left + pad + right
}

func (m Model) renderStatusLeft() string {
	barBg := lipgloss.Color("236")
	barFg := lipgloss.Color("250")
	barText := func(s string) string {
		return lipgloss.NewStyle().Foreground(barFg).Background(barBg).Render(s)
	}
	barKey := func(s string) string {
		return lipgloss.NewStyle().Foreground(lipgloss.Color("229")).Background(barBg).Bold(true).Render(s)
	}

	var parts []string
	parts = append(parts, barText("Health: "))
	for i, p := range m.manager.Processes {
		state := p.GetState()

		dotColor := statusColorForState(state)
		if state == process.StateRunning && p.Config.HealthCheck != nil {
			if p.Healthy == nil {
				dotColor = statusStarting
			} else if *p.Healthy {
				dotColor = statusRunning
			} else {
				dotColor = statusErrored
			}
		}
		dot := lipgloss.NewStyle().Foreground(dotColor).Background(barBg).Render("●")

		uptime := ""
		if state == process.StateRunning && !p.StartAt.IsZero() {
			dur := time.Since(p.StartAt).Truncate(time.Second)
			uptime = fmt.Sprintf(" %s", dur)
		}

		parts = append(parts, dot+barText(fmt.Sprintf(" %s%s", p.Config.Name, uptime)))
		if i < len(m.manager.Processes)-1 {
			parts = append(parts, barText("  │  "))
		}
	}
	// Show subscription preset indicator when non-default
	if m.devSettingsPreset != "" && m.devSettingsPreset != "free-trial" {
		parts = append(parts, barText("  \u2502  "))
		parts = append(parts, barKey("[sub: "+m.devSettingsPreset+"]"))
	}

	return strings.Join(parts, "")
}

func (m Model) renderStatusRight() string {
	if m.clickHint {
		barBg := lipgloss.Color("236")
		return lipgloss.NewStyle().Foreground(lipgloss.Color("229")).Background(barBg).Bold(true).
			Render("To select text: hold Shift or Option, or press 'm' to disable mouse mode")
	}

	mouseLabel := "mouse(on)"
	if !m.mouseEnabled {
		mouseLabel = "mouse(off)"
	}
	m.keys.Mouse.SetHelp("m", mouseLabel)

	pane := m.activePanePtr()
	followLabel := "follow(on)"
	if pane == nil || !pane.AutoFollow {
		followLabel = "follow(off)"
	}
	m.keys.Follow.SetHelp("F", followLabel)

	onProcessTab := m.activeTab != 0
	m.keys.Scroll.SetEnabled(onProcessTab)
	m.keys.Search.SetEnabled(onProcessTab)
	m.keys.Follow.SetEnabled(onProcessTab)
	m.keys.NextMatch.SetEnabled(onProcessTab)
	m.keys.PrevMatch.SetEnabled(onProcessTab)

	barBg := lipgloss.Color("236")
	barKey := func(s string) string {
		return lipgloss.NewStyle().Foreground(lipgloss.Color("229")).Background(barBg).Bold(true).Render(s)
	}
	barText := func(s string) string {
		return lipgloss.NewStyle().Foreground(lipgloss.Color("244")).Background(barBg).Render(s)
	}
	sep := barText("  ")

	var parts []string
	for _, b := range m.keys.ShortHelp() {
		if !b.Enabled() {
			continue
		}
		h := b.Help()
		parts = append(parts, barKey(h.Key)+barText(" "+h.Desc))
	}
	return strings.Join(parts, sep)
}

func (m Model) renderQuitConfirm() string {
	title := titleStyle.Render("Quit?")
	body := "All processes will be stopped."
	hints := m.help.View(m.confirmQuitKeys)
	content := title + "\n\n" + body + "\n\n" + hints
	return settingsBoxStyle.Render(content)
}

func statusColorForState(state process.State) color.Color {
	switch state {
	case process.StateRunning:
		return statusRunning
	case process.StateStarting:
		return statusStarting
	case process.StateErrored:
		return statusErrored
	default:
		return statusStopped
	}
}

// truncateHeight ensures rendered output never exceeds maxLines rows.
func truncateHeight(s string, maxLines int) string {
	lines := strings.Split(s, "\n")
	if len(lines) <= maxLines {
		return s
	}
	return strings.Join(lines[:maxLines], "\n")
}

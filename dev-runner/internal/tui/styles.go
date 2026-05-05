package tui

import (
	"charm.land/bubbles/v2/help"
	"charm.land/lipgloss/v2"
)

var (
	statusRunning  = lipgloss.Color("#00ff00")
	statusStarting = lipgloss.Color("#ffff00")
	statusErrored  = lipgloss.Color("#ff0000")
	statusStopped  = lipgloss.Color("#666666")

	activeTabStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("15")).
			Background(lipgloss.Color("62")).
			Padding(0, 2)

	inactiveTabStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("250")).
				Background(lipgloss.Color("236")).
				Padding(0, 2)

	paneHeaderStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("15")).
			Background(lipgloss.Color("240"))

	errorLineStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#ffffff")).
			Background(lipgloss.Color("#8b0000")).
			Bold(true)

	keyHintStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("244"))

	keyStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("229")).
			Bold(true)

	settingsBoxStyle = lipgloss.NewStyle().
				Border(lipgloss.DoubleBorder()).
				BorderForeground(lipgloss.Color("62")).
				Padding(1, 3).
				Background(lipgloss.Color("235"))

	searchBarStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("229")).
			Background(lipgloss.Color("238")).
			Padding(0, 1)

	searchMatchStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("0")).
				Background(lipgloss.Color("229")).
				Bold(true)

	hookTitleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("62"))

	hookOutputStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("250"))

	preflightPassStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("#00ff00"))

	preflightFailStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("#ff0000"))

	preflightWarnStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("#ffff00"))

	preflightSkipStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("#666666"))

	preflightCategoryStyle = lipgloss.NewStyle().
				Bold(true).
				Foreground(lipgloss.Color("62")).
				MarginTop(1)

	preflightHeaderStyle = lipgloss.NewStyle().
				Bold(true).
				Foreground(lipgloss.Color("15")).
				MarginBottom(1)

	preflightFooterStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("244")).
				MarginTop(1)

	preflightFixTitleStyle = lipgloss.NewStyle().
				Bold(true).
				Foreground(lipgloss.Color("62")).
				MarginBottom(1)
)

func helpStyles() help.Styles {
	return help.Styles{
		ShortKey:       keyStyle,
		ShortDesc:      keyHintStyle,
		ShortSeparator: keyHintStyle,
		FullKey:        keyStyle,
		FullDesc:       keyHintStyle,
		FullSeparator:  keyHintStyle,
	}
}

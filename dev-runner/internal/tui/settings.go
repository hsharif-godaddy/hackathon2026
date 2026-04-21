package tui

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/config"
)

// SettingsAction identifies what a settings menu item does.
type SettingsAction int

const (
	ActionRestartAll SettingsAction = iota
	ActionRestartProcess
	ActionClearLogs
	ActionClearErrors
	ActionExit
)

// SettingsItem is one entry in the settings menu.
type SettingsItem struct {
	Label        string
	Action       SettingsAction
	ProcessIndex int
}

func buildSettingsItems(cfg *config.Config) []SettingsItem {
	items := []SettingsItem{
		{Label: "Restart All (re-run hooks)", Action: ActionRestartAll},
	}
	for i, p := range cfg.Processes {
		items = append(items, SettingsItem{
			Label:        fmt.Sprintf("Restart %s", p.Name),
			Action:       ActionRestartProcess,
			ProcessIndex: i,
		})
	}
	items = append(items,
		SettingsItem{Label: "Clear All Logs", Action: ActionClearLogs},
		SettingsItem{Label: "Clear Error Alerts", Action: ActionClearErrors},
		SettingsItem{Label: "Exit", Action: ActionExit},
	)
	return items
}

func (m Model) renderSettings() string {
	title := titleStyle.Render("⚙  Settings")

	var items []string
	for i, item := range m.settingsItems {
		if i == m.settingsCursor {
			items = append(items, settingsSelectedStyle.Render("> "+item.Label))
		} else {
			items = append(items, settingsItemStyle.Render("  "+item.Label))
		}
	}

	content := title + "\n\n" + strings.Join(items, "\n") + "\n\n" +
		m.help.View(m.settingsKeys)

	box := settingsBoxStyle.Render(content)
	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, box)
}

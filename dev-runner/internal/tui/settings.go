package tui

import (
	"fmt"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

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

// openSettings builds a huh.Select over the settings items, bound by index.
func (m *Model) openSettings() tea.Cmd {
	if len(m.settingsItems) == 0 {
		return nil
	}
	var selected int
	opts := make([]huh.Option[int], len(m.settingsItems))
	for i, item := range m.settingsItems {
		opts[i] = huh.NewOption(item.Label, i)
	}
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[int]().
				Title("⚙  Settings").
				Options(opts...).
				Value(&selected),
		),
	).WithShowHelp(true)

	m.settingsForm = m.applyModalForm(form)
	m.settingsValue = &selected
	return m.settingsForm.Init()
}

func (m *Model) updateSettings(msg tea.Msg) tea.Cmd {
	if m.settingsForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.settingsForm, cmd = stepForm(m.settingsForm, msg)

	switch m.settingsForm.State {
	case huh.StateCompleted:
		if m.settingsValue == nil {
			m.closeSettings()
			return nil
		}
		idx := *m.settingsValue
		m.closeSettings()
		return m.executeSettingsAction(idx)
	case huh.StateAborted:
		m.closeSettings()
		return nil
	}
	return cmd
}

func (m *Model) closeSettings() {
	m.settingsForm = nil
	m.settingsValue = nil
}

func (m Model) renderSettings() string {
	if m.settingsForm == nil {
		return ""
	}
	return settingsBoxStyle.Render(m.settingsForm.View())
}

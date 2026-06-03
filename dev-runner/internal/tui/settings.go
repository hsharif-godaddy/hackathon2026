package tui

import (
	"fmt"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

	"github.com/airo-ai-builder/dev-runner/internal/config"
	"github.com/airo-ai-builder/dev-runner/internal/e2e"
)

// SettingsAction identifies what a settings menu item does.
type SettingsAction int

const (
	ActionRestartAll SettingsAction = iota
	ActionRestartProcess
	ActionClearLogs
	ActionClearErrors
	ActionRunE2E
	ActionStopE2E
	ActionCleanRestart
	ActionExit
)

// SettingsItem is one entry in the settings menu.
type SettingsItem struct {
	Label        string
	Action       SettingsAction
	ProcessIndex int
}

// buildSettingsItems constructs the static menu (no e2e state). Use
// (Model).buildSettingsItemsForOpen to get a state-aware list with the right
// E2E entry (Run vs Stop) at the moment the menu is opened.
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
		SettingsItem{Label: "Clean + Restart...", Action: ActionCleanRestart},
		SettingsItem{Label: "Run E2E Tests...", Action: ActionRunE2E},
		SettingsItem{Label: "Exit", Action: ActionExit},
	)
	return items
}

// openSettings builds a huh.Select over the settings items, bound by index.
func (m *Model) openSettings() tea.Cmd {
	// Rebuild from base items so the E2E entry reflects the current runner
	// state (running → "Stop", otherwise → "Run...").
	m.settingsItems = m.buildSettingsItemsForOpen()
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

// buildSettingsItemsForOpen returns the settings items with a state-aware E2E
// entry. Called from openSettings each time the menu is opened so the label
// reflects the runner's state at that moment.
func (m *Model) buildSettingsItemsForOpen() []SettingsItem {
	items := buildSettingsItems(m.config)

	// Replace the static Run-E2E entry with Stop-E2E when a run is in flight.
	// Find by Action so future menu re-orderings don't break the swap.
	for i, item := range items {
		if item.Action == ActionRunE2E && m.e2eRunner.GetState() == e2e.StateRunning {
			items[i] = SettingsItem{Label: "Stop E2E Tests", Action: ActionStopE2E}
			break
		}
	}
	return items
}

package tui

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
)

type subscriptionPreset struct {
	Name   string
	Label  string
	Fields map[string]any
}

var subscriptionPresets = []subscriptionPreset{
	{"free-trial", "Free Trial", map[string]any{"isTrial": true, "plan": "free", "status": "active", "reason": "", "tokenBudgetId": "trial"}},
	{"starter", "Starter", map[string]any{"isTrial": false, "plan": "starter", "status": "active", "reason": "", "tokenBudgetId": "airo-plus"}},
	{"professional", "Professional", map[string]any{"isTrial": false, "plan": "professional", "status": "active", "reason": "", "tokenBudgetId": "airo-plus"}},
	{"suspended-payment", "Suspended (Non-Payment)", map[string]any{"isTrial": false, "plan": "starter", "status": "suspended", "reason": "NON_PAYMENT", "tokenBudgetId": "airo-plus"}},
	{"suspended-policy", "Suspended (Policy)", map[string]any{"isTrial": false, "plan": "starter", "status": "suspended", "reason": "POLICY", "tokenBudgetId": "airo-plus"}},
	{"cancelled", "Cancelled", map[string]any{"isTrial": false, "plan": "starter", "status": "cancelled", "reason": "", "tokenBudgetId": "airo-plus"}},
}

func presetByName(name string) *subscriptionPreset {
	for i, p := range subscriptionPresets {
		if p.Name == name {
			return &subscriptionPresets[i]
		}
	}
	return nil
}

// openDevSettings constructs a huh.Select form pre-pointed at the current
// preset and stores it on the model.
func (m *Model) openDevSettings() tea.Cmd {
	value := m.devSettingsPreset
	if value == "" {
		value = subscriptionPresets[0].Name
	}

	opts := make([]huh.Option[string], len(subscriptionPresets))
	for i, p := range subscriptionPresets {
		opts[i] = huh.NewOption(p.Label, p.Name)
	}

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Dev Settings - Subscription Plan").
				Description("Select a preset to apply to the local control plane.").
				Options(opts...).
				Value(&value),
		),
	).WithShowHelp(true)

	m.devSettingsForm = m.applyModalForm(form)
	m.devSettingsValue = &value
	return m.devSettingsForm.Init()
}

func (m Model) renderDevSettings() string {
	if m.devSettingsForm == nil {
		return ""
	}
	content := m.devSettingsForm.View()
	if m.devSettingsError != "" {
		content += "\n\n" + errorLineStyle.Render(" "+m.devSettingsError+" ")
	}
	return settingsBoxStyle.Render(content)
}

func (m *Model) updateDevSettings(msg tea.Msg) tea.Cmd {
	if m.devSettingsForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.devSettingsForm, cmd = stepForm(m.devSettingsForm, msg)

	switch m.devSettingsForm.State {
	case huh.StateCompleted:
		if m.devSettingsValue == nil {
			m.closeDevSettings()
			return nil
		}
		selected := *m.devSettingsValue
		m.closeDevSettings()
		if selected == m.devSettingsPreset {
			return nil
		}
		if p := presetByName(selected); p != nil {
			return applyPresetCmd(m.controlPlaneBaseURL, *p)
		}
		return nil
	case huh.StateAborted:
		m.closeDevSettings()
		return nil
	}
	return cmd
}

func (m *Model) closeDevSettings() {
	m.devSettingsForm = nil
	m.devSettingsValue = nil
}

func fetchDefaultSubscriptionID(baseURL string) (string, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(baseURL + "/api/airo/v1/subscriptions")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var subs []struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&subs); err != nil {
		return "", err
	}
	if len(subs) == 0 {
		return "", fmt.Errorf("no subscriptions found")
	}
	return subs[0].ID, nil
}

func applyPresetCmd(baseURL string, preset subscriptionPreset) tea.Cmd {
	return func() tea.Msg {
		subID, err := fetchDefaultSubscriptionID(baseURL)
		if err != nil {
			return devSettingsPresetMsg{Preset: preset.Name, Err: fmt.Errorf("fetch subscription: %w", err)}
		}

		body, _ := json.Marshal(preset.Fields)
		url := baseURL + "/api/airo/v1/subscriptions/" + subID

		req, err := http.NewRequest(http.MethodPatch, url, bytes.NewReader(body))
		if err != nil {
			return devSettingsPresetMsg{Preset: preset.Name, Err: err}
		}
		req.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return devSettingsPresetMsg{Preset: preset.Name, Err: err}
		}
		resp.Body.Close()

		if resp.StatusCode >= 300 {
			return devSettingsPresetMsg{Preset: preset.Name, Err: fmt.Errorf("HTTP %d", resp.StatusCode)}
		}
		return devSettingsPresetMsg{Preset: preset.Name}
	}
}

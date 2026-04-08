package tui

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
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

func (m Model) renderDevSettings() string {
	title := titleStyle.Render("Dev Settings")

	section := devSettingsSectionTitle.Render("Subscription Plan")

	var items []string
	for i, p := range subscriptionPresets {
		active := p.Name == m.devSettingsPreset
		focused := i == m.devSettingsCursor

		var radio string
		if active {
			radio = devSettingsRadioActive.Render("●")
		} else {
			radio = devSettingsRadioInactive.Render("○")
		}

		var label string
		if focused {
			label = devSettingsCursorStyle.Render(p.Label)
		} else if active {
			label = devSettingsRadioActive.Render(p.Label)
		} else {
			label = devSettingsRadioInactive.Render(p.Label)
		}

		items = append(items, fmt.Sprintf("  %s %s", radio, label))
	}

	hints := keyHintStyle.Render(
		keyStyle.Render("j/k") + " " + keyHintStyle.Render("navigate") + "  " +
			keyStyle.Render("Enter") + " " + keyHintStyle.Render("apply") + "  " +
			keyStyle.Render("Esc") + " " + keyHintStyle.Render("close"),
	)

	content := title + "\n\n" + section + "\n\n" + strings.Join(items, "\n") + "\n\n" + hints
	if m.devSettingsError != "" {
		content += "\n\n" + errorLineStyle.Render(" "+m.devSettingsError+" ")
	}
	return settingsBoxStyle.Render(content)
}

func (m *Model) handleDevSettingsKey(msg tea.KeyPressMsg) tea.Cmd {
	key := msg.String()
	switch key {
	case "esc", "d":
		m.devSettingsOpen = false
		return nil
	case "j", "down":
		m.devSettingsCursor = (m.devSettingsCursor + 1) % len(subscriptionPresets)
	case "k", "up":
		m.devSettingsCursor--
		if m.devSettingsCursor < 0 {
			m.devSettingsCursor = len(subscriptionPresets) - 1
		}
	case "enter":
		preset := subscriptionPresets[m.devSettingsCursor]
		if preset.Name == m.devSettingsPreset {
			return nil
		}
		m.devSettingsOpen = false
		// PATCH /api/airo/v1/subscriptions/local-sub-001 (must match store.DefaultSubscriptionID)
		return applyPresetCmd(m.controlPlaneBaseURL, preset)
	}
	return nil
}

func applyPresetCmd(baseURL string, preset subscriptionPreset) tea.Cmd {
	return func() tea.Msg {
		body, _ := json.Marshal(preset.Fields)
		url := baseURL + "/api/airo/v1/subscriptions/local-sub-001"

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

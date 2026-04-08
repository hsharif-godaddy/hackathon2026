package tui

import (
	"context"
	"fmt"
	"strings"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/preflight/fixers"
)

// envFormField is a single input field in the inline env form.
type envFormField struct {
	Label       string
	Description string
	Input       textinput.Model
}

// initEnvForm sets up the inline form fields for an EnvFixer.
func (m *Model) initEnvForm(ef *fixers.EnvFixer) {
	defaults := fixers.DefaultEnvValues()
	m.envFormFixer = ef

	apiKey := textinput.New()
	apiKey.Placeholder = "sk-..."
	apiKey.EchoMode = textinput.EchoPassword
	apiKey.CharLimit = 200
	apiKey.SetValue(defaults.APIKey)
	apiKey.Focus()

	baseURL := textinput.New()
	baseURL.CharLimit = 200
	baseURL.SetValue(defaults.BaseURL)

	model := textinput.New()
	model.CharLimit = 100
	model.SetValue(defaults.Model)

	authType := textinput.New()
	authType.CharLimit = 10
	authType.SetValue(defaults.AuthType)

	m.envFormFields = []envFormField{
		{Label: "GoCode API Key", Description: "Get your key at: https://caas.open-webui.godaddy.com/workspace/apiKeys", Input: apiKey},
		{Label: "GoCode Base URL", Input: baseURL},
		{Label: "AI Model", Input: model},
		{Label: "Auth Type (jwt/mock/none)", Input: authType},
	}
	m.envFormCursor = 0
}

// handleEnvFormKey processes key presses during the env form phase.
func (m *Model) handleEnvFormKey(msg tea.KeyPressMsg) tea.Cmd {
	n := len(m.envFormFields)
	if n == 0 {
		return nil
	}

	// Check for shift+tab via string (modifier + key)
	if msg.String() == "shift+tab" {
		m.envFormFields[m.envFormCursor].Input.Blur()
		m.envFormCursor--
		if m.envFormCursor < 0 {
			m.envFormCursor = n - 1
		}
		m.envFormFields[m.envFormCursor].Input.Focus()
		return nil
	}

	switch msg.Code {
	case tea.KeyEscape:
		m.phase = PhasePreflightDashboard
		return nil
	case tea.KeyTab, tea.KeyDown:
		m.envFormFields[m.envFormCursor].Input.Blur()
		m.envFormCursor = (m.envFormCursor + 1) % n
		m.envFormFields[m.envFormCursor].Input.Focus()
		return nil
	case tea.KeyUp:
		m.envFormFields[m.envFormCursor].Input.Blur()
		m.envFormCursor--
		if m.envFormCursor < 0 {
			m.envFormCursor = n - 1
		}
		m.envFormFields[m.envFormCursor].Input.Focus()
		return nil
	case tea.KeyEnter:
		if m.envFormCursor < n-1 {
			m.envFormFields[m.envFormCursor].Input.Blur()
			m.envFormCursor++
			m.envFormFields[m.envFormCursor].Input.Focus()
			return nil
		}
		return m.submitEnvForm()
	}

	// Pass key to active textinput
	var cmd tea.Cmd
	m.envFormFields[m.envFormCursor].Input, cmd = m.envFormFields[m.envFormCursor].Input.Update(msg)
	return cmd
}

// submitEnvForm collects values from the form fields and continues fixing.
func (m *Model) submitEnvForm() tea.Cmd {
	apiKey := strings.TrimSpace(m.envFormFields[0].Input.Value())
	if apiKey == "" {
		m.preflightFixStatus = "API key is required"
		return nil
	}

	values := &fixers.EnvValues{
		APIKey:   apiKey,
		BaseURL:  strings.TrimSpace(m.envFormFields[1].Input.Value()),
		Model:    strings.TrimSpace(m.envFormFields[2].Input.Value()),
		AuthType: strings.TrimSpace(m.envFormFields[3].Input.Value()),
	}

	m.envFormFixer.Values = values
	m.phase = PhasePreflightFixing
	m.preflightFixStatus = "Fixing: " + m.preflightFixQueue[m.preflightFixIndex].Check.Name() + "..."

	// Run the fixer now that Values is set
	fixer := m.envFormFixer
	projectRoot := m.projectRoot
	name := m.preflightFixQueue[m.preflightFixIndex].Check.Name()
	return func() tea.Msg {
		err := fixer.Fix(context.Background(), projectRoot)
		return preflightFixDoneMsg{Err: err, FixerName: name}
	}
}

// renderPreflightEnvForm renders the inline env configuration form.
func (m Model) renderPreflightEnvForm() string {
	var b strings.Builder

	b.WriteString(preflightHeaderStyle.Render("Environment Configuration"))
	b.WriteString("\n\n")

	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("244"))
	activeLabel := lipgloss.NewStyle().Foreground(lipgloss.Color("15")).Bold(true)
	inactiveLabel := lipgloss.NewStyle().Foreground(lipgloss.Color("250"))

	for i, field := range m.envFormFields {
		isActive := i == m.envFormCursor

		// Label
		if isActive {
			b.WriteString(fmt.Sprintf("  %s %s\n", activeLabel.Render("›"), activeLabel.Render(field.Label)))
		} else {
			b.WriteString(fmt.Sprintf("    %s\n", inactiveLabel.Render(field.Label)))
		}

		// Description (only on active field if present)
		if isActive && field.Description != "" {
			b.WriteString(fmt.Sprintf("    %s\n", dimStyle.Italic(true).Render(field.Description)))
		}

		// Input field
		if isActive {
			b.WriteString(fmt.Sprintf("    %s\n", field.Input.View()))
		} else {
			val := field.Input.Value()
			if field.Input.EchoMode == textinput.EchoPassword && val != "" {
				val = strings.Repeat("•", min(len(val), 20))
			}
			if val == "" {
				val = dimStyle.Render("(empty)")
			}
			b.WriteString(fmt.Sprintf("    %s\n", dimStyle.Render(val)))
		}
		b.WriteString("\n")
	}

	if m.preflightFixStatus != "" && strings.HasPrefix(m.preflightFixStatus, "API key") {
		b.WriteString(preflightFailStyle.Render("  " + m.preflightFixStatus))
		b.WriteString("\n\n")
	}

	b.WriteString(preflightFooterStyle.Render(
		"tab/↓: next field  ↑: prev field  enter: submit  esc: cancel"))

	return b.String()
}

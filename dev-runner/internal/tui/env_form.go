package tui

import (
	"context"
	"fmt"
	"strings"

	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// envFormField is a single input field in the inline form.
type envFormField struct {
	Key         string
	Label       string
	Description string
	Required    bool
	Input       textinput.Model
}

// initFixerForm sets up the inline form fields from a FormFixer's declarations.
func (m *Model) initFixerForm(ff preflight.FormFixer) {
	m.formFixer = ff
	fields := ff.FormFields()

	m.envFormFields = make([]envFormField, len(fields))
	for i, f := range fields {
		ti := textinput.New()
		if f.Placeholder != "" {
			ti.Placeholder = f.Placeholder
		}
		if f.Password {
			ti.EchoMode = textinput.EchoPassword
		}
		ti.CharLimit = 200
		if f.Default != "" {
			ti.SetValue(f.Default)
		}
		if i == 0 {
			ti.Focus()
		}
		m.envFormFields[i] = envFormField{
			Key:         f.Key,
			Label:       f.Label,
			Description: f.Description,
			Required:    f.Required,
			Input:       ti,
		}
	}
	m.envFormCursor = 0
}

// handleEnvFormKey processes key presses during the env form phase.
func (m *Model) handleEnvFormKey(msg tea.KeyPressMsg) tea.Cmd {
	n := len(m.envFormFields)
	if n == 0 {
		return nil
	}

	switch {
	case key.Matches(msg, m.envFormKeys.Cancel):
		m.phase = PhasePreflightDashboard
		return nil
	case key.Matches(msg, m.envFormKeys.NextField):
		m.envFormFields[m.envFormCursor].Input.Blur()
		m.envFormCursor = (m.envFormCursor + 1) % n
		m.envFormFields[m.envFormCursor].Input.Focus()
		return nil
	case key.Matches(msg, m.envFormKeys.PrevField):
		m.envFormFields[m.envFormCursor].Input.Blur()
		m.envFormCursor--
		if m.envFormCursor < 0 {
			m.envFormCursor = n - 1
		}
		m.envFormFields[m.envFormCursor].Input.Focus()
		return nil
	case key.Matches(msg, m.envFormKeys.Submit):
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
	// Validate required fields
	for _, f := range m.envFormFields {
		if f.Required && strings.TrimSpace(f.Input.Value()) == "" {
			m.preflightFixStatus = f.Label + " is required"
			return nil
		}
	}

	// Build key-value map and pass to fixer
	values := make(map[string]string, len(m.envFormFields))
	for _, f := range m.envFormFields {
		values[f.Key] = f.Input.Value()
	}
	m.formFixer.SetFormValues(values)

	m.phase = PhasePreflightFixing
	m.preflightFixStatus = "Fixing: " + m.preflightFixQueue[m.preflightFixIndex].Check.Name() + "..."

	fixer := m.formFixer
	projectRoot := m.projectRoot
	name := m.preflightFixQueue[m.preflightFixIndex].Check.Name()
	return tea.Batch(
		func() tea.Msg {
			err := fixer.Fix(context.Background(), projectRoot)
			return preflightFixDoneMsg{Err: err, FixerName: name}
		},
		m.spinner.Tick,
	)
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

	if m.preflightFixStatus != "" && strings.HasSuffix(m.preflightFixStatus, "is required") {
		b.WriteString(preflightFailStyle.Render("  " + m.preflightFixStatus))
		b.WriteString("\n\n")
	}

	b.WriteString(preflightFooterStyle.Render(m.help.View(m.envFormKeys)))

	return b.String()
}

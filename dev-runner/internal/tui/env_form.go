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
	Options     []string // when set, left/right cycles options instead of free text
	OptionIndex int
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
		optionIndex := 0
		if len(f.Options) > 0 {
			for j, opt := range f.Options {
				if opt == f.Default {
					optionIndex = j
					break
				}
			}
			ti.SetValue(f.Options[optionIndex])
		}
		m.envFormFields[i] = envFormField{
			Key:         f.Key,
			Label:       f.Label,
			Description: f.Description,
			Required:    f.Required,
			Input:       ti,
			Options:     f.Options,
			OptionIndex: optionIndex,
		}
	}
	m.envFormCursor = 0
}

// isFieldHidden reports whether a field should be hidden based on the current
// value of sibling fields. Currently: apiKey and baseURL are hidden when
// gocodeAuth is set to "s2s" (the values are unused in that mode).
func (m *Model) isFieldHidden(f envFormField) bool {
	if f.Key != "apiKey" && f.Key != "baseURL" {
		return false
	}
	for _, ff := range m.envFormFields {
		if ff.Key == "gocodeAuth" {
			return strings.TrimSpace(ff.Input.Value()) == "s2s"
		}
	}
	return false
}

// nextVisibleField returns the next cursor index whose field is visible,
// wrapping around. Returns -1 if no field is visible (shouldn't happen).
func (m *Model) nextVisibleField(from, step int) int {
	n := len(m.envFormFields)
	if n == 0 {
		return -1
	}
	i := from
	for range n {
		i = (i + step + n) % n
		if !m.isFieldHidden(m.envFormFields[i]) {
			return i
		}
	}
	return -1
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
		next := m.nextVisibleField(m.envFormCursor, 1)
		if next >= 0 && next != m.envFormCursor {
			m.envFormFields[m.envFormCursor].Input.Blur()
			m.envFormCursor = next
			m.envFormFields[m.envFormCursor].Input.Focus()
		}
		return nil
	case key.Matches(msg, m.envFormKeys.PrevField):
		prev := m.nextVisibleField(m.envFormCursor, -1)
		if prev >= 0 && prev != m.envFormCursor {
			m.envFormFields[m.envFormCursor].Input.Blur()
			m.envFormCursor = prev
			m.envFormFields[m.envFormCursor].Input.Focus()
		}
		return nil
	case key.Matches(msg, m.envFormKeys.Submit):
		next := m.nextVisibleField(m.envFormCursor, 1)
		if next > m.envFormCursor {
			m.envFormFields[m.envFormCursor].Input.Blur()
			m.envFormCursor = next
			m.envFormFields[m.envFormCursor].Input.Focus()
			return nil
		}
		return m.submitEnvForm()
	}

	// Options field: cycle with left/right, block free text
	active := &m.envFormFields[m.envFormCursor]
	if len(active.Options) > 0 {
		switch msg.String() {
		case "left", "h":
			active.OptionIndex = (active.OptionIndex - 1 + len(active.Options)) % len(active.Options)
			active.Input.SetValue(active.Options[active.OptionIndex])
		case "right", "l":
			active.OptionIndex = (active.OptionIndex + 1) % len(active.Options)
			active.Input.SetValue(active.Options[active.OptionIndex])
		}
		// Changing an option may toggle visibility of sibling fields; if the
		// cursor landed on a now-hidden field, advance it.
		if m.isFieldHidden(m.envFormFields[m.envFormCursor]) {
			next := m.nextVisibleField(m.envFormCursor, 1)
			if next >= 0 {
				m.envFormFields[m.envFormCursor].Input.Blur()
				m.envFormCursor = next
				m.envFormFields[m.envFormCursor].Input.Focus()
			}
		}
		return nil
	}

	var cmd tea.Cmd
	m.envFormFields[m.envFormCursor].Input, cmd = m.envFormFields[m.envFormCursor].Input.Update(msg)
	return cmd
}

// submitEnvForm collects values from the form fields and continues fixing.
func (m *Model) submitEnvForm() tea.Cmd {
	// Validate required fields (skip hidden ones - their values are not used)
	for _, f := range m.envFormFields {
		if m.isFieldHidden(f) {
			continue
		}
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
		if m.isFieldHidden(field) {
			continue
		}
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
		if len(field.Options) > 0 {
			// Render as option selector: < opt1 | opt2 | opt3 >
			var opts []string
			selectedStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("14")).Bold(true)
			for j, opt := range field.Options {
				if j == field.OptionIndex {
					opts = append(opts, selectedStyle.Render(opt))
				} else {
					opts = append(opts, dimStyle.Render(opt))
				}
			}
			selector := strings.Join(opts, dimStyle.Render(" | "))
			if isActive {
				b.WriteString(fmt.Sprintf("    %s %s %s\n", dimStyle.Render("<"), selector, dimStyle.Render(">")))
			} else {
				b.WriteString(fmt.Sprintf("    %s\n", field.Options[field.OptionIndex]))
			}
		} else if isActive {
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

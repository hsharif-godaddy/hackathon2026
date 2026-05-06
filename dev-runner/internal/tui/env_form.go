package tui

import (
	"context"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// envFormBuilder maps a FormFixer's declarative fields to a huh.Form.
// Fields are split into groups so conditional visibility (apiKey/baseURL are
// hidden when gocodeAuth=s2s) can be expressed with huh's group-level HideFunc.
type envFormBuilder struct {
	// values holds pointers bound to huh fields. Keyed by FormField.Key so
	// submitEnvForm can collect them for the fixer.
	values map[string]*string
}

// conditionalKeys are field keys that are only relevant in api-key mode.
// Kept as a set so changes are easy to reason about.
var conditionalKeys = map[string]bool{
	"apiKey":  true,
	"baseURL": true,
}

// initFixerForm builds a huh.Form from a FormFixer's field declarations and
// stores it on the model.
func (m *Model) initFixerForm(ff preflight.FormFixer) {
	m.formFixer = ff
	fields := ff.FormFields()

	b := &envFormBuilder{values: make(map[string]*string, len(fields))}
	for _, f := range fields {
		val := f.Default
		b.values[f.Key] = &val
	}

	mainFields := make([]huh.Field, 0, len(fields))
	condFields := make([]huh.Field, 0, 2)
	for _, f := range fields {
		field := b.fieldFor(f)
		if conditionalKeys[f.Key] {
			condFields = append(condFields, field)
		} else {
			mainFields = append(mainFields, field)
		}
	}

	groups := []*huh.Group{huh.NewGroup(mainFields...)}
	if len(condFields) > 0 {
		gocodeAuth := b.values["gocodeAuth"]
		groups = append(groups, huh.NewGroup(condFields...).
			WithHideFunc(func() bool {
				return gocodeAuth != nil && strings.TrimSpace(*gocodeAuth) == "s2s"
			}))
	}

	form := huh.NewForm(groups...).
		WithShowHelp(true).
		WithShowErrors(true)

	m.envForm = m.applyInlineForm(form)
	m.envFormBuilder = b
}

// envFormInit returns the initial tea.Cmd for the active env form so callers
// can feed it into the tea runtime at phase entry.
func (m *Model) envFormInit() tea.Cmd {
	if m.envForm == nil {
		return nil
	}
	return m.envForm.Init()
}

// buildSelectOptions pairs each option value with its display label, applying
// OptionLabels overrides when present. A nil or shorter labels slice and
// empty-string entries both fall back to the option value as the label.
func buildSelectOptions(options, labels []string) []huh.Option[string] {
	opts := make([]huh.Option[string], len(options))
	for i, opt := range options {
		label := opt
		if i < len(labels) && labels[i] != "" {
			label = labels[i]
		}
		opts[i] = huh.NewOption(label, opt)
	}
	return opts
}

// fieldFor returns a huh field bound to builder.values[f.Key]. Fields with
// Options render as a Select; the rest render as an Input.
func (b *envFormBuilder) fieldFor(f preflight.FormField) huh.Field {
	val := b.values[f.Key]
	if len(f.Options) > 0 {
		return huh.NewSelect[string]().
			Key(f.Key).
			Title(f.Label).
			Description(f.Description).
			Options(buildSelectOptions(f.Options, f.OptionLabels)...).
			Value(val)
	}
	input := huh.NewInput().
		Key(f.Key).
		Title(f.Label).
		Description(f.Description).
		Placeholder(f.Placeholder).
		Value(val)
	if f.Password {
		input = input.EchoMode(huh.EchoModePassword)
	}
	if f.Required {
		input = input.Validate(requiredValidator(f.Label))
	}
	return input
}

func requiredValidator(label string) func(string) error {
	return func(s string) error {
		if strings.TrimSpace(s) == "" {
			return &requiredFieldError{label: label}
		}
		return nil
	}
}

type requiredFieldError struct{ label string }

func (e *requiredFieldError) Error() string { return e.label + " is required" }

// updateEnvForm forwards a message to the embedded huh form and reacts to
// state transitions. Returns the command produced by the form plus any
// follow-up command triggered by form completion/abort.
func (m *Model) updateEnvForm(msg tea.Msg) tea.Cmd {
	if m.envForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.envForm, cmd = stepForm(m.envForm, msg)

	switch m.envForm.State {
	case huh.StateCompleted:
		return m.submitEnvForm()
	case huh.StateAborted:
		m.envForm = nil
		m.envFormBuilder = nil
		m.formFixer = nil
		m.phase = PhasePreflightDashboard
		return nil
	}
	return cmd
}

// submitEnvForm collects values from the huh form and hands them to the fixer.
func (m *Model) submitEnvForm() tea.Cmd {
	values := make(map[string]string, len(m.envFormBuilder.values))
	for k, v := range m.envFormBuilder.values {
		values[k] = *v
	}
	m.formFixer.SetFormValues(values)

	m.envForm = nil
	m.envFormBuilder = nil

	if m.preflightFixIndex >= len(m.preflightFixQueue) {
		m.formFixer = nil
		m.phase = PhasePreflightDashboard
		return nil
	}

	m.phase = PhasePreflightFixing
	name := m.preflightFixQueue[m.preflightFixIndex].Check.Name()
	m.preflightFixStatus = "Fixing: " + name + "..."

	fixer := m.formFixer
	projectRoot := m.projectRoot
	return tea.Batch(
		func() tea.Msg {
			err := fixer.Fix(context.Background(), projectRoot)
			return preflightFixDoneMsg{Err: err, FixerName: name}
		},
		m.spinner.Tick,
	)
}

// renderPreflightEnvForm renders the inline env configuration form by
// delegating to the embedded huh form.
func (m Model) renderPreflightEnvForm() string {
	var b strings.Builder
	b.WriteString(preflightHeaderStyle.Render("Environment Configuration"))
	b.WriteString("\n\n")
	if m.envForm != nil {
		b.WriteString(m.envForm.View())
	}
	return b.String()
}

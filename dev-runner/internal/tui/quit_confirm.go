package tui

import (
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
)

// openQuitConfirm builds a huh.Confirm form for the "Quit?" dialog. The form
// is stored on the model and drives the modal until the user answers.
func (m *Model) openQuitConfirm() tea.Cmd {
	var answer bool
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewConfirm().
				Title("Quit?").
				Description("All processes will be stopped.").
				Affirmative("Quit").
				Negative("Cancel").
				Value(&answer),
		),
	).WithShowHelp(true)

	m.quitConfirmForm = m.applyModalForm(form)
	m.quitConfirmValue = &answer
	return m.quitConfirmForm.Init()
}

func (m *Model) updateQuitConfirm(msg tea.Msg) tea.Cmd {
	if m.quitConfirmForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.quitConfirmForm, cmd = stepForm(m.quitConfirmForm, msg)

	switch m.quitConfirmForm.State {
	case huh.StateCompleted:
		confirmed := m.quitConfirmValue != nil && *m.quitConfirmValue
		m.quitConfirmForm = nil
		m.quitConfirmValue = nil
		if confirmed {
			m.quitting = true
			return m.shutdownCmd()
		}
		return nil
	case huh.StateAborted:
		m.quitConfirmForm = nil
		m.quitConfirmValue = nil
		return nil
	}
	return cmd
}

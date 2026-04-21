package tui

import "charm.land/bubbles/v2/key"

// RunningKeyMap defines keybindings for the main process-viewing phase.
type RunningKeyMap struct {
	Quit       key.Binding
	Tab        key.Binding
	ShiftTab   key.Binding
	All        key.Binding
	Proc1      key.Binding
	Proc2      key.Binding
	Proc3      key.Binding
	Mouse      key.Binding
	Follow     key.Binding
	Search     key.Binding
	NextMatch  key.Binding
	PrevMatch  key.Binding
	DevSetting key.Binding
	Settings   key.Binding
	Scroll     key.Binding
	Top        key.Binding
	Bottom     key.Binding
	ClearErr   key.Binding
}

func NewRunningKeyMap() RunningKeyMap {
	return RunningKeyMap{
		Quit:       key.NewBinding(key.WithKeys("q"), key.WithHelp("q", "quit")),
		Tab:        key.NewBinding(key.WithKeys("tab"), key.WithHelp("Tab", "next tab")),
		ShiftTab:   key.NewBinding(key.WithKeys("shift+tab"), key.WithHelp("S-Tab", "prev tab")),
		All:        key.NewBinding(key.WithKeys("0", "a"), key.WithHelp("0/a", "all")),
		Proc1:      key.NewBinding(key.WithKeys("1"), key.WithHelp("1", "proc 1")),
		Proc2:      key.NewBinding(key.WithKeys("2"), key.WithHelp("2", "proc 2")),
		Proc3:      key.NewBinding(key.WithKeys("3"), key.WithHelp("3", "proc 3")),
		Mouse:      key.NewBinding(key.WithKeys("m"), key.WithHelp("m", "mouse(on)")),
		Follow:     key.NewBinding(key.WithKeys("F"), key.WithHelp("F", "follow(on)")),
		Search:     key.NewBinding(key.WithKeys("/"), key.WithHelp("/", "search")),
		NextMatch:  key.NewBinding(key.WithKeys("n"), key.WithHelp("n", "next match")),
		PrevMatch:  key.NewBinding(key.WithKeys("N"), key.WithHelp("N", "prev match")),
		DevSetting: key.NewBinding(key.WithKeys("d"), key.WithHelp("d", "dev settings")),
		Settings:   key.NewBinding(key.WithKeys("s", "?"), key.WithHelp("s", "settings")),
		Scroll:     key.NewBinding(key.WithKeys("up", "down"), key.WithHelp("up/dn", "scroll")),
		Top:        key.NewBinding(key.WithKeys("g"), key.WithHelp("g", "top")),
		Bottom:     key.NewBinding(key.WithKeys("G"), key.WithHelp("G", "bottom")),
		ClearErr:   key.NewBinding(key.WithKeys("esc"), key.WithHelp("Esc", "clear")),
	}
}

func (k RunningKeyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Tab, k.Mouse, k.DevSetting, k.Settings, k.Scroll, k.Search, k.Follow, k.ClearErr, k.Quit}
}

func (k RunningKeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{k.ShortHelp()}
}

// SearchKeyMap defines keybindings during search mode.
type SearchKeyMap struct {
	Close   key.Binding
	Confirm key.Binding
	Next    key.Binding
	Prev    key.Binding
}

func NewSearchKeyMap() SearchKeyMap {
	return SearchKeyMap{
		Close:   key.NewBinding(key.WithKeys("esc"), key.WithHelp("Esc", "close")),
		Confirm: key.NewBinding(key.WithKeys("enter"), key.WithHelp("Enter", "find")),
		Next:    key.NewBinding(key.WithKeys("ctrl+n"), key.WithHelp("C-n", "next")),
		Prev:    key.NewBinding(key.WithKeys("ctrl+p"), key.WithHelp("C-p", "prev")),
	}
}

func (k SearchKeyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Next, k.Prev, k.Close}
}

func (k SearchKeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{k.ShortHelp()}
}

// SettingsKeyMap defines keybindings for the settings overlay.
type SettingsKeyMap struct {
	Close key.Binding
	Down  key.Binding
	Up    key.Binding
	Enter key.Binding
}

func NewSettingsKeyMap() SettingsKeyMap {
	return SettingsKeyMap{
		Close: key.NewBinding(key.WithKeys("esc", "s", "?"), key.WithHelp("Esc", "close")),
		Down:  key.NewBinding(key.WithKeys("j", "down"), key.WithHelp("j/k", "navigate")),
		Up:    key.NewBinding(key.WithKeys("k", "up")),
		Enter: key.NewBinding(key.WithKeys("enter"), key.WithHelp("Enter", "select")),
	}
}

func (k SettingsKeyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Down, k.Enter, k.Close}
}

func (k SettingsKeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{k.ShortHelp()}
}

// DevSettingsKeyMap defines keybindings for the dev settings overlay.
type DevSettingsKeyMap struct {
	Close key.Binding
	Down  key.Binding
	Up    key.Binding
	Enter key.Binding
}

func NewDevSettingsKeyMap() DevSettingsKeyMap {
	return DevSettingsKeyMap{
		Close: key.NewBinding(key.WithKeys("esc", "d"), key.WithHelp("Esc", "close")),
		Down:  key.NewBinding(key.WithKeys("j", "down"), key.WithHelp("j/k", "navigate")),
		Up:    key.NewBinding(key.WithKeys("k", "up")),
		Enter: key.NewBinding(key.WithKeys("enter"), key.WithHelp("Enter", "apply")),
	}
}

func (k DevSettingsKeyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Down, k.Enter, k.Close}
}

func (k DevSettingsKeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{k.ShortHelp()}
}

// ConfirmQuitKeyMap defines keybindings for the quit confirmation prompt.
type ConfirmQuitKeyMap struct {
	Yes    key.Binding
	Cancel key.Binding
}

func NewConfirmQuitKeyMap() ConfirmQuitKeyMap {
	return ConfirmQuitKeyMap{
		Yes:    key.NewBinding(key.WithKeys("y", "enter"), key.WithHelp("y/Enter", "quit")),
		Cancel: key.NewBinding(key.WithHelp("any", "cancel")),
	}
}

func (k ConfirmQuitKeyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Yes, k.Cancel}
}

func (k ConfirmQuitKeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{k.ShortHelp()}
}

// PreflightDashboardKeyMap defines keybindings for the preflight results screen.
type PreflightDashboardKeyMap struct {
	Fix  key.Binding
	Skip key.Binding
	Quit key.Binding
}

func NewPreflightDashboardKeyMap() PreflightDashboardKeyMap {
	return PreflightDashboardKeyMap{
		Fix:  key.NewBinding(key.WithKeys("enter"), key.WithHelp("Enter", "fix")),
		Skip: key.NewBinding(key.WithKeys("s"), key.WithHelp("s", "skip")),
		Quit: key.NewBinding(key.WithKeys("q"), key.WithHelp("q", "quit")),
	}
}

func (k PreflightDashboardKeyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Fix, k.Skip, k.Quit}
}

func (k PreflightDashboardKeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{k.ShortHelp()}
}

// PreflightSelectFixesKeyMap defines keybindings for the fix selector.
type PreflightSelectFixesKeyMap struct {
	Toggle key.Binding
	Down   key.Binding
	Up     key.Binding
	All    key.Binding
	None   key.Binding
	Apply  key.Binding
	Cancel key.Binding
	Quit   key.Binding
}

func NewPreflightSelectFixesKeyMap() PreflightSelectFixesKeyMap {
	return PreflightSelectFixesKeyMap{
		Toggle: key.NewBinding(key.WithKeys("space"), key.WithHelp("Space", "toggle")),
		Down:   key.NewBinding(key.WithKeys("j", "down"), key.WithHelp("j/k", "navigate")),
		Up:     key.NewBinding(key.WithKeys("k", "up")),
		All:    key.NewBinding(key.WithKeys("a"), key.WithHelp("a", "all")),
		None:   key.NewBinding(key.WithKeys("n"), key.WithHelp("n", "none")),
		Apply:  key.NewBinding(key.WithKeys("enter"), key.WithHelp("Enter", "apply")),
		Cancel: key.NewBinding(key.WithKeys("esc"), key.WithHelp("Esc", "back")),
		Quit:   key.NewBinding(key.WithKeys("q"), key.WithHelp("q", "quit")),
	}
}

func (k PreflightSelectFixesKeyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Toggle, k.Down, k.All, k.None, k.Apply, k.Cancel, k.Quit}
}

func (k PreflightSelectFixesKeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{k.ShortHelp()}
}

// EnvFormKeyMap defines keybindings for the inline env form.
type EnvFormKeyMap struct {
	NextField key.Binding
	PrevField key.Binding
	Submit    key.Binding
	Cancel    key.Binding
}

func NewEnvFormKeyMap() EnvFormKeyMap {
	return EnvFormKeyMap{
		NextField: key.NewBinding(key.WithKeys("tab", "down"), key.WithHelp("Tab/dn", "next")),
		PrevField: key.NewBinding(key.WithKeys("shift+tab", "up"), key.WithHelp("S-Tab/up", "prev")),
		Submit:    key.NewBinding(key.WithKeys("enter"), key.WithHelp("Enter", "submit")),
		Cancel:    key.NewBinding(key.WithKeys("esc"), key.WithHelp("Esc", "cancel")),
	}
}

func (k EnvFormKeyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.NextField, k.PrevField, k.Submit, k.Cancel}
}

func (k EnvFormKeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{k.ShortHelp()}
}

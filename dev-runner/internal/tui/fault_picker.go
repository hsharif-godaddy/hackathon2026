package tui

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
)

// The @airo/llm-proxy control listener (loopback only). dev-runner talks to it
// with the Go stdlib only — no internal modules — to stay within the
// public-deps-only constraint.
const (
	faultControlTimeout    = 2 * time.Second
	faultStatePollInterval = 2 * time.Second
	faultPickerDisarm      = "(disarm)"
)

// faultControlBaseURL is a var (not const) so tests can point it at a stub.
var faultControlBaseURL = "http://127.0.0.1:8789"

// Reused across the 2s poll and arm/disarm actions so each call doesn't spin up
// a fresh transport + idle-connection pool against the loopback control listener.
var faultControlClient = &http.Client{Timeout: faultControlTimeout}

// faultPickerFaults is the armable catalog, mirroring tools/llm-proxy faults.ts.
var faultPickerFaults = []string{
	"premature-close",
	"stream-error-event",
	"invalid-chunk",
	"content-filter",
	"transient-error",
	"http-error",
	"connection-reset",
}

// faultStatus is the last arm state polled from the proxy.
type faultStatus struct {
	armed     bool
	fault     string
	remaining int
}

type faultActionDoneMsg struct {
	err error
}

type faultStatePolledMsg struct {
	status faultStatus
	// True when emitted by the recurring tick (so the handler re-arms the next
	// tick); false for the one-shot poll fired after an arm/disarm action.
	scheduled bool
}

type controlStateResponse struct {
	Armed     bool   `json:"armed"`
	Fault     string `json:"fault"`
	Remaining int    `json:"remaining"`
}

func (m Model) faultPickerActive() bool {
	return m.faultPickerForm != nil
}

// llmProxyProcessName matches the process declared in dev-runner.yml. The proxy
// is special-cased in two TUI spots — it's hidden from the "All" aggregate view
// (its per-chunk SSE log is noise there) and it owns the fault-inject key — so
// both look it up by name, mirroring the existing App/Control Plane lookups.
const llmProxyProcessName = "LLM Proxy"

// llmProxyProcessIndex returns the LLM Proxy process index, or -1 if absent.
func (m Model) llmProxyProcessIndex() int {
	for i, p := range m.manager.Processes {
		if p.Config.Name == llmProxyProcessName {
			return i
		}
	}
	return -1
}

// llmProxyTabIndex returns the tab index of the LLM Proxy process, or -1.
func (m Model) llmProxyTabIndex() int {
	idx := m.llmProxyProcessIndex()
	if idx < 0 {
		return -1
	}
	return 1 + idx
}

// openFaultPicker builds the two-field overlay: which fault, and how many
// requests it should affect before auto-disarming. When a fault is already
// armed, a leading "(disarm)" option clears it.
func (m *Model) openFaultPicker() tea.Cmd {
	fault := faultPickerFaults[0]
	count := "1"

	faultOpts := make([]huh.Option[string], 0, len(faultPickerFaults)+1)
	if m.faultState.armed {
		faultOpts = append(faultOpts, huh.NewOption("(disarm current: "+m.faultState.fault+")", faultPickerDisarm))
		fault = faultPickerDisarm
	}
	for _, f := range faultPickerFaults {
		faultOpts = append(faultOpts, huh.NewOption(f, f))
	}

	countOpts := []huh.Option[string]{
		huh.NewOption("1", "1"),
		huh.NewOption("3", "3"),
		huh.NewOption("5", "5"),
	}

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Inject LLM fault").
				Description("Affects the next chat request(s). Enter confirms, Esc cancels.").
				Options(faultOpts...).
				Value(&fault),
			huh.NewSelect[string]().
				Title("Requests before auto-disarm").
				Options(countOpts...).
				Value(&count),
		),
	).WithShowHelp(true)

	m.faultPickerForm = m.applyModalForm(form)
	m.faultPickerFault = &fault
	m.faultPickerCount = &count
	return m.faultPickerForm.Init()
}

// updateFaultPicker forwards messages to the picker and arms/disarms on submit.
func (m *Model) updateFaultPicker(msg tea.Msg) tea.Cmd {
	if m.faultPickerForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.faultPickerForm, cmd = stepForm(m.faultPickerForm, msg)

	switch m.faultPickerForm.State {
	case huh.StateCompleted:
		fault := *m.faultPickerFault
		count := parseFaultCount(*m.faultPickerCount)
		m.faultPickerForm = nil
		m.faultPickerFault = nil
		m.faultPickerCount = nil
		if fault == faultPickerDisarm {
			return disarmFaultCmd()
		}
		return armFaultCmd(fault, count)
	case huh.StateAborted:
		m.faultPickerForm = nil
		m.faultPickerFault = nil
		m.faultPickerCount = nil
		return nil
	}
	return cmd
}

func parseFaultCount(s string) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 1 {
		return 1
	}
	return n
}

// renderFaultPicker draws the picker inside the shared modal box.
func (m Model) renderFaultPicker() string {
	if m.faultPickerForm == nil {
		return ""
	}
	return settingsBoxStyle.Render(m.faultPickerForm.View())
}

func armFaultCmd(fault string, count int) tea.Cmd {
	body := fmt.Sprintf(`{"fault":%q,"count":%d,"scope":"chat"}`, fault, count)
	return func() tea.Msg {
		return faultActionDoneMsg{err: postControl("/arm", body)}
	}
}

func disarmFaultCmd() tea.Cmd {
	return func() tea.Msg {
		return faultActionDoneMsg{err: postControl("/disarm", "")}
	}
}

// pollFaultStateCmd queries the proxy once (no re-arm). Errors (proxy
// down/starting) are treated as "unarmed" so the indicator simply disappears
// rather than nagging.
func pollFaultStateCmd() tea.Cmd {
	return func() tea.Msg {
		status, _ := getFaultState()
		return faultStatePolledMsg{status: status}
	}
}

// scheduleFaultPoll arms the recurring poll: after the fixed interval it emits a
// scheduled poll, which the Update handler re-arms while running — keeping
// exactly one chain alive.
func scheduleFaultPoll() tea.Cmd {
	return tea.Tick(faultStatePollInterval, func(time.Time) tea.Msg {
		status, _ := getFaultState()
		return faultStatePolledMsg{status: status, scheduled: true}
	})
}

func getFaultState() (faultStatus, error) {
	resp, err := faultControlClient.Get(faultControlBaseURL + "/state")
	if err != nil {
		return faultStatus{}, err
	}
	defer resp.Body.Close()
	var parsed controlStateResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return faultStatus{}, err
	}
	return faultStatus{armed: parsed.Armed, fault: parsed.Fault, remaining: parsed.Remaining}, nil
}

func postControl(path, body string) error {
	resp, err := faultControlClient.Post(faultControlBaseURL+path, "application/json", strings.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("control %s returned status %d", path, resp.StatusCode)
	}
	return nil
}

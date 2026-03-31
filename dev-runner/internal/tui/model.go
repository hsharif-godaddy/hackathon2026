package tui

import (
	"context"
	"crypto/tls"
	"net/http"
	"time"

	"charm.land/bubbles/v2/textinput"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"

	"github.com/airo-ai-builder/dev-runner/internal/config"
	"github.com/airo-ai-builder/dev-runner/internal/hooks"
	"github.com/airo-ai-builder/dev-runner/internal/process"
)

// --- Bubble Tea messages ---

type processOutputMsg struct {
	Index int
	Line  process.OutputLine
}

type processStateMsg struct {
	Index int
	State process.State
}

type hookOutputMsg struct {
	Output   hooks.HookOutput
	outputCh <-chan hooks.HookOutput
	doneCh   <-chan error
}

type hooksCompleteMsg struct {
	Err error
}

type healthCheckMsg struct {
	Index      int
	Healthy    bool
	Generation int
}

type tickMsg time.Time

type bellResetMsg struct{}

type clickHintMsg struct{}

// --- Model ---

// Model is the root Bubble Tea model.
type Model struct {
	config      *config.Config
	projectRoot string
	manager *process.Manager

	panes          []Pane
	activeTab      int
	lastErrorCount []int // track error counts to detect new errors
	width          int
	height         int
	ready          bool
	quitting       bool

	settingsOpen   bool
	settingsCursor int
	settingsItems  []SettingsItem

	searchOpen  bool
	searchInput textinput.Model

	hookRunning    bool
	hookCancel     context.CancelFunc
	hookDone       <-chan struct{} // closed when hook goroutine exits
	hookOutput     []hooks.HookOutput
	hookErr        error
	hookViewport   viewport.Model
	hookAutoFollow bool

	mouseEnabled     bool
	clickHint        bool
	confirmQuit      bool
	bellAllowed      bool
	healthGeneration []int   // per-process generation counter to discard stale health check results
	initHookCmd      tea.Cmd // pre-created hook cmd from NewModel (used only in Init)
}

// NewModel creates the initial model.
func NewModel(cfg *config.Config, projectRoot string) Model {
	mgr := process.NewManager(cfg.Processes, projectRoot)

	panes := make([]Pane, len(cfg.Processes))
	for i, p := range cfg.Processes {
		panes[i] = NewPane(p.Name, 80, 24)
	}

	ti := textinput.New()
	ti.Placeholder = "Search..."
	ti.CharLimit = 200

	items := buildSettingsItems(cfg)

	ctx, cancel := context.WithCancel(context.Background())
	hookCmd, hookDone := startHookRun(ctx, projectRoot, cfg.Hooks.PreStart)

	return Model{
		config:           cfg,
		projectRoot:      projectRoot,
		manager:          mgr,
		panes:            panes,
		activeTab:        0,
		lastErrorCount:   make([]int, len(cfg.Processes)),
		healthGeneration: make([]int, len(cfg.Processes)),
		mouseEnabled:     true,
		bellAllowed:      true,
		hookRunning:      true,
		hookCancel:       cancel,
		hookDone:         hookDone,
		hookAutoFollow:   true,
		hookViewport:     newSoftWrapViewport(80, 24),
		searchInput:      ti,
		settingsItems:    items,
		initHookCmd:      hookCmd,
	}
}

// Init starts the TUI: run pre-start hooks then start processes.
func (m Model) Init() tea.Cmd {
	return tea.Batch(
		m.initHookCmd,
		m.tickCmd(),
	)
}

// runPreStartHooks creates a new cancellable context and starts hooks.
// Must be called from Update (pointer receiver) so hookCancel is persisted.
func (m *Model) runPreStartHooks() tea.Cmd {
	// Cancel any previous hook run
	if m.hookCancel != nil {
		m.hookCancel()
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.hookCancel = cancel

	cmd, hookDone := startHookRun(ctx, m.projectRoot, m.config.Hooks.PreStart)
	m.hookDone = hookDone
	return cmd
}

// startHookRun launches hook execution in a goroutine and returns a cmd
// that streams output back to the TUI via channels.
func startHookRun(ctx context.Context, projectRoot string, hookConfigs []config.HookConfig) (tea.Cmd, <-chan struct{}) {
	outputCh := make(chan hooks.HookOutput, 64)
	doneCh := make(chan error, 1)
	hookDone := make(chan struct{})

	go func() {
		defer close(hookDone)
		runner := &hooks.Runner{
			ProjectRoot: projectRoot,
			OnOutput: func(out hooks.HookOutput) {
				select {
				case outputCh <- out:
				case <-ctx.Done():
				}
			},
		}
		err := runner.RunHooks(ctx, hookConfigs)
		close(outputCh)
		doneCh <- err
	}()

	return waitForHookEvent(outputCh, doneCh), hookDone
}

// waitForHookEvent returns a cmd that blocks until the next hook output
// line or completion. Each hookOutputMsg carries the channels so the
// update loop can re-subscribe for the next event.
func waitForHookEvent(outputCh <-chan hooks.HookOutput, doneCh <-chan error) tea.Cmd {
	return func() tea.Msg {
		select {
		case out, ok := <-outputCh:
			if ok {
				return hookOutputMsg{Output: out, outputCh: outputCh, doneCh: doneCh}
			}
			// Output channel closed — get the final error
			err := <-doneCh
			return hooksCompleteMsg{Err: err}
		case err := <-doneCh:
			// Done arrived first — drain any remaining output
			for range outputCh {
			}
			return hooksCompleteMsg{Err: err}
		}
	}
}

// tickCmd returns a tick command for periodic updates.
func (m Model) tickCmd() tea.Cmd {
	return tea.Tick(500*time.Millisecond, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

// healthCheckCmd starts a health check for a single process.
func healthCheckCmd(index int, hc *config.HealthCheck, generation int) tea.Cmd {
	if hc == nil {
		return nil
	}
	return func() tea.Msg {
		client := &http.Client{Timeout: 5 * time.Second}
		if hc.Insecure {
			client.Transport = &http.Transport{
				TLSClientConfig: &tls.Config{
					InsecureSkipVerify: true, //nolint:gosec // intentional: local dev services use self-signed certs
					MinVersion:         tls.VersionTLS12,
				},
			}
		}

		resp, err := client.Get(hc.URL)
		if err != nil {
			return healthCheckMsg{Index: index, Healthy: false, Generation: generation}
		}
		resp.Body.Close()
		return healthCheckMsg{Index: index, Healthy: resp.StatusCode >= 200 && resp.StatusCode < 300, Generation: generation}
	}
}

// scheduleHealthChecks returns commands that periodically check health for all processes.
func (m *Model) scheduleHealthChecks() tea.Cmd {
	var cmds []tea.Cmd
	for i, p := range m.config.Processes {
		if p.HealthCheck != nil {
			cmds = append(cmds, m.scheduleHealthCheck(i, p.HealthCheck))
		}
	}
	if len(cmds) == 0 {
		return nil
	}
	return tea.Batch(cmds...)
}

// scheduleHealthCheck bumps the generation for a single process and
// returns a command that starts its probe chain after unhealthyInterval.
func (m *Model) scheduleHealthCheck(index int, hc *config.HealthCheck) tea.Cmd {
	m.healthGeneration[index]++
	gen := m.healthGeneration[index]
	idx := index
	return tea.Tick(hc.UnhealthyInterval, func(_ time.Time) tea.Msg {
		return healthCheckCmd(idx, hc, gen)()
	})
}

func (m Model) processCount() int {
	return len(m.manager.Processes)
}

func (m Model) tabCount() int {
	return 1 + m.processCount()
}

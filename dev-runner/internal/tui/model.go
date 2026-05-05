package tui

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/url"
	"time"

	"charm.land/bubbles/v2/help"
	"charm.land/bubbles/v2/progress"
	"charm.land/bubbles/v2/spinner"
	"charm.land/bubbles/v2/textinput"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/config"
	"github.com/airo-ai-builder/dev-runner/internal/e2e"
	"github.com/airo-ai-builder/dev-runner/internal/hooks"
	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/checks"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/fixers"
	"github.com/airo-ai-builder/dev-runner/internal/process"
	"github.com/airo-ai-builder/dev-runner/internal/sso"
)

// --- Bubble Tea messages ---

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

type devSettingsPresetMsg struct {
	Preset string
	Err    error
}

type devSettingsErrorClearMsg struct{}

// --- Preflight phase ---

// Phase represents the current lifecycle phase of the TUI.
type Phase int

const (
	PhasePreflightChecking Phase = iota
	PhasePreflightDashboard
	PhasePreflightSelectFixes
	PhasePreflightEnvForm
	PhasePreflightFixing
	PhasePreflightVerifying
	PhaseHooks
	PhaseRunning
)

type preflightAllChecksDoneMsg struct {
	Results []preflight.CheckResult
}

type preflightFixDoneMsg struct {
	Err       error
	FixerName string
}

type preflightVerifyDoneMsg struct {
	Results []preflight.CheckResult
}

type preflightAutoAdvanceMsg struct{}

// --- Model ---

// Model is the root Bubble Tea model.
type Model struct {
	config      *config.Config
	projectRoot string
	manager     *process.Manager

	panes          []Pane
	activeTab      int
	lastErrorCount []int // track error counts to detect new errors
	width          int
	height         int
	ready          bool
	quitting       bool

	settingsItems []SettingsItem
	settingsForm  *huh.Form
	settingsValue *int // selected index into settingsItems

	devSettingsError string
	devSettingsForm  *huh.Form
	devSettingsValue *string // selected preset name

	quitConfirmForm  *huh.Form
	quitConfirmValue *bool

	searchOpen  bool
	searchInput textinput.Model

	hookRunning    bool
	hookCancel     context.CancelFunc
	hookDone       <-chan struct{} // closed when hook goroutine exits
	hookOutput     []hooks.HookOutput
	hookErr        error
	hookViewport   viewport.Model
	hookAutoFollow bool

	help        help.Model
	spinner     spinner.Model
	fixProgress progress.Model

	keys          RunningKeyMap
	searchKeys    SearchKeyMap
	preflightKeys PreflightDashboardKeyMap

	mouseEnabled     bool
	clickHint        bool
	bellAllowed      bool
	healthGeneration []int // per-process generation counter to discard stale health check results

	// Preflight state
	phase                  Phase
	preflightRunner        *preflight.Runner
	preflightResults       []preflight.CheckResult
	preflightFixQueue      []preflight.CheckWithFixer
	preflightFixIndex      int
	preflightFixStatus     string // "Fixing: <name>..."
	preflightViewport      viewport.Model
	preflightAutoFollow    bool
	preflightExpandPassing bool // 'v' on the dashboard expands passing checks

	// Inline fix selector state (huh-based)
	fixSelectorItems []preflight.CheckWithFixer
	fixSelectorForm  *huh.Form
	fixSelectorValue *[]int // indices into fixSelectorItems

	// Inline env form state (huh-based)
	envForm        *huh.Form
	envFormBuilder *envFormBuilder
	formFixer      preflight.FormFixer // the fixer waiting for form values

	// Dev settings tab state
	devSettingsPreset   string // current preset name
	controlPlaneBaseURL string

	// E2E tab state
	e2eRunner          *e2e.Runner
	e2ePane            Pane
	e2ePickerForm      *huh.Form
	e2ePickerStep      E2EPickerStep
	e2ePickerProject   *string
	e2ePickerEnv       *string
	e2ePickerTests     *[]string
	e2ePickerAvailable []string
	e2ePickerError     string
	// e2ePickerLoadCancel cancels the in-flight `playwright test --list` so
	// pressing Esc on the loading screen actually terminates the subprocess
	// rather than just dismissing the UI.
	e2ePickerLoadCancel context.CancelFunc
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

	h := help.New()
	h.Styles = helpStyles()
	h.ShortSeparator = "  "

	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("205"))

	prog := progress.New(progress.WithDefaultBlend(), progress.WithoutPercentage())

	// Constructed eagerly here and never reset for the rest of the process
	// lifetime, matching how manager is treated. Call sites can rely on
	// m.e2eRunner being non-nil — defensive nil guards are unnecessary.
	e2ePane := NewPane("E2E", 80, 24)
	e2eRunner := &e2e.Runner{ProjectRoot: projectRoot}

	return Model{
		config:              cfg,
		projectRoot:         projectRoot,
		manager:             mgr,
		panes:               panes,
		activeTab:           0,
		lastErrorCount:      make([]int, len(cfg.Processes)),
		healthGeneration:    make([]int, len(cfg.Processes)),
		mouseEnabled:        true,
		bellAllowed:         true,
		hookAutoFollow:      true,
		hookViewport:        newSoftWrapViewport(80, 24),
		help:                h,
		spinner:             s,
		fixProgress:         prog,
		keys:                NewRunningKeyMap(),
		searchKeys:          NewSearchKeyMap(),
		preflightKeys:       NewPreflightDashboardKeyMap(),
		searchInput:         ti,
		settingsItems:       items,
		phase:               PhasePreflightChecking,
		preflightRunner:     buildPreflightRunner(projectRoot),
		preflightViewport:   newSoftWrapViewport(80, 24),
		preflightAutoFollow: true,
		devSettingsPreset:   "free-trial",
		controlPlaneBaseURL: controlPlaneBaseURL(cfg),
		e2eRunner:           e2eRunner,
		e2ePane:             e2ePane,
	}
}

// Init starts the TUI: run preflight checks first, then hooks, then processes.
func (m Model) Init() tea.Cmd {
	runner := m.preflightRunner
	projectRoot := m.projectRoot
	return tea.Batch(
		m.tickCmd(),
		m.spinner.Tick,
		func() tea.Msg {
			results := runner.RunAll(context.Background(), projectRoot)
			return preflightAllChecksDoneMsg{Results: results}
		},
	)
}

// buildPreflightRunner creates a Runner with all standard checks grouped by category.
func buildPreflightRunner(projectRoot string) *preflight.Runner {
	requiredPorts := map[int]string{
		3000: "App",
		4000: "Agents",
		4100: "Control Plane",
		8443: "App HTTPS",
	}

	// Shared SSO token cache so KnowB and Design RAG fixers authenticate only once.
	ssoTokenCache := sso.NewTokenCache(sso.DefaultLocalDevConfig())

	// App env fixer collects values; agents fixer reuses them via AppEnvFixer pointer.
	appEnvFixer := &fixers.EnvFixer{Target: "app"}
	agentsEnvFixer := &fixers.EnvFixer{Target: "agents", AppEnvFixer: appEnvFixer}

	return &preflight.Runner{
		Categories: []preflight.CategoryGroup{
			{
				Name: preflight.CategoryTools,
				Checks: []preflight.CheckWithFixer{
					{Check: &checks.NodeVersionManagerCheck{}},
					{Check: &checks.NodeCheck{}},
					{Check: &checks.PnpmCheck{}, Fixer: &fixers.PnpmFixer{}},
					{Check: &checks.GoCheck{}},
					{Check: &checks.MakeCheck{}},
					{Check: &checks.DockerCheck{}},
					{Check: &checks.AWSCLICheck{}},
					{Check: &checks.ArtifactoryCheck{}, Fixer: &fixers.ArtifactoryFixer{}},
					{Check: &checks.DirenvCheck{}},
				},
			},
			{
				Name: preflight.CategoryEnvironment,
				Checks: []preflight.CheckWithFixer{
					{Check: &checks.HostsCheck{}, Fixer: &fixers.HostsFixer{}},
					{Check: &checks.AWSProfileCheck{}},
					{Check: &checks.AppEnvCheck{}, Fixer: appEnvFixer},
					{Check: &checks.AgentsEnvCheck{}, Fixer: agentsEnvFixer},
					{Check: &checks.ShellEnvConflictCheck{}},
					{Check: &checks.GoProxyCheck{}, Fixer: &fixers.GoProxyFixer{}},
					{Check: &checks.LCPEnvCheck{}, Fixer: &fixers.LCPEnvFixer{}},
					{Check: &checks.AWSSSOCheck{}, Fixer: &fixers.AWSSSOFixer{}},
					{Check: &checks.GasketDevCertsCheck{}},
					{Check: &checks.S2SCertsCheck{}, Fixer: &fixers.S2SCertsFixer{}},
					{Check: &checks.CommerceOAuthCheck{}, Fixer: &fixers.CommerceOAuthFixer{}},
					{Check: &checks.JWTKeysCheck{}, Fixer: &fixers.JWTKeysFixer{}},
					{Check: &checks.GettyCheck{}, Fixer: &fixers.GettyFixer{}},
					{Check: &checks.KnowBCheck{}, Fixer: &fixers.KnowBFixer{TokenCache: ssoTokenCache}},
					{Check: &checks.DesignRAGCheck{}, Fixer: &fixers.DesignRAGFixer{TokenCache: ssoTokenCache}},
					{Check: &checks.ImageSearchEnvCheck{}, Fixer: &fixers.ImageSearchEnvFixer{}, OptIn: true},
					{Check: &checks.E2ECheck{}, Fixer: &fixers.E2EFixer{ProjectRoot: projectRoot}},
				},
			},
			{
				Name: preflight.CategoryServices,
				Checks: []preflight.CheckWithFixer{
					{Check: &checks.PortCheck{Ports: requiredPorts}, Fixer: &fixers.PortsFixer{Ports: requiredPorts}},
					{Check: &checks.MySQLCheck{}, Fixer: &fixers.MySQLFixer{}},
				},
			},
		},
	}
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
	return 1 + m.processCount() + 1 // All + processes + E2E
}

// controlPlaneBaseURL extracts the base URL from the control plane health check config, or defaults to localhost:4100.
func controlPlaneBaseURL(cfg *config.Config) string {
	for _, p := range cfg.Processes {
		if p.Name == "Control Plane" && p.HealthCheck != nil {
			if parsed, err := url.Parse(p.HealthCheck.URL); err == nil {
				return parsed.Scheme + "://" + parsed.Host
			}
			return p.HealthCheck.URL
		}
	}
	return "http://localhost:4100"
}

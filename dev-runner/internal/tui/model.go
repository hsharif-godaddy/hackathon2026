package tui

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/url"
	"path/filepath"
	"time"

	"charm.land/bubbles/v2/help"
	"charm.land/bubbles/v2/progress"
	"charm.land/bubbles/v2/spinner"
	"charm.land/bubbles/v2/textinput"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/clean"
	"github.com/airo-ai-builder/dev-runner/internal/config"
	"github.com/airo-ai-builder/dev-runner/internal/e2e"
	"github.com/airo-ai-builder/dev-runner/internal/hooks"
	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/checks"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/fixers"
	"github.com/airo-ai-builder/dev-runner/internal/prewarm"
	"github.com/airo-ai-builder/dev-runner/internal/probe"
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

// probeBaselineCheckResultMsg is returned by the async HasBaseline check
// triggered by the "Regression" menu item.
type probeBaselineCheckResultMsg struct {
	suite string
	has   bool
	err   error
}

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
	PhasePreflightCleanPicker
	PhasePreflightCleaning
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

// cleanDoneMsg is emitted once the goroutine running clean.RunWithStreams
// returns. Output is the captured stdout+stderr for display.
type cleanDoneMsg struct {
	Output string
	Err    error
}

// prewarmLineMsg carries one line of streamed prewarm output from the warming
// goroutine to the TUI, so the dialog shows live progress while it runs.
type prewarmLineMsg string

// prewarmDoneMsg is emitted once the goroutine running a prewarm finishes.
// Output is streamed via prewarmLineMsg, so only the terminal error remains.
type prewarmDoneMsg struct {
	Err error
}

// cleanPickerOpenMsg requests that the clean picker form be opened. Init()
// emits this when starting in PhasePreflightCleanPicker so picker setup runs
// inside Update where mutations on the model land.
type cleanPickerOpenMsg struct{}

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
	preflightFixStatus     string           // "Fixing: <name>..."
	preflightFixErrors     map[string]error // keyed by check name; survives the verify→dashboard transition so a failed fix is visible on the next dashboard render
	preflightViewport      viewport.Model
	preflightAutoFollow    bool
	preflightExpandPassing bool // 'v' on the dashboard expands passing checks

	// Inline fix selector state (huh-based)
	fixSelectorItems []preflight.CheckWithFixer
	fixSelectorForm  *huh.Form
	fixSelectorValue *[]int // indices into fixSelectorItems

	// Clean picker / cleaning state. The return phase remembers where to go
	// when the picker is aborted: dashboard if we got here via 'c', or the
	// initial preflight check if we were launched with --clean.
	//
	// cleanOnly is set when dev-runner is invoked as `clean` standalone
	// (interactive `pnpm run clean`): the post-clean transition is
	// tea.Quit instead of advancing into preflight, and picker cancel
	// also quits — there's no dev session to return to.
	cleanPickerForm        *huh.Form
	cleanPickerValue       *[]int // indices into the four clean groups
	cleanPickerReturnPhase Phase
	cleanRunning           bool
	cleanOutput            string
	cleanErr               error
	cleanOnly              bool

	// prewarm picker + run state (overlay during PhaseRunning)
	prewarmPickerForm  *huh.Form
	prewarmPickerValue *[]int // indices into prewarmGroups
	prewarmRunning     bool
	prewarmOutput      string
	prewarmErr         error
	prewarmCh          chan tea.Msg       // live progress stream from the warming goroutine
	prewarmViewport    viewport.Model     // scrollable, soft-wrapping tail of prewarm output
	prewarmAutoFollow  bool               // false once the user scrolls up; re-armed at bottom
	prewarmOnHealthy   *prewarm.Selection // non-nil => auto-fire once all healthy
	prewarmAutoFired   bool

	// Inline env form state (huh-based)
	envForm        *huh.Form
	envFormBuilder *envFormBuilder
	formFixer      preflight.FormFixer // the fixer waiting for form values

	// Dev settings tab state
	devSettingsPreset   string // current preset name
	controlPlaneBaseURL string
	authType            string // "jwt", "none", etc. from local-control-plane/.env

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

	// Probe tab state
	probeRunner    *probe.Runner
	probePane      Pane
	probeMenu      ProbeMenu
	discoveryCache *probe.DiscoveryCache
	probeStatusMsg string      // transient status/warning shown in idle pane
	probePrevState probe.State // used to detect run completion for cache invalidation
	blinkOn        bool        // toggled each tick for probe running animation

	// Probe picker — optional run-options form (trials + env override, or stability).
	probePickerForm     *huh.Form
	probePickerBaseArgs probe.RunArgs
	probePickerTrials   *string // bound to trials input field; nil when form not open
	probePickerEnv      *string // bound to env select field; nil when form not open
	probePickerStab     *string // bound to stability select field; nil when form not open

	// Probe custom-run form — multi-field form for "Custom Run" menu item.
	probeCustomRunForm        *huh.Form
	probeCustomRunScenario    *string
	probeCustomRunSuite       *string
	probeCustomRunTrials      *string
	probeCustomRunConcurrency *string
	probeCustomRunMaxTurns    *string
	probeCustomRunEnv         *string
	probeCustomRunSkipBL      *bool
	probeCustomRunFanOut      *bool

	// Probe env-edit form — single-field modal for "Config" menu actions.
	probeEnvEditForm       *huh.Form
	probeEnvEditValue      *string
	probeEnvEditOnComplete func(value string) error

	// Probe discovery + view state
	probeDiscoveryLoading bool           // true while async ListScenarios / ListSuites is in flight
	probeViewContent      string         // rendered content for "View Scenarios" display
	probeShowingView      bool           // true when showing probeViewContent instead of menu
	probeViewViewport     viewport.Model // scrollable viewport for view content (summary.md etc.)
}

// NewModel creates the initial model.
//
//   - openCleanPicker (--clean): opens the picker before preflight.
//   - cleanAllAtStartup (--clean-all): skips the picker and runs an All()
//     clean through the TUI's cleaning phase (so the output isn't wiped
//     by the alt-screen).
//   - cleanOnly (`dev-runner clean`, interactive): opens the picker; on
//     completion the program quits instead of advancing into preflight.
//     Used by `pnpm run clean` so users get the same picker UI as the
//     dev-time flows without launching a dev session.
func NewModel(cfg *config.Config, projectRoot string, openCleanPicker, cleanAllAtStartup, cleanOnly bool, prewarmOnHealthy *prewarm.Selection) Model {
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

	probePane := NewPane("Probe", 80, 24)
	probeRunner := &probe.Runner{ProbeDir: filepath.Join(projectRoot, "evals", "gosym-probe")}
	discoveryCache := &probe.DiscoveryCache{}
	probeMenu := newProbeMenu(probeRunner.ProbeDir, discoveryCache, 24)

	return Model{
		config:                 cfg,
		projectRoot:            projectRoot,
		manager:                mgr,
		panes:                  panes,
		activeTab:              0,
		lastErrorCount:         make([]int, len(cfg.Processes)),
		healthGeneration:       make([]int, len(cfg.Processes)),
		mouseEnabled:           true,
		bellAllowed:            true,
		hookAutoFollow:         true,
		hookViewport:           newSoftWrapViewport(80, 24),
		help:                   h,
		spinner:                s,
		fixProgress:            prog,
		keys:                   NewRunningKeyMap(),
		searchKeys:             NewSearchKeyMap(),
		preflightKeys:          NewPreflightDashboardKeyMap(),
		searchInput:            ti,
		settingsItems:          items,
		phase:                  initialPhase(openCleanPicker, cleanAllAtStartup, cleanOnly),
		cleanPickerReturnPhase: cleanPickerReturnFromStart(openCleanPicker, cleanAllAtStartup),
		cleanRunning:           cleanAllAtStartup,
		cleanOnly:              cleanOnly,
		preflightRunner:        buildPreflightRunner(projectRoot),
		preflightFixErrors:     make(map[string]error),
		preflightViewport:      newSoftWrapViewport(80, 24),
		preflightAutoFollow:    true,
		devSettingsPreset:      "free-trial",
		controlPlaneBaseURL:    controlPlaneBaseURL(cfg),
		authType:               controlPlaneAuthType(projectRoot),
		prewarmOnHealthy:       prewarmOnHealthy,
		prewarmViewport:        newSoftWrapViewport(80, 24),
		prewarmAutoFollow:      true,
		e2eRunner:              e2eRunner,
		e2ePane:                e2ePane,
		probeRunner:            probeRunner,
		probePane:              probePane,
		probeMenu:              probeMenu,
		discoveryCache:         discoveryCache,
		probeViewViewport:      newSoftWrapViewport(80, 24),
	}
}

// initialPhase chooses the starting phase based on the dev-startup flags.
// --clean-all jumps straight into cleaning; --clean and `clean` (cleanOnly)
// open the picker first; otherwise we begin with preflight checks.
func initialPhase(openCleanPicker, cleanAllAtStartup, cleanOnly bool) Phase {
	switch {
	case cleanAllAtStartup:
		return PhasePreflightCleaning
	case openCleanPicker || cleanOnly:
		return PhasePreflightCleanPicker
	}
	return PhasePreflightChecking
}

// cleanPickerReturnFromStart returns the phase the clean flow should fall
// back to after cleaning (or after a picker cancel). From --clean or
// --clean-all we want to proceed with the initial preflight check; from
// the dashboard 'c' key the route is set just before opening (so the
// zero value here is a don't-care).
func cleanPickerReturnFromStart(openCleanPicker, cleanAllAtStartup bool) Phase {
	if openCleanPicker || cleanAllAtStartup {
		return PhasePreflightChecking
	}
	return PhasePreflightDashboard
}

// CleanErr returns the error from the most recent clean operation, or
// nil if no clean has run or it succeeded. Exposed so cleanOnly callers
// (e.g. `dev-runner clean`) can propagate the failure into their
// process exit code; the on-screen `✗ Clean failed: …` is informative
// but not enough on its own — the flag-driven `clean.Run` path exits 1
// on the same failure, so the interactive path needs to match.
func (m Model) CleanErr() error { return m.cleanErr }

// Init starts the TUI: typically run preflight checks first, then hooks,
// then processes. With --clean we open the clean picker first; with
// --clean-all we kick off an All() clean immediately, both routing the
// post-clean transition through advancePastClean → preflight.
func (m Model) Init() tea.Cmd {
	if m.phase == PhasePreflightCleanPicker {
		return tea.Batch(
			m.tickCmd(),
			m.spinner.Tick,
			func() tea.Msg { return cleanPickerOpenMsg{} },
		)
	}
	if m.phase == PhasePreflightCleaning {
		// --clean-all startup: no running processes to stop, so the
		// "stop first" arg is false.
		return tea.Batch(m.tickCmd(), m.spinner.Tick, m.runClean(clean.All(), false))
	}
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
			// direnv runs alone first as a blocking prerequisite: without it, the
			// shell hasn't sourced .envrc so subsequent checks (Node version,
			// pnpm, etc.) would read the wrong toolchain from PATH and emit
			// misleading failures that mask the real problem.
			{
				Name:           preflight.CategoryTools,
				BlockOnFailure: true,
				Checks: []preflight.CheckWithFixer{
					{Check: &checks.DirenvCheck{}},
				},
			},
			{
				Name: preflight.CategoryTools,
				Checks: []preflight.CheckWithFixer{
					{Check: &checks.NodeVersionManagerCheck{}},
					{Check: &checks.NodeCheck{}},
					{Check: &checks.PnpmCheck{}, Fixer: &fixers.PnpmFixer{}},
					{Check: &checks.GoCheck{}},
					{Check: &checks.RustCheck{}},
					{Check: &checks.MakeCheck{}},
					{Check: &checks.DockerCheck{}},
					{Check: &checks.SandboxCheck{}},
					{Check: &checks.AWSCLICheck{}},
					{Check: &checks.ArtifactoryCheck{}, Fixer: &fixers.ArtifactoryFixer{}},
				},
			},
			{
				Name: preflight.CategoryEnvironment,
				Checks: []preflight.CheckWithFixer{
					{Check: &checks.HostsCheck{}, Fixer: &fixers.HostsFixer{}},
					{Check: &checks.AWSProfileCheck{}},
					{Check: &checks.AppEnvCheck{}, Fixer: appEnvFixer},
					{Check: &checks.AgentsEnvCheck{}, Fixer: agentsEnvFixer},
					{Check: &checks.AppLocalEnvCheck{}, Fixer: &fixers.AppLocalEnvFixer{}},
					{Check: &checks.AgentsLocalEnvCheck{}, Fixer: &fixers.AgentsLocalEnvFixer{}},
					{Check: &checks.S2SAuthRecommendCheck{}, Fixer: &fixers.S2SMigrateFixer{}, OptIn: true},
					{Check: &checks.ShellEnvConflictCheck{}},
					{Check: &checks.GoProxyCheck{}, Fixer: &fixers.GoProxyFixer{}},
					{Check: &checks.LCPEnvCheck{}, Fixer: &fixers.LCPEnvFixer{}},
					{Check: &checks.EvalProbeEnvCheck{}, Fixer: &fixers.EvalProbeEnvFixer{}},
					{Check: &checks.EvalProbePlaywrightCheck{}, Fixer: &fixers.EvalProbePlaywrightFixer{}},
					{Check: &checks.AWSSSOCheck{}, Fixer: &fixers.AWSSSOFixer{}},
					{Check: &checks.GasketDevCertsCheck{}, Fixer: &fixers.GasketDevCertsFixer{}},
					{Check: &checks.WorkspaceBuildCheck{}, Fixer: &fixers.WorkspaceBuildFixer{}},
					{Check: &checks.S2SCertsCheck{}, Fixer: &fixers.S2SCertsFixer{}},
					{Check: &checks.AiroAppBuilderOAuthCheck{}, Fixer: &fixers.AiroAppBuilderOAuthFixer{}},
					{Check: &checks.CommerceOAuthCheck{}, Fixer: &fixers.CommerceOAuthFixer{}},
					{Check: &checks.JWTKeysCheck{}, Fixer: &fixers.JWTKeysFixer{}},
					{Check: &checks.GettyCheck{}, Fixer: &fixers.GettyFixer{}},
					{Check: &checks.KnowBCheck{}, Fixer: &fixers.KnowBFixer{TokenCache: ssoTokenCache}},
					{Check: &checks.DesignRAGCheck{}, Fixer: &fixers.DesignRAGFixer{TokenCache: ssoTokenCache}},
					{Check: &checks.E2ECheck{}, Fixer: &fixers.E2EFixer{ProjectRoot: projectRoot}},
				},
			},
			{
				Name: preflight.CategoryServices,
				Checks: []preflight.CheckWithFixer{
					{Check: &checks.PortCheck{Ports: requiredPorts}, Fixer: &fixers.PortsFixer{Ports: requiredPorts}},
					{Check: &checks.MySQLCheck{}, Fixer: &fixers.MySQLFixer{}},
					{Check: &checks.BMSRemoteSeedCheck{}, Fixer: &fixers.BMSRemoteSeedFixer{}},
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
	return 1 + m.processCount() + 2 // All + processes + E2E + Probe
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

// allHealthCheckedHealthy reports whether every process that defines a health
// check currently reports healthy. Processes without a health check are
// ignored. False when no process has reported yet.
func (m Model) allHealthCheckedHealthy() bool {
	any := false
	for i, p := range m.config.Processes {
		if p.HealthCheck == nil {
			continue
		}
		any = true
		h := m.manager.Processes[i].Healthy
		if h == nil || !*h {
			return false
		}
	}
	return any
}

// appBaseURL extracts scheme+host from the App process health check, or
// defaults to the standard local Gasket proxy URL.
func appBaseURL(cfg *config.Config) string {
	for _, p := range cfg.Processes {
		if p.Name == "App" && p.HealthCheck != nil {
			if parsed, err := url.Parse(p.HealthCheck.URL); err == nil {
				return parsed.Scheme + "://" + parsed.Host
			}
		}
	}
	return "https://local.gasket.dev-godaddy.com:8443"
}

func controlPlaneAuthType(projectRoot string) string {
	envPath := filepath.Join(projectRoot, "local-control-plane", ".env")
	env, err := preflight.ParseEnvFile(envPath)
	if err != nil {
		return "none"
	}
	if v, ok := env["AUTH_TYPE"]; ok && v != "" {
		return v
	}
	return "none"
}

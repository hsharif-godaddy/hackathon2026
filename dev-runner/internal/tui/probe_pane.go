package tui

import (
	"context"
	"fmt"
	"image/color"
	"sort"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/airo-ai-builder/dev-runner/internal/probe"
	"github.com/airo-ai-builder/dev-runner/internal/process"
)

// --- Bubble Tea messages ---

// probeStartRunMsg is produced by probe menu item actions to start a run.
// Handled in Model.Update to call startProbeRun.
type probeStartRunMsg struct {
	args probe.RunArgs
}

// probeDiscoveryLoadingMsg signals that an async discovery command has been
// dispatched. Sets probeDiscoveryLoading=true to show the spinner.
type probeDiscoveryLoadingMsg struct{}

// probeDiscoverySuitesResultMsg carries the result of an async ListSuites call.
type probeDiscoverySuitesResultMsg struct {
	suites map[string][]probe.ScenarioInfo
	err    error
}

// probeDiscoveryScenariosResultMsg carries the result of an async ListScenarios call.
type probeDiscoveryScenariosResultMsg struct {
	scenarios []probe.ScenarioInfo
	err       error
}

// probeOpenPickerMsg asks the model to open the run-options or graduate picker.
type probeOpenPickerMsg struct {
	baseArgs probe.RunArgs
	graduate bool
}

// probeShowViewMsg asks the model to display pre-rendered content in the pane.
type probeShowViewMsg struct {
	content string
}

// probeGraduateScenariosResultMsg carries the result of ListScenarios triggered
// from the "Graduate Scenario" menu item. On success the model pushes a graduate
// submenu (items send probeOpenPickerMsg{graduate: true}).
type probeGraduateScenariosResultMsg struct {
	scenarios []probe.ScenarioInfo
	err       error
}

// probeGraduateSuitesResultMsg carries the result of ListSuites triggered from
// the "Graduate Suite" menu item.
type probeGraduateSuitesResultMsg struct {
	suites map[string][]probe.ScenarioInfo
	err    error
}

// probeDirectRunsResultMsg carries results from a direct disk read of the run index.
// Used by "Results (All Runs)" to populate a submenu from disk.
type probeDirectRunsResultMsg struct {
	runs []probe.RunIndexFileEntry
}

// probeOpenCustomRunMsg asks the model to open the multi-field custom run form.
type probeOpenCustomRunMsg struct{}

// probeEnvKeysLoadedMsg carries parsed env lines from the probeDir .env file.
// Used by "Edit value" to push a key-selection submenu.
type probeEnvKeysLoadedMsg struct {
	lines   []probe.EnvLine
	envPath string
	err     error
}

// probeOpenEnvEditMsg asks the model to open the single-field env edit Input form.
type probeOpenEnvEditMsg struct {
	key          string
	currentValue string
	envPath      string
}

// probeOpenEnvSwitchMsg asks the model to open the env switch Select form.
type probeOpenEnvSwitchMsg struct {
	envPath string
}

// --- Content rendering ---

// renderProbeContent renders the Probe tab body. Priority:
//  1. Discovery loading spinner (when async discovery is in flight)
//  2. View content (when "View Scenarios" has been selected)
//  3. Navigation menu (when runner is Idle)
//  4. Streaming output viewport (when runner is Running/Stopped/Errored)
func (m Model) renderProbeContent() string {
	header := m.renderProbeHeader()

	if m.probeRunner.GetState() == probe.StateIdle {
		if m.probeDiscoveryLoading {
			return header + "\n" + m.renderProbeDiscoveryLoading()
		}

		if m.probeShowingView {
			return header + "\n" + m.renderProbeViewContent()
		}

		statusLines := 0
		var statusBlock string
		if m.probeStatusMsg != "" {
			statusBlock = errorLineStyle.Render(" "+m.probeStatusMsg+" ") + "\n"
			statusLines = 1
		}
		menuHeight := m.height - 1 - m.statusBarHeight() - 1 - statusLines
		if m.searchOpen {
			menuHeight--
		}
		if menuHeight < 1 {
			menuHeight = 1
		}
		m.probeMenu.height = menuHeight
		return header + "\n" + statusBlock + m.probeMenu.View(m.width)
	}

	return header + "\n" + m.probePane.Viewport.View()
}

// renderProbeDiscoveryLoading renders a spinner while discovery is in flight.
func (m Model) renderProbeDiscoveryLoading() string {
	return "  " + m.spinner.View() + " Loading..."
}

// renderProbeViewContent renders the stored view content in a scrollable viewport.
func (m Model) renderProbeViewContent() string {
	hint := keyHintStyle.Render("  [esc] back  [up/down] scroll\n")
	return hint + m.probeViewViewport.View()
}

func (m Model) renderProbeHeader() string {
	state := m.probeRunner.GetState()
	args := m.probeRunner.GetArgs()
	last := m.probeRunner.LastRun()

	var summary string
	switch state {
	case probe.StateIdle:
		summary = "no run yet"
	case probe.StateRunning:
		target := suiteOrScenarioLabel(args)
		summary = fmt.Sprintf("running %s", target)
	case probe.StateStopped:
		target := suiteOrScenarioLabel(args)
		if last != nil {
			dur := last.EndAt.Sub(last.StartAt).Truncate(time.Second)
			summary = fmt.Sprintf("done %s — exit %d in %s", target, last.ExitCode, dur)
		} else {
			summary = fmt.Sprintf("done %s", target)
		}
	case probe.StateErrored:
		target := suiteOrScenarioLabel(args)
		if last != nil {
			summary = fmt.Sprintf("failed %s — exit %d", target, last.ExitCode)
		} else {
			summary = fmt.Sprintf("failed %s", target)
		}
	}

	return paneHeaderStyle.Width(m.width).Render(fmt.Sprintf(" Probe (gosym) — %s ", summary))
}

// probeTabIndex returns the tab index for the Probe pane (after E2E).
func (m Model) probeTabIndex() int {
	return 1 + m.processCount() + 1
}

// allProcessesHealthy returns true when every managed process is running
// with a passing health check (or has no health check configured and is running).
func (m Model) allProcessesHealthy() bool {
	for _, p := range m.manager.Processes {
		if p.GetState() != process.StateRunning {
			return false
		}
		if p.Config.HealthCheck != nil && (p.Healthy == nil || !*p.Healthy) {
			return false
		}
	}
	return true
}

// probeTabDotColor returns the dot color for the Probe tab indicator based on
// probe runner state and overall stack health.
func probeTabDotColor(state probe.State, stackHealthy bool, blinkOn bool) color.Color {
	switch state {
	case probe.StateRunning:
		if blinkOn {
			return statusRunning // green (visible phase)
		}
		return statusStopped // gray (hidden phase) - creates blink effect
	case probe.StateErrored:
		return statusErrored
	default: // Idle or Stopped
		if stackHealthy {
			return statusRunning // green - stack ready
		}
		return statusStopped // gray - stack not ready
	}
}

// suiteOrScenarioLabel returns a human-readable target identifier for the header.
func suiteOrScenarioLabel(args probe.RunArgs) string {
	switch t := args.Target.(type) {
	case probe.SuiteTarget:
		return "suite:" + t.Name
	case probe.ScenarioTarget:
		return "scenario:" + t.Name
	default:
		return "all"
	}
}

// --- Menu construction ---

// buildGoldenLightMenu constructs the "Run Golden Eval Set (Light)" menu item.
// Selecting it directly starts the eval run with --fan-out --trials 5.
func buildGoldenLightMenu(_ string, _ *probe.DiscoveryCache) ProbeMenuItem {
	return ProbeMenuItem{
		Label: "Run Golden Eval Set (Light)",
		Behavior: ActionBehavior{Fn: func() tea.Cmd {
			return func() tea.Msg {
				return probeStartRunMsg{
					args: probe.RunArgs{
						Command:        probe.CmdEval,
						Target:         probe.SuiteTarget{Name: "golden-light"},
						Trials:         5,
						ParallelSuites: true,
					},
				}
			}
		}},
	}
}

// buildSuitesMenuItem constructs menu item 3 "Suites". On activation it fires
// an async ListSuites discovery and shows a loading spinner until the result
// arrives, at which point the model pushes a dynamic submenu.
func buildSuitesMenuItem(probeDir string, cache *probe.DiscoveryCache) ProbeMenuItem {
	return ProbeMenuItem{
		Label: "Suites",
		Behavior: ActionBehavior{Fn: func() tea.Cmd {
			d := probeDir
			c := cache
			return tea.Batch(
				func() tea.Msg { return probeDiscoveryLoadingMsg{} },
				func() tea.Msg {
					ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
					defer cancel()
					suites, err := probe.ListSuites(ctx, d, c)
					return probeDiscoverySuitesResultMsg{suites: suites, err: err}
				},
			)
		}},
	}
}

// buildScenariosMenuItem constructs menu item 4 "Scenarios". On activation it
// fires an async ListScenarios discovery and shows a loading spinner until the
// result arrives.
func buildScenariosMenuItem(probeDir string, cache *probe.DiscoveryCache) ProbeMenuItem {
	return ProbeMenuItem{
		Label: "Scenarios",
		Behavior: ActionBehavior{Fn: func() tea.Cmd {
			d := probeDir
			c := cache
			return tea.Batch(
				func() tea.Msg { return probeDiscoveryLoadingMsg{} },
				func() tea.Msg {
					ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
					defer cancel()
					scenarios, err := probe.ListScenarios(ctx, d, c)
					return probeDiscoveryScenariosResultMsg{scenarios: scenarios, err: err}
				},
			)
		}},
	}
}

// newProbeMenu builds the initial probe navigation menu with all 9 items.
func newProbeMenu(probeDir string, cache *probe.DiscoveryCache, height int) ProbeMenu {
	items := []ProbeMenuItem{
		buildGoldenLightMenu(probeDir, cache),       // 1
		buildMostRecentRunMenuItem(probeDir, cache), // 2
		buildSuitesMenuItem(probeDir, cache),        // 3
		buildScenariosMenuItem(probeDir, cache),     // 4
		buildAllRunsMenuItem(probeDir, cache),       // 5
		buildBaselinesViewMenuItem(probeDir, cache), // 6
		buildGraduateMenuItem(probeDir, cache),      // 7
		buildConfigMenuItem(probeDir),               // 8
		buildCustomRunMenuItem(),                    // 9
	}
	return newProbeMenuFromItems(items, height)
}

// buildMostRecentRunMenuItem constructs item 2 "Most Recent Run Results".
// Reads the run index and summary.md directly from disk (no subprocess).
func buildMostRecentRunMenuItem(probeDir string, _ *probe.DiscoveryCache) ProbeMenuItem {
	return ProbeMenuItem{
		Label: "Most Recent Run Results",
		Behavior: ActionBehavior{Fn: func() tea.Cmd {
			d := probeDir
			return func() tea.Msg {
				runs, err := probe.ListRunsDirect(d)
				if err != nil {
					return probeShowViewMsg{content: fmt.Sprintf("  Error loading runs: %v\n", err)}
				}
				if len(runs) == 0 {
					return probeShowViewMsg{content: "  No run results available.\n"}
				}
				path, content, err := probe.GetRunSummary(d, runs[0].Dir)
				if err != nil {
					return probeShowViewMsg{content: fmt.Sprintf("  Error reading summary: %v\n", err)}
				}
				if path != "" {
					return probeShowViewMsg{content: fmt.Sprintf("  %s\n\n%s", path, content)}
				}
				return probeShowViewMsg{content: fmt.Sprintf("  %s\n", content)}
			}
		}},
	}
}

// buildAllRunsMenuItem constructs item 5 "Results (All Runs)".
// Reads the run index directly from disk and pushes a submenu of run dirs.
func buildAllRunsMenuItem(probeDir string, _ *probe.DiscoveryCache) ProbeMenuItem {
	return ProbeMenuItem{
		Label: "Results (All Runs)",
		Behavior: ActionBehavior{Fn: func() tea.Cmd {
			d := probeDir
			return func() tea.Msg {
				runs, err := probe.ListRunsDirect(d)
				if err != nil {
					return probeShowViewMsg{content: fmt.Sprintf("  Error loading runs: %v\n", err)}
				}
				if len(runs) == 0 {
					return probeShowViewMsg{content: "  No run results available.\n"}
				}
				return probeDirectRunsResultMsg{runs: runs}
			}
		}},
	}
}

// buildBaselinesViewMenuItem constructs item 6 "Baselines".
// On activation it loads the baseline list and renders it as a table in the pane.
func buildBaselinesViewMenuItem(probeDir string, cache *probe.DiscoveryCache) ProbeMenuItem {
	return ProbeMenuItem{
		Label: "Baselines",
		Behavior: ActionBehavior{Fn: func() tea.Cmd {
			d := probeDir
			c := cache
			return tea.Batch(
				func() tea.Msg { return probeDiscoveryLoadingMsg{} },
				func() tea.Msg {
					ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
					defer cancel()
					entries, err := probe.ListBaselines(ctx, d, c)
					if err != nil {
						return probeShowViewMsg{content: fmt.Sprintf("  Error loading baselines: %v\n", err)}
					}
					return probeShowViewMsg{content: buildBaselinesContent(entries)}
				},
			)
		}},
	}
}

// buildDirectRunMenuItems converts a direct run list into ProbeMenuItems.
// Selecting a run reads summary.md from disk and displays it.
func buildDirectRunMenuItems(probeDir string, runs []probe.RunIndexFileEntry) []ProbeMenuItem {
	items := make([]ProbeMenuItem, 0, len(runs))
	for i, r := range runs {
		run := r
		idx := i + 1
		label := fmt.Sprintf("%d. %s", idx, run.Dir)
		d := probeDir
		items = append(items, ProbeMenuItem{
			Label: label,
			Behavior: ActionBehavior{Fn: func() tea.Cmd {
				return func() tea.Msg {
					path, content, err := probe.GetRunSummary(d, run.Dir)
					if err != nil {
						return probeShowViewMsg{content: fmt.Sprintf("  Error reading summary: %v\n", err)}
					}
					if path != "" {
						return probeShowViewMsg{content: fmt.Sprintf("  %s\n\n%s", path, content)}
					}
					return probeShowViewMsg{content: fmt.Sprintf("  %s\n", content)}
				}
			}},
		})
	}
	return items
}

// --- Dynamic submenu builders (called in Update after discovery results arrive) ---

// buildSuiteSubItems builds the sub-submenu for a single suite:
// "Run Suite" (opens picker) and "View Scenarios" (displays list in pane).
func buildSuiteSubItems(suiteName string, scenarios []probe.ScenarioInfo) []ProbeMenuItem {
	s := suiteName
	sc := scenarios
	return []ProbeMenuItem{
		{
			Label: "Run Suite",
			Behavior: ActionBehavior{Fn: func() tea.Cmd {
				return func() tea.Msg {
					return probeOpenPickerMsg{
						baseArgs: probe.RunArgs{Command: probe.CmdEval, Target: probe.SuiteTarget{Name: s}},
						graduate: false,
					}
				}
			}},
		},
		{
			Label: "View Scenarios",
			Behavior: ActionBehavior{Fn: func() tea.Cmd {
				content := buildScenarioListContent(s, sc)
				return func() tea.Msg {
					return probeShowViewMsg{content: content}
				}
			}},
		},
	}
}

// buildSuiteMenuItems converts a suites map into ProbeMenuItems, sorted by name.
func buildSuiteMenuItems(suites map[string][]probe.ScenarioInfo) []ProbeMenuItem {
	names := make([]string, 0, len(suites))
	for name := range suites {
		names = append(names, name)
	}
	sort.Strings(names)

	items := make([]ProbeMenuItem, 0, len(names))
	for _, name := range names {
		sc := suites[name]
		items = append(items, ProbeMenuItem{
			Label:    fmt.Sprintf("%s (%d scenarios)", name, len(sc)),
			Behavior: SubmenuBehavior{Items: buildSuiteSubItems(name, sc)},
		})
	}
	return items
}

// buildScenarioSubItems builds the sub-submenu for a single scenario:
// "Run" (opens picker) and "Graduate" (opens stability picker).
func buildScenarioSubItems(s probe.ScenarioInfo) []ProbeMenuItem {
	si := s
	return []ProbeMenuItem{
		{
			Label: "Run",
			Behavior: ActionBehavior{Fn: func() tea.Cmd {
				return func() tea.Msg {
					return probeOpenPickerMsg{
						baseArgs: probe.RunArgs{
							Command: probe.CmdEval,
							Target:  probe.ScenarioTarget{Name: si.Name},
							Trials:  si.Trials,
						},
						graduate: false,
					}
				}
			}},
		},
		{
			Label: "Graduate",
			Behavior: ActionBehavior{Fn: func() tea.Cmd {
				return func() tea.Msg {
					return probeOpenPickerMsg{
						baseArgs: probe.RunArgs{
							Command: probe.CmdEval,
							Target:  probe.ScenarioTarget{Name: si.Name},
						},
						graduate: true,
					}
				}
			}},
		},
	}
}

// buildScenarioMenuItems converts a flat scenarios list into ProbeMenuItems.
func buildScenarioMenuItems(scenarios []probe.ScenarioInfo) []ProbeMenuItem {
	items := make([]ProbeMenuItem, 0, len(scenarios))
	for _, s := range scenarios {
		label := s.Name
		if s.Suite != "" {
			label = fmt.Sprintf("%s [%s]", s.Name, s.Suite)
		}
		items = append(items, ProbeMenuItem{
			Label:    label,
			Behavior: SubmenuBehavior{Items: buildScenarioSubItems(s)},
		})
	}
	return items
}

// buildScenarioListContent produces a formatted multi-line text block listing
// scenarios in a suite, suitable for display in the probe pane viewport.
func buildScenarioListContent(suiteName string, scenarios []probe.ScenarioInfo) string {
	var b strings.Builder
	fmt.Fprintf(&b, "  Suite: %s\n\n", suiteName)
	for i, s := range scenarios {
		evals := strings.Join(s.Evaluators, ", ")
		if evals == "" {
			evals = "(none)"
		}
		fmt.Fprintf(&b, "  %d. %s\n", i+1, s.Name)
		fmt.Fprintf(&b, "     trials: %d  stability: %s\n", s.Trials, s.StabilityLevel)
		fmt.Fprintf(&b, "     evaluators: %s\n\n", evals)
	}
	if len(scenarios) == 0 {
		b.WriteString("  (no scenarios)\n")
	}
	return b.String()
}

// --- Runner control ---

// startProbeRun clears output, starts the runner, and switches to the Probe tab.
// Mirrors startE2ERun in e2e_picker.go.
func (m *Model) startProbeRun(args probe.RunArgs) tea.Cmd {
	m.probeStatusMsg = ""
	m.probeShowingView = false
	m.probeViewContent = ""
	m.probeRunner.ClearLines()
	if err := m.probeRunner.Start(args); err != nil {
		m.probePane.AutoFollow = true
		return nil
	}
	m.activeTab = m.probeTabIndex()
	m.probePane.AutoFollow = true
	m.resizePanes()
	return nil
}

// stopProbeRun signals the runner to stop (async).
func (m *Model) stopProbeRun() tea.Cmd {
	go m.probeRunner.Stop()
	return nil
}

// --- Menu item 7: Graduate ---

// buildGraduateMenuItem constructs item 7 "Graduate". Submenu has two choices:
// "Graduate Scenario" (fires scenario discovery → per-scenario picker with
// graduate=true) and "Graduate Suite" (fires suite discovery → per-suite picker).
func buildGraduateMenuItem(probeDir string, cache *probe.DiscoveryCache) ProbeMenuItem {
	return ProbeMenuItem{
		Label: "Graduate",
		Behavior: SubmenuBehavior{Items: []ProbeMenuItem{
			{
				Label: "Graduate Scenario",
				Behavior: ActionBehavior{Fn: func() tea.Cmd {
					d := probeDir
					c := cache
					return tea.Batch(
						func() tea.Msg { return probeDiscoveryLoadingMsg{} },
						func() tea.Msg {
							ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
							defer cancel()
							scenarios, err := probe.ListScenarios(ctx, d, c)
							return probeGraduateScenariosResultMsg{scenarios: scenarios, err: err}
						},
					)
				}},
			},
			{
				Label: "Graduate Suite",
				Behavior: ActionBehavior{Fn: func() tea.Cmd {
					d := probeDir
					c := cache
					return tea.Batch(
						func() tea.Msg { return probeDiscoveryLoadingMsg{} },
						func() tea.Msg {
							ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
							defer cancel()
							suites, err := probe.ListSuites(ctx, d, c)
							return probeGraduateSuitesResultMsg{suites: suites, err: err}
						},
					)
				}},
			},
		}},
	}
}

// buildGraduateScenarioMenuItems converts a scenario list into ProbeMenuItems
// where each item fires probeOpenPickerMsg{graduate: true} with the scenario name.
func buildGraduateScenarioMenuItems(scenarios []probe.ScenarioInfo) []ProbeMenuItem {
	items := make([]ProbeMenuItem, 0, len(scenarios))
	for _, s := range scenarios {
		si := s
		label := si.Name
		if si.Suite != "" {
			label = fmt.Sprintf("%s [%s]", si.Name, si.Suite)
		}
		items = append(items, ProbeMenuItem{
			Label: label,
			Behavior: ActionBehavior{Fn: func() tea.Cmd {
				return func() tea.Msg {
					return probeOpenPickerMsg{
						baseArgs: probe.RunArgs{
							Command: probe.CmdEval,
							Target:  probe.ScenarioTarget{Name: si.Name},
						},
						graduate: true,
					}
				}
			}},
		})
	}
	return items
}

// buildGraduateSuiteMenuItems converts a suites map into ProbeMenuItems where
// each item fires probeOpenPickerMsg{graduate: true} with the suite name.
func buildGraduateSuiteMenuItems(suites map[string][]probe.ScenarioInfo) []ProbeMenuItem {
	names := make([]string, 0, len(suites))
	for name := range suites {
		names = append(names, name)
	}
	sort.Strings(names)

	items := make([]ProbeMenuItem, 0, len(names))
	for _, name := range names {
		sc := suites[name]
		n := name
		items = append(items, ProbeMenuItem{
			Label: fmt.Sprintf("%s (%d scenarios)", n, len(sc)),
			Behavior: ActionBehavior{Fn: func() tea.Cmd {
				return func() tea.Msg {
					return probeOpenPickerMsg{
						baseArgs: probe.RunArgs{
							Command: probe.CmdEval,
							Target:  probe.SuiteTarget{Name: n},
						},
						graduate: true,
					}
				}
			}},
		})
	}
	return items
}

// --- Menu item 9: Custom Run ---

// buildCustomRunMenuItem constructs item 9 "Custom Run". On activation it sends
// probeOpenCustomRunMsg which opens the multi-field custom run form.
func buildCustomRunMenuItem() ProbeMenuItem {
	return ProbeMenuItem{
		Label: "Custom Run",
		Behavior: ActionBehavior{Fn: func() tea.Cmd {
			return func() tea.Msg { return probeOpenCustomRunMsg{} }
		}},
	}
}

// --- Menu item 8: Config ---

// buildConfigMenuItem constructs item 8 "Config" with four submenu actions for
// viewing and editing the gosym-probe .env file.
func buildConfigMenuItem(probeDir string) ProbeMenuItem {
	envPath := probeDir + "/.env"
	return ProbeMenuItem{
		Label: "Config",
		Behavior: SubmenuBehavior{Items: []ProbeMenuItem{
			{
				Label: "View .env",
				Behavior: ActionBehavior{Fn: func() tea.Cmd {
					path := envPath
					return tea.Batch(
						func() tea.Msg { return probeDiscoveryLoadingMsg{} },
						func() tea.Msg {
							lines, err := probe.ParseEnvFile(path)
							if err != nil {
								return probeShowViewMsg{content: fmt.Sprintf("  Error reading .env: %v\n", err)}
							}
							return probeShowViewMsg{content: buildEnvViewContent(lines)}
						},
					)
				}},
			},
			{
				Label: "Edit value",
				Behavior: ActionBehavior{Fn: func() tea.Cmd {
					path := envPath
					return tea.Batch(
						func() tea.Msg { return probeDiscoveryLoadingMsg{} },
						func() tea.Msg {
							lines, err := probe.ParseEnvFile(path)
							return probeEnvKeysLoadedMsg{lines: lines, envPath: path, err: err}
						},
					)
				}},
			},
			{
				Label: "Switch environment",
				Behavior: ActionBehavior{Fn: func() tea.Cmd {
					path := envPath
					return func() tea.Msg { return probeOpenEnvSwitchMsg{envPath: path} }
				}},
			},
			{
				Label: "View resolved config",
				Behavior: ActionBehavior{Fn: func() tea.Cmd {
					path := envPath
					return tea.Batch(
						func() tea.Msg { return probeDiscoveryLoadingMsg{} },
						func() tea.Msg {
							lines, err := probe.ParseEnvFile(path)
							if err != nil {
								return probeShowViewMsg{content: fmt.Sprintf("  Error reading .env: %v\n", err)}
							}
							return probeShowViewMsg{content: buildEnvViewContent(lines)}
						},
					)
				}},
			},
		}},
	}
}

// buildEnvKeyMenuItems converts env lines into menu items for the "Edit value"
// submenu. Each item fires probeOpenEnvEditMsg for the selected key.
func buildEnvKeyMenuItems(lines []probe.EnvLine, envPath string) []ProbeMenuItem {
	items := make([]ProbeMenuItem, 0, len(lines))
	for _, l := range lines {
		if l.Key == "" {
			continue
		}
		line := l
		path := envPath
		maskedVal := probe.MaskSensitiveValue(line.Key, line.Value)
		label := fmt.Sprintf("%s = %s", line.Key, truncate(maskedVal, 20))
		items = append(items, ProbeMenuItem{
			Label: label,
			Behavior: ActionBehavior{Fn: func() tea.Cmd {
				return func() tea.Msg {
					return probeOpenEnvEditMsg{
						key:          line.Key,
						currentValue: line.Value,
						envPath:      path,
					}
				}
			}},
		})
	}
	return items
}

// buildEnvViewContent formats env lines as a two-column table (Key | Value).
// Sensitive values are masked.
func buildEnvViewContent(lines []probe.EnvLine) string {
	var b strings.Builder
	b.WriteString("  .env contents\n\n")

	var rows [][]string
	for _, l := range lines {
		if l.Key == "" {
			continue
		}
		rows = append(rows, []string{l.Key, probe.MaskSensitiveValue(l.Key, l.Value)})
	}
	if len(rows) == 0 {
		b.WriteString("  (empty)\n")
		return b.String()
	}

	b.WriteString(renderTable([]string{"Key", "Value"}, rows))
	return b.String()
}

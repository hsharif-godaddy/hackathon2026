// Package probe supervises one-shot gosym-probe eval runs from inside the TUI.
//
// The runner mirrors internal/e2e in structure: one subprocess at a time,
// output buffered into a ring, state polled by the TUI on each tickMsg.
package probe

import "time"

// State mirrors e2e.State for runner lifecycle.
type State int

const (
	StateIdle State = iota
	StateRunning
	StateStopped
	StateErrored
)

func (s State) String() string {
	switch s {
	case StateIdle:
		return "Idle"
	case StateRunning:
		return "Running"
	case StateStopped:
		return "Stopped"
	case StateErrored:
		return "Errored"
	default:
		return "Unknown"
	}
}

// Command identifies the pnpm script to run.
type Command string

const (
	CmdEval         Command = "eval"
	CmdSaveBaseline Command = "save-baseline"
)

// Target identifies the eval target: a specific scenario, a named suite, or
// all scenarios (nil).
type Target interface{ isTarget() }

// ScenarioTarget runs a single named scenario.
type ScenarioTarget struct{ Name string }

func (ScenarioTarget) isTarget() {}

// SuiteTarget runs all scenarios in a named suite.
type SuiteTarget struct{ Name string }

func (SuiteTarget) isTarget() {}

// RunArgs describes a single probe invocation.
type RunArgs struct {
	Command        Command
	Target         Target // nil = run all; ScenarioTarget or SuiteTarget
	Trials         int    // 0 = use default from config
	Concurrency    int    // 0 = use default from config
	MaxTurns       int    // 0 = use default from config
	Env            string // "" = use default GD_ENV
	ParallelSuites bool   // --fan-out flag
	SkipBaseline   bool   // --skip-baseline flag
	Graduate       bool   // --graduate / --graduate-suite
	Stability      string // "low" | "medium" | "high" | ""
	// SaveBaseline causes the runner to auto-spawn save-baseline after a
	// successful eval, parsing the run ID from eval stdout.
	SaveBaseline bool
	// RunID is only used when Command == CmdSaveBaseline to specify the run
	// to snapshot.
	RunID string
}

// CompletedRun summarises a finished run (both eval and optional save-baseline phases).
type CompletedRun struct {
	Args     RunArgs
	StartAt  time.Time
	EndAt    time.Time
	ExitCode int
	Err      error
	// ParsedRunID is the UUID extracted from eval stdout, used to chain save-baseline.
	ParsedRunID string
}

// --- On-disk file structures (read directly without subprocess) ---

// RunIndexFile is the on-disk shape of runs/.run-index.json.
type RunIndexFile struct {
	Runs []RunIndexFileEntry `json:"runs"`
}

// RunIndexFileEntry is one entry in the run index file.
type RunIndexFileEntry struct {
	RunID     string `json:"runId"`
	Timestamp string `json:"timestamp"`
	Dir       string `json:"dir"`
	Kind      string `json:"kind,omitempty"`
}

// --- JSON response structs for TS subprocess output (used by discovery layer in Phase 2+) ---

// ScenarioInfo is one entry from `pnpm run eval --list`.
type ScenarioInfo struct {
	Name           string   `json:"name"`
	Suite          string   `json:"suite"`
	Trials         int      `json:"trials"`
	StabilityLevel string   `json:"stabilityLevel"`
	ExecutionMode  string   `json:"executionMode"`
	Evaluators     []string `json:"evaluators"`
}

// RunIndexEntry is one entry from `pnpm run eval --list-runs`.
type RunIndexEntry struct {
	RunID     string    `json:"runId"`
	Timestamp time.Time `json:"timestamp"`
	Scenarios []string  `json:"scenarios"`
	Kind      string    `json:"kind,omitempty"`
}

// BaselineEntry is one entry from `pnpm run eval --list-baselines`.
type BaselineEntry struct {
	ScenarioName string    `json:"scenarioName"`
	RunID        string    `json:"runId"`
	CreatedAt    time.Time `json:"createdAt"`
}

// RunDetail is the response from `pnpm run eval --run-detail <id>`.
type RunDetail struct {
	RunID     string              `json:"runId"`
	Timestamp time.Time           `json:"timestamp"`
	Scenarios []ScenarioPerfEntry `json:"scenarios"`
}

// ScenarioPerfEntry is the per-scenario perf block in RunDetail.
type ScenarioPerfEntry struct {
	Name       string                   `json:"name"`
	Evaluators map[string]EvalPerfEntry `json:"evaluators"`
	Timing     ProbeTiming              `json:"timing"`
	Regression string                   `json:"regression,omitempty"`
}

// EvalPerfEntry summarises a single evaluator's performance for one scenario.
type EvalPerfEntry struct {
	PassingTrials int      `json:"passingTrials"`
	TotalTrials   int      `json:"totalTrials"`
	PassAtK       *bool    `json:"passAtK,omitempty"`
	MedianScore   *float64 `json:"medianScore,omitempty"`
	LowerIsBetter bool     `json:"lowerIsBetter,omitempty"`
}

// ProbeTiming holds turn-duration and turn-count stats for one scenario.
type ProbeTiming struct {
	AvgTrialMs float64 `json:"avgTrialDurationMs"`
	AvgTurns   float64 `json:"avgTurnsPerTrial"`
}

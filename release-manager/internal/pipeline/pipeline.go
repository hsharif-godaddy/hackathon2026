package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/airo-ai-builder/release-manager/internal/config"
	"github.com/airo-ai-builder/release-manager/internal/gh"
	"github.com/airo-ai-builder/release-manager/internal/logger"
	"github.com/airo-ai-builder/release-manager/internal/testreport"
)

// Artifact name + file written by the playwright-e2e summarize job, fetched for
// stages with `test_summary: true`.
const (
	testSummaryArtifact = "e2e-summary"
	testSummaryFile     = "summary.json"
)

type StageState int

const (
	StatePending StageState = iota
	StateRunning
	StateParsingOutputs
	StateSuccess
	StateFailed
	StateSkipped
)

func (s StageState) String() string {
	switch s {
	case StatePending:
		return "pending"
	case StateRunning:
		return "running"
	case StateParsingOutputs:
		return "parsing outputs"
	case StateSuccess:
		return "success"
	case StateFailed:
		return "failed"
	case StateSkipped:
		return "skipped"
	default:
		return "unknown"
	}
}

func (s StageState) Symbol() string {
	switch s {
	case StatePending:
		return "○"
	case StateRunning:
		return "◉"
	case StateParsingOutputs:
		return "◎"
	case StateSuccess:
		return "●"
	case StateFailed:
		return "✗"
	case StateSkipped:
		return "⊘"
	default:
		return "?"
	}
}

// StageRun tracks the execution state of a single stage.
type StageRun struct {
	Stage     config.Stage
	Env       string
	State     StageState
	RunURL    string
	RunID     int64
	StartTime time.Time
	EndTime   time.Time
	Error     string
	Outputs   map[string]string

	// Formatted gh command for dry-run display.
	DryRunCmd string

	// Last workflow status from GitHub (e.g. "queued", "in_progress").
	StatusText string

	// For matrix stages, tracks each sub-run.
	MatrixRuns []MatrixRun

	// TestReport holds the per-suite E2E breakdown for stages with
	// `test_summary: true` (downloaded from the run's `e2e-summary` artifact).
	// nil when not opted in or when the fetch/parse failed (best-effort).
	TestReport *testreport.Summary
}

type MatrixRun struct {
	Inputs     map[string]string
	RunURL     string
	RunID      int64
	State      StageState
	Error      string
	DryRunCmd  string
	StatusText string
}

func (sr *StageRun) Duration() time.Duration {
	if sr.StartTime.IsZero() {
		return 0
	}
	if sr.EndTime.IsZero() {
		return time.Since(sr.StartTime)
	}
	return sr.EndTime.Sub(sr.StartTime)
}

// ReleaseNote represents a merged PR included in this release.
type ReleaseNote struct {
	Number int
	Title  string
	Author string
}

// RollbackSnapshot stores the production values captured at startup.
type RollbackSnapshot struct {
	ArtifactID      string
	AgentImageTag   string
	PreviewImageTag string
	PublishImageTag string
	AppSourceURL    string
	ImagesSourceURL string
}

// SnapshotOverrides holds operator-supplied rollback values that take
// precedence over anything auto-discovered from GitHub. Any non-empty
// field overrides the corresponding snapshot field; if every field
// feeding a given source is set, the source's GitHub lookup is skipped
// entirely (so a broken/out-of-date GH state cannot block a release).
type SnapshotOverrides struct {
	ArtifactID      string
	AgentImageTag   string
	PreviewImageTag string
	PublishImageTag string
}

// overriddenSourceURL is recorded when an override supplies a value
// instead of discovery, so the UI makes the origin obvious.
const overriddenSourceURL = "(overridden via CLI flag)"

// partialOverrideMarker is appended to a discovered source URL when
// some but not all of the values sourced from that URL have been
// replaced by CLI overrides, so operators don't trust the URL as a
// full source-of-truth for the displayed tags.
const partialOverrideMarker = "(partially overridden via CLI flag)"

// Default retry delays for health check stages.
var defaultHealthCheckDelays = []time.Duration{0, 5 * time.Second, 10 * time.Second, 20 * time.Second}

// Pipeline manages the full deployment flow.
type Pipeline struct {
	Config             *config.Config
	Runner             gh.Runner
	DryRun             bool
	Branch             string
	Snapshot           RollbackSnapshot
	Overrides          SnapshotOverrides
	BaseCommitOverride string
	FailStages         map[string]bool
	HealthCheckDelays  []time.Duration

	mu     sync.RWMutex
	stages []*StageRun
	values map[string]string
}

func New(cfg *config.Config, runner gh.Runner, dryRun bool, branch string, failStages []string) *Pipeline {
	fs := make(map[string]bool, len(failStages))
	for _, id := range failStages {
		fs[id] = true
	}
	return &Pipeline{
		Config:     cfg,
		Runner:     runner,
		DryRun:     dryRun,
		Branch:     branch,
		FailStages: fs,
		values:     map[string]string{"branch": branch, "commit": branch},
	}
}

func (p *Pipeline) Stages() []*StageRun {
	p.mu.RLock()
	defer p.mu.RUnlock()
	cp := make([]*StageRun, len(p.stages))
	for i, s := range p.stages {
		if s == nil {
			continue
		}
		cloned := *s
		if s.Outputs != nil {
			cloned.Outputs = make(map[string]string, len(s.Outputs))
			for k, v := range s.Outputs {
				cloned.Outputs[k] = v
			}
		}
		if s.MatrixRuns != nil {
			cloned.MatrixRuns = make([]MatrixRun, len(s.MatrixRuns))
			copy(cloned.MatrixRuns, s.MatrixRuns)
		}
		cp[i] = &cloned
	}
	return cp
}

func (p *Pipeline) Values() map[string]string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	cp := make(map[string]string, len(p.values))
	for k, v := range p.values {
		cp[k] = v
	}
	return cp
}

func (p *Pipeline) SetValue(key, value string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.values[key] = value
}

// StageAdvisory reports whether the stage at idx is advisory (its failure must
// not block the pipeline). Out-of-range indices are treated as non-advisory.
func (p *Pipeline) StageAdvisory(idx int) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if idx < 0 || idx >= len(p.stages) {
		return false
	}
	return p.stages[idx].Stage.Advisory
}

// BuildStages creates StageRun entries for all stages in an environment.
func (p *Pipeline) BuildStages(envName string) error {
	env, ok := p.Config.Pipeline.Environments[envName]
	if !ok {
		return fmt.Errorf("environment %q not found", envName)
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	for _, s := range env.Stages {
		sr := &StageRun{
			Stage:   s,
			Env:     envName,
			State:   StatePending,
			Outputs: make(map[string]string),
		}

		if len(s.Matrix) > 0 {
			for _, m := range s.Matrix {
				resolved := make(map[string]string, len(m.Inputs))
				for k, v := range m.Inputs {
					resolved[k] = config.ResolveTemplate(v, p.values)
				}
				sr.MatrixRuns = append(sr.MatrixRuns, MatrixRun{
					Inputs: resolved,
					State:  StatePending,
				})
			}
		}

		p.stages = append(p.stages, sr)
	}

	return nil
}

// StageGroups returns stages organized by execution order within an environment.
// Stages with the same group run in parallel, ungrouped stages run sequentially.
// Returns groups in order: each group is a slice of stage indices.
func (p *Pipeline) StageGroups(envName string) [][]int {
	p.mu.RLock()
	defer p.mu.RUnlock()

	var groups [][]int
	var currentGroup []int
	lastGroup := ""
	first := true

	for i, sr := range p.stages {
		if sr.Env != envName {
			continue
		}

		if sr.Stage.Group == "" {
			if len(currentGroup) > 0 {
				groups = append(groups, currentGroup)
				currentGroup = nil
			}
			groups = append(groups, []int{i})
			lastGroup = ""
			first = false
			continue
		}

		if first || sr.Stage.Group != lastGroup {
			if len(currentGroup) > 0 {
				groups = append(groups, currentGroup)
			}
			currentGroup = []int{i}
			lastGroup = sr.Stage.Group
			first = false
		} else {
			currentGroup = append(currentGroup, i)
		}
	}

	if len(currentGroup) > 0 {
		groups = append(groups, currentGroup)
	}

	return groups
}

// RunStage executes a single stage (trigger + monitor + parse outputs).
func (p *Pipeline) RunStage(ctx context.Context, idx int) error {
	p.mu.Lock()
	sr := p.stages[idx]
	sr.State = StateRunning
	sr.StartTime = time.Now()
	p.mu.Unlock()

	logger.Log("stage.start: [%s] %s (type=%s, workflow=%s, repo=%s)", sr.Env, sr.Stage.Name, sr.Stage.Type, sr.Stage.Workflow, sr.Stage.Repo)

	if sr.Stage.Type == "checklist" {
		return nil
	}

	if sr.Stage.Type == "health-check" {
		if p.DryRun {
			p.SkipStage(idx)
			return nil
		}
		return p.runHealthCheck(ctx, idx)
	}

	resolvedInputs := config.ResolveInputs(sr.Stage.Inputs, p.Values())
	resolvedRef := config.ResolveTemplate(sr.Stage.Ref, p.Values())
	logger.Log("stage.inputs: [%s] %s — %v", sr.Env, sr.Stage.ID, resolvedInputs)

	if len(sr.Stage.Matrix) > 0 {
		return p.runMatrix(ctx, idx, resolvedInputs, resolvedRef)
	}

	if p.DryRun {
		return p.runDryStage(ctx, idx, resolvedInputs, resolvedRef)
	}

	runURL, err := p.Runner.Trigger(ctx, sr.Stage.Repo, sr.Stage.Workflow, resolvedRef, resolvedInputs)
	if err != nil {
		p.failStage(idx, err.Error())
		return err
	}

	runID, err := gh.ExtractRunID(runURL)
	if err != nil {
		p.failStage(idx, err.Error())
		return err
	}

	p.mu.Lock()
	sr.RunURL = runURL
	sr.RunID = runID
	p.mu.Unlock()

	status, err := gh.WaitForCompletion(ctx, p.Runner, sr.Stage.Repo, runID, 15*time.Second, func(s *gh.RunStatus) {
		p.mu.Lock()
		sr.StatusText = s.Progress()
		p.mu.Unlock()
		logger.Log("stage.poll: [%s] %s — status=%s progress=%s (run=%d)", sr.Env, sr.Stage.ID, s.Status, s.Progress(), runID)
	})
	if err != nil {
		p.failStage(idx, err.Error())
		return err
	}

	// Attach the per-suite E2E breakdown for opted-in (advisory) stages — both
	// on pass and fail — so the Slack thread shows counts + failed test names.
	p.attachTestSummary(ctx, idx)

	if status.Conclusion != "success" {
		p.failStage(idx, fmt.Sprintf("run concluded with %s", status.Conclusion))
		return fmt.Errorf("stage %q failed: %s", sr.Stage.ID, status.Conclusion)
	}

	if len(sr.Stage.Outputs) > 0 {
		if err := p.parseOutputs(ctx, idx); err != nil {
			p.failStage(idx, fmt.Sprintf("parsing outputs: %s", err.Error()))
			return err
		}
	}

	p.succeedStage(idx)
	return nil
}

func (p *Pipeline) dryRunDelay(ctx context.Context) {
	select {
	case <-time.After(2 * time.Second):
	case <-ctx.Done():
	}
}

// simulateProgress fetches real job data from a past run and ticks
// through the progress during the dry-run delay so the TUI and Slack
// show realistic "X/Y jobs done" updates.
func (p *Pipeline) simulateProgress(ctx context.Context, idx int) {
	sr := p.stages[idx]
	if sr.RunID == 0 {
		p.dryRunDelay(ctx)
		return
	}

	status, err := p.Runner.Status(ctx, sr.Stage.Repo, sr.RunID)
	if err != nil || len(status.Jobs) == 0 {
		p.dryRunDelay(ctx)
		return
	}

	total := len(status.Jobs)
	interval := 2 * time.Second / time.Duration(total+1)

	for i := 0; i <= total; i++ {
		p.mu.Lock()
		sr.StatusText = fmt.Sprintf("%d/%d jobs done", i, total)
		p.mu.Unlock()

		if i < total {
			select {
			case <-time.After(interval):
			case <-ctx.Done():
				return
			}
		}
	}
}

func (p *Pipeline) runDryStage(ctx context.Context, idx int, resolvedInputs map[string]string, ref string) error {
	sr := p.stages[idx]

	dryCmd := gh.FormatCommand(sr.Stage.Repo, sr.Stage.Workflow, ref, resolvedInputs)

	runs, err := p.Runner.ListRuns(ctx, sr.Stage.Repo, sr.Stage.Workflow, "success", 1)
	if err != nil || len(runs) == 0 {
		p.mu.Lock()
		sr.RunURL = fmt.Sprintf("[DRY RUN] %s", dryCmd)
		sr.DryRunCmd = dryCmd
		p.mu.Unlock()
		p.dryRunDelay(ctx)
		p.succeedStage(idx)
		return nil
	}

	p.mu.Lock()
	sr.RunID = runs[0].ID
	sr.RunURL = runs[0].URL
	if sr.RunURL == "" {
		sr.RunURL = gh.RunURL(sr.Stage.Repo, runs[0].ID)
	}
	sr.DryRunCmd = dryCmd
	p.mu.Unlock()

	p.simulateProgress(ctx, idx)

	// Render the test breakdown in dry-run too (from the resolved past run's
	// artifact, if present) so operators can preview the format.
	p.attachTestSummary(ctx, idx)

	if len(sr.Stage.Outputs) > 0 {
		p.mu.Lock()
		sr.State = StateParsingOutputs
		p.mu.Unlock()

		if err := p.parseOutputs(ctx, idx); err != nil {
			p.failStage(idx, fmt.Sprintf("dry-run parsing outputs: %s", err.Error()))
			return err
		}
	}

	if p.FailStages[sr.Stage.ID] {
		p.failStage(idx, "simulated failure (--fail-stage)")
		return fmt.Errorf("simulated failure for stage %q", sr.Stage.ID)
	}

	p.succeedStage(idx)
	return nil
}

func (p *Pipeline) runHealthCheck(ctx context.Context, idx int) error {
	sr := p.stages[idx]
	url := config.ResolveTemplate(sr.Stage.URL, p.Values())
	expectVersion := config.ResolveTemplate(sr.Stage.ExpectVersion, p.Values())

	logger.Log("health-check.start: [%s] %s — url=%s expect_version=%s", sr.Env, sr.Stage.Name, url, expectVersion)

	client := &http.Client{Timeout: 10 * time.Second}

	var lastErr error
	delays := p.HealthCheckDelays
	if delays == nil {
		delays = defaultHealthCheckDelays
	}
	for attempt, delay := range delays {
		if delay > 0 {
			logger.Log("health-check.retry: [%s] %s — attempt %d, waiting %s", sr.Env, sr.Stage.Name, attempt+1, delay)
			p.mu.Lock()
			sr.StatusText = fmt.Sprintf("retry %d/%d", attempt, len(delays)-1)
			p.mu.Unlock()
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				p.failStage(idx, ctx.Err().Error())
				return ctx.Err()
			}
		}

		lastErr = p.doHealthCheck(ctx, client, idx, url, expectVersion)
		if lastErr == nil {
			p.succeedStage(idx)
			return nil
		}
		logger.Log("health-check.attempt-failed: [%s] %s — attempt %d: %s", sr.Env, sr.Stage.Name, attempt+1, lastErr)
	}

	p.failStage(idx, lastErr.Error())
	return lastErr
}

type healthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

func (p *Pipeline) doHealthCheck(ctx context.Context, client *http.Client, idx int, url, expectVersion string) error {
	sr := p.stages[idx]

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("fetching %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health endpoint returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("reading response: %w", err)
	}

	var health healthResponse
	if err := json.Unmarshal(body, &health); err != nil {
		return fmt.Errorf("parsing response: %w", err)
	}

	if health.Status != "healthy" {
		return fmt.Errorf("status is %q, expected \"healthy\"", health.Status)
	}

	if expectVersion != "" {
		if health.Version == "" {
			return fmt.Errorf("version check required but endpoint returned no version field")
		}
		if !strings.HasPrefix(expectVersion, health.Version) && !strings.HasPrefix(health.Version, expectVersion) {
			return fmt.Errorf("version mismatch: got %q, expected %q (prefix match)", health.Version, expectVersion)
		}
	}

	p.mu.Lock()
	sr.StatusText = fmt.Sprintf("healthy, version=%s", health.Version)
	p.mu.Unlock()

	return nil
}

func (p *Pipeline) runMatrix(ctx context.Context, idx int, baseInputs map[string]string, ref string) error {
	sr := p.stages[idx]
	var wg sync.WaitGroup
	var mu sync.Mutex
	var firstErr error

	for mi := range sr.MatrixRuns {
		wg.Add(1)
		go func(matrixIdx int) {
			defer wg.Done()
			mr := &sr.MatrixRuns[matrixIdx]

			merged := make(map[string]string)
			for k, v := range baseInputs {
				merged[k] = v
			}
			for k, v := range mr.Inputs {
				merged[k] = config.ResolveTemplate(v, p.Values())
			}

			if p.DryRun {
				dryCmd := gh.FormatCommand(sr.Stage.Repo, sr.Stage.Workflow, ref, merged)
				logger.Log("matrix.start: [%s] %s sub-run %d (dry-run)", sr.Env, sr.Stage.Name, matrixIdx)

				p.mu.Lock()
				mr.Inputs = merged
				mr.DryRunCmd = dryCmd
				mr.State = StateRunning
				p.mu.Unlock()

				if runs, err := p.Runner.ListRuns(ctx, sr.Stage.Repo, sr.Stage.Workflow, "success", 1); err == nil && len(runs) > 0 {
					runURL := runs[0].URL
					if runURL == "" {
						runURL = gh.RunURL(sr.Stage.Repo, runs[0].ID)
					}
					p.mu.Lock()
					mr.RunURL = runURL
					mr.RunID = runs[0].ID
					p.mu.Unlock()
				}

				p.dryRunDelay(ctx)

				p.mu.Lock()
				if p.FailStages[sr.Stage.ID] {
					mr.State = StateFailed
					mr.Error = "simulated failure (--fail-stage)"
					p.mu.Unlock()
					logger.Log("matrix.fail: [%s] %s sub-run %d — simulated failure", sr.Env, sr.Stage.Name, matrixIdx)
					mu.Lock()
					if firstErr == nil {
						firstErr = fmt.Errorf("simulated failure for stage %q", sr.Stage.ID)
					}
					mu.Unlock()
				} else {
					mr.State = StateSuccess
					p.mu.Unlock()
					logger.Log("matrix.success: [%s] %s sub-run %d", sr.Env, sr.Stage.Name, matrixIdx)
				}
				return
			}

			p.mu.Lock()
			mr.Inputs = merged
			mr.State = StateRunning
			p.mu.Unlock()
			logger.Log("matrix.start: [%s] %s sub-run %d — inputs=%v", sr.Env, sr.Stage.Name, matrixIdx, merged)

			runURL, err := p.Runner.Trigger(ctx, sr.Stage.Repo, sr.Stage.Workflow, ref, merged)
			if err != nil {
				p.mu.Lock()
				mr.State = StateFailed
				mr.Error = err.Error()
				p.mu.Unlock()
				logger.Log("matrix.fail: [%s] %s sub-run %d — trigger error: %s", sr.Env, sr.Stage.Name, matrixIdx, err)

				mu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
				return
			}

			runID, err := gh.ExtractRunID(runURL)
			if err != nil {
				p.mu.Lock()
				mr.State = StateFailed
				mr.Error = fmt.Sprintf("extracting run ID: %s", err.Error())
				p.mu.Unlock()

				mu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
				return
			}

			p.mu.Lock()
			mr.RunURL = runURL
			mr.RunID = runID
			p.mu.Unlock()

			status, err := gh.WaitForCompletion(ctx, p.Runner, sr.Stage.Repo, runID, 15*time.Second, func(s *gh.RunStatus) {
				p.mu.Lock()
				mr.StatusText = s.Progress()
				p.mu.Unlock()
				logger.Log("matrix.poll: [%s] %s sub-run %d — status=%s progress=%s (run=%d)", sr.Env, sr.Stage.Name, matrixIdx, s.Status, s.Progress(), runID)
			})
			if err != nil || status.Conclusion != "success" {
				p.mu.Lock()
				mr.State = StateFailed
				if err != nil {
					mr.Error = err.Error()
				} else {
					mr.Error = fmt.Sprintf("concluded with %s", status.Conclusion)
				}
				p.mu.Unlock()
				logger.Log("matrix.fail: [%s] %s sub-run %d — %s (url=%s)", sr.Env, sr.Stage.Name, matrixIdx, mr.Error, mr.RunURL)

				mu.Lock()
				if firstErr == nil {
					firstErr = fmt.Errorf("matrix run failed: %s", mr.Error)
				}
				mu.Unlock()
				return
			}

			p.mu.Lock()
			mr.State = StateSuccess
			p.mu.Unlock()
			logger.Log("matrix.success: [%s] %s sub-run %d (url=%s)", sr.Env, sr.Stage.Name, matrixIdx, mr.RunURL)
		}(mi)
	}

	wg.Wait()

	if firstErr != nil {
		p.failStage(idx, firstErr.Error())
		return firstErr
	}
	p.succeedStage(idx)
	return nil
}

func (p *Pipeline) parseOutputs(ctx context.Context, idx int) error {
	sr := p.stages[idx]

	p.mu.Lock()
	sr.State = StateParsingOutputs
	p.mu.Unlock()

	logs, err := p.Runner.Logs(ctx, sr.Stage.Repo, sr.RunID)
	if err != nil {
		return fmt.Errorf("fetching logs: %w", err)
	}

	for outputName, output := range sr.Stage.Outputs {
		value, err := gh.ParseOutputsFromLogs(logs, output.JobMatch, output.Pattern)
		if err != nil {
			return fmt.Errorf("output %q: %w", outputName, err)
		}

		key := fmt.Sprintf("%s.%s.%s", sr.Env, sr.Stage.ID, outputName)
		p.SetValue(key, value)
		logger.Log("stage.output: [%s] %s — %s=%s", sr.Env, sr.Stage.Name, key, value)

		p.mu.Lock()
		sr.Outputs[outputName] = value
		p.mu.Unlock()
	}

	return nil
}

// attachTestSummary downloads the `e2e-summary` artifact for a stage with
// `test_summary: true` and attaches the parsed per-suite breakdown to the
// StageRun. Best-effort: a runner without the optional ArtifactDownloader
// capability, a missing artifact, or a parse error is logged and ignored —
// these stages are advisory, so reporting detail must never affect the gate.
func (p *Pipeline) attachTestSummary(ctx context.Context, idx int) {
	p.mu.RLock()
	sr := p.stages[idx]
	enabled := sr.Stage.TestSummary
	repo := sr.Stage.Repo
	runID := sr.RunID
	name := sr.Stage.Name
	p.mu.RUnlock()

	if !enabled || runID == 0 {
		return
	}

	downloader, ok := p.Runner.(gh.ArtifactDownloader)
	if !ok {
		return
	}

	data, err := downloader.DownloadArtifactFile(ctx, repo, runID, testSummaryArtifact, testSummaryFile)
	if err != nil {
		logger.Log("stage.test-summary: [%s] %s — could not download %s: %v", sr.Env, name, testSummaryArtifact, err)
		return
	}

	summary, err := testreport.Parse(data)
	if err != nil {
		logger.Log("stage.test-summary: [%s] %s — could not parse summary: %v", sr.Env, name, err)
		return
	}

	p.mu.Lock()
	sr.TestReport = summary
	p.mu.Unlock()
	logger.Log("stage.test-summary: [%s] %s — attached (overall=%s, suites=%d)", sr.Env, name, summary.Overall, len(summary.Suites))
}

func (p *Pipeline) failStage(idx int, errMsg string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	sr := p.stages[idx]
	sr.State = StateFailed
	sr.Error = errMsg
	sr.EndTime = time.Now()
	logger.Log("stage.fail: [%s] %s — %s (duration=%s, url=%s)", sr.Env, sr.Stage.Name, errMsg, sr.Duration(), sr.RunURL)
}

func (p *Pipeline) succeedStage(idx int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	sr := p.stages[idx]
	sr.State = StateSuccess
	sr.EndTime = time.Now()
	logger.Log("stage.success: [%s] %s (duration=%s, url=%s)", sr.Env, sr.Stage.Name, sr.Duration(), sr.RunURL)
}

func (p *Pipeline) SkipStage(idx int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	sr := p.stages[idx]
	sr.State = StateSkipped
	if sr.EndTime.IsZero() {
		sr.EndTime = time.Now()
	}
	logger.Log("stage.skip: [%s] %s", sr.Env, sr.Stage.Name)
}

// RetryStage resets a failed stage to pending so it can be re-run.
func (p *Pipeline) RetryStage(idx int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	sr := p.stages[idx]
	logger.Log("stage.retry: [%s] %s", sr.Env, sr.Stage.Name)
	sr.State = StatePending
	sr.Error = ""
	sr.RunURL = ""
	sr.RunID = 0
	sr.StartTime = time.Time{}
	sr.EndTime = time.Time{}

	for i := range sr.MatrixRuns {
		sr.MatrixRuns[i].State = StatePending
		sr.MatrixRuns[i].Error = ""
		sr.MatrixRuns[i].RunURL = ""
		sr.MatrixRuns[i].RunID = 0
	}
}

// CompleteChecklist marks a checklist stage as complete.
func (p *Pipeline) CompleteChecklist(idx int) {
	p.succeedStage(idx)
}

// FailChecklist marks a checklist stage as failed with a reason.
func (p *Pipeline) FailChecklist(idx int, reason string) {
	p.failStage(idx, reason)
}

// FetchRollbackSnapshot queries GitHub for the current production state.
// Any fields set on p.Overrides win over the discovered values, and a
// source whose fields are fully overridden is skipped entirely so that
// a broken GH state does not block a release.
func (p *Pipeline) FetchRollbackSnapshot(ctx context.Context) error {
	cfg := p.Config.Pipeline.Rollback
	ov := p.Overrides

	artSrc := cfg.Sources.ArtifactID
	artifactFullyOverridden := ov.ArtifactID != ""
	if artSrc.Repo != "" && artSrc.Workflow != "" && !artifactFullyOverridden {
		runs, err := p.Runner.ListRuns(ctx, artSrc.Repo, artSrc.Workflow, "success", 20)
		if err != nil {
			return fmt.Errorf("listing artifact runs: %w", err)
		}

		re, err := regexp.Compile(artSrc.ExtractPattern)
		if err != nil {
			return fmt.Errorf("invalid artifact extract pattern: %w", err)
		}

		for _, run := range runs {
			if !matchesFilter(run.Name, artSrc.Filter) {
				continue
			}
			if matches := re.FindStringSubmatch(run.Name); len(matches) >= 2 {
				p.Snapshot.ArtifactID = matches[1]
				p.Snapshot.AppSourceURL = gh.RunURL(artSrc.Repo, run.ID)
				break
			}
		}

		if p.Snapshot.ArtifactID == "" {
			return fmt.Errorf("could not find previous app artifact ID from %s runs", artSrc.Workflow)
		}
	}

	imgSrc := cfg.Sources.ImageTags
	imagesFullyOverridden := ov.AgentImageTag != "" && ov.PreviewImageTag != "" && ov.PublishImageTag != ""
	if imgSrc.Repo != "" && imgSrc.Workflow != "" && !imagesFullyOverridden {
		runs, err := p.Runner.ListRuns(ctx, imgSrc.Repo, imgSrc.Workflow, "success", 20)
		if err != nil {
			return fmt.Errorf("listing image tag runs: %w", err)
		}

		var found bool
		for _, run := range runs {
			if !matchesFilter(run.Name, imgSrc.Filter) {
				continue
			}

			logs, err := p.Runner.Logs(ctx, imgSrc.Repo, run.ID)
			if err != nil {
				logger.Log("snapshot.skipping-run: id=%d err=%v", run.ID, err)
				continue
			}

			parsed := make(map[string]string)
			var parseErr error
			for key, pattern := range imgSrc.Patterns {
				value, err := gh.ParseOutputsFromLogs(logs, imgSrc.JobMatch, pattern)
				if err != nil {
					parseErr = err
					break
				}
				parsed[key] = value
			}
			if parseErr != nil {
				logger.Log("snapshot.skipping-run: id=%d err=%v", run.ID, parseErr)
				continue
			}

			p.Snapshot.ImagesSourceURL = gh.RunURL(imgSrc.Repo, run.ID)
			p.Snapshot.AgentImageTag = parsed["agent_image_tag"]
			p.Snapshot.PreviewImageTag = parsed["preview_image_tag"]
			p.Snapshot.PublishImageTag = parsed["publish_image_tag"]
			found = true
			break
		}

		if !found {
			return fmt.Errorf("could not find successful PROD preprov-management run with image tags in last %d runs", len(runs))
		}
	}

	if ov.ArtifactID != "" || ov.AgentImageTag != "" || ov.PreviewImageTag != "" || ov.PublishImageTag != "" {
		logger.Log("snapshot.overrides: artifact_id=%q agent=%q preview=%q publish=%q", ov.ArtifactID, ov.AgentImageTag, ov.PreviewImageTag, ov.PublishImageTag)
	}
	applySnapshotOverrides(&p.Snapshot, ov)

	p.SetValue("previous_good.artifact_id", p.Snapshot.ArtifactID)
	p.SetValue("previous_good.agent_image_tag", p.Snapshot.AgentImageTag)
	p.SetValue("previous_good.preview_image_tag", p.Snapshot.PreviewImageTag)
	p.SetValue("previous_good.publish_image_tag", p.Snapshot.PublishImageTag)

	logger.Log("snapshot.resolved: artifact_id=%s agent=%s preview=%s publish=%s", p.Snapshot.ArtifactID, p.Snapshot.AgentImageTag, p.Snapshot.PreviewImageTag, p.Snapshot.PublishImageTag)
	return nil
}

// applySnapshotOverrides copies any non-empty override fields onto the
// snapshot. Source URLs are rewritten so operators can tell at a glance
// whether the displayed values came from GitHub discovery, a CLI
// override, or a mix of the two (in which case the discovered URL is
// annotated as a partial override so it isn't trusted as a full
// source-of-truth for the displayed tags).
func applySnapshotOverrides(snap *RollbackSnapshot, ov SnapshotOverrides) {
	if ov.ArtifactID != "" {
		snap.ArtifactID = ov.ArtifactID
		snap.AppSourceURL = overriddenSourceURL
	}
	if ov.AgentImageTag != "" {
		snap.AgentImageTag = ov.AgentImageTag
	}
	if ov.PreviewImageTag != "" {
		snap.PreviewImageTag = ov.PreviewImageTag
	}
	if ov.PublishImageTag != "" {
		snap.PublishImageTag = ov.PublishImageTag
	}
	switch {
	case ov.AgentImageTag != "" && ov.PreviewImageTag != "" && ov.PublishImageTag != "":
		snap.ImagesSourceURL = overriddenSourceURL
	case ov.AgentImageTag != "" || ov.PreviewImageTag != "" || ov.PublishImageTag != "":
		if snap.ImagesSourceURL == "" {
			snap.ImagesSourceURL = partialOverrideMarker
		} else {
			snap.ImagesSourceURL = snap.ImagesSourceURL + " " + partialOverrideMarker
		}
	}
}

// FetchReleaseNotes resolves the target branch to a specific commit SHA,
// then compares the previous-good base commit against that pinned SHA.
// The base is normally the ext hash embedded in the agent image tag; if
// p.BaseCommitOverride is set, that SHA is used instead (bypassing ext-hash
// extraction entirely). The resolved head SHA is stored in values["commit"]
// so all downstream stages build from the exact commit shown in the release
// notes. If resolution fails, falls back to comparing against the branch
// name and logs a warning.
func (p *Pipeline) FetchReleaseNotes(ctx context.Context) ([]ReleaseNote, string, error) {
	var base string
	if p.BaseCommitOverride != "" {
		base = p.BaseCommitOverride
		logger.Log("release-notes: using overridden base commit %s (skipped ext-hash extraction from image tag %q)", base, p.Snapshot.AgentImageTag)
	} else {
		base = gh.ExtractExtHash(p.Snapshot.AgentImageTag)
		if base == "" {
			return nil, "", fmt.Errorf("could not extract ext hash from image tag %q", p.Snapshot.AgentImageTag)
		}
	}

	repo := p.Config.Pipeline.Rollback.Sources.ArtifactID.Repo
	if repo == "" {
		return nil, "", fmt.Errorf("no artifact repo configured for release notes")
	}

	head := p.Branch
	commitSHA, err := p.Runner.ResolveCommit(ctx, repo, p.Branch)
	if err != nil {
		logger.Log("release-notes: WARNING could not pin %s to commit SHA: %s (deploying branch tip)", p.Branch, err)
	} else {
		head = commitSHA
		p.SetValue("commit", commitSHA)
		logger.Log("release-notes: pinned %s to %s", p.Branch, commitSHA)
	}

	result, err := p.Runner.Compare(ctx, repo, base, head)
	if err != nil {
		return nil, "", err
	}

	logger.Log("release-notes: comparing %s...%s in %s — %d commits", base, head, repo, len(result.Commits))

	return ParseReleaseNotes(result.Commits), result.HTMLURL, nil
}

var prNumberRe = regexp.MustCompile(`#(\d+)`)

// ParseReleaseNotes extracts deduplicated PR entries from commit messages.
// Handles both squash-merge ("Title (#123)") and merge-commit
// ("Merge pull request #123 from ...\n\nTitle") formats.
func ParseReleaseNotes(commits []gh.CompareCommit) []ReleaseNote {
	seen := make(map[int]bool)
	var notes []ReleaseNote

	for _, c := range commits {
		lines := strings.SplitN(c.Message, "\n", 3)
		firstLine := lines[0]

		matches := prNumberRe.FindStringSubmatch(firstLine)
		if len(matches) < 2 {
			continue
		}

		var number int
		if _, err := fmt.Sscanf(matches[1], "%d", &number); err != nil || number == 0 || seen[number] {
			continue
		}
		seen[number] = true

		title := firstLine
		if strings.HasPrefix(firstLine, "Merge pull request") {
			// Merge commit: actual PR title is on line 3+
			if len(lines) >= 3 {
				title = strings.TrimSpace(lines[2])
			}
		} else {
			// Squash merge: strip trailing (#NNN)
			title = strings.TrimSpace(prNumberRe.ReplaceAllString(firstLine, ""))
			title = strings.TrimRight(title, " ()")
		}

		if title == "" {
			title = firstLine
		}

		notes = append(notes, ReleaseNote{
			Number: number,
			Title:  title,
			Author: c.Author,
		})
	}

	return notes
}

// BuildRollbackStages creates stage runs for the rollback steps.
func (p *Pipeline) BuildRollbackStages() {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, sr := range p.stages {
		if sr.Env == "rollback" {
			return
		}
	}

	for _, s := range p.Config.Pipeline.Rollback.Steps {
		sr := &StageRun{
			Stage:   s,
			Env:     "rollback",
			State:   StatePending,
			Outputs: make(map[string]string),
		}
		p.stages = append(p.stages, sr)
	}
}

// matchesFilter checks if a run title matches a simple filter expression.
// Supports "displayTitle contains 'X' and 'Y'" syntax.
func matchesFilter(title, filter string) bool {
	if filter == "" {
		return true
	}

	parts := strings.Split(filter, " and ")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		part = strings.TrimPrefix(part, "displayTitle contains ")
		part = strings.Trim(part, "'\"")
		if !strings.Contains(strings.ToLower(title), strings.ToLower(part)) {
			return false
		}
	}
	return true
}

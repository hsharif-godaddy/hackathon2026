package pipeline

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/airo-ai-builder/release-manager/internal/config"
	"github.com/airo-ai-builder/release-manager/internal/gh"
)

// mockRunner implements gh.Runner for testing.
type mockRunner struct {
	triggerFn  func(ctx context.Context, repo, workflow, ref string, inputs map[string]string) (string, error)
	statusFn   func(ctx context.Context, repo string, runID int64) (*gh.RunStatus, error)
	logsFn     func(ctx context.Context, repo string, runID int64) (string, error)
	listRunsFn func(ctx context.Context, repo, workflow, status string, limit int) ([]gh.RunListEntry, error)
	compareFn  func(ctx context.Context, repo, base, head string) (*gh.CompareResult, error)
	versionFn  func(ctx context.Context) (string, error)
	authFn     func(ctx context.Context) error
	repoFn     func(ctx context.Context, repo string) error
}

func (m *mockRunner) Trigger(ctx context.Context, repo, workflow, ref string, inputs map[string]string) (string, error) {
	if m.triggerFn != nil {
		return m.triggerFn(ctx, repo, workflow, ref, inputs)
	}
	return "https://github.com/org/repo/actions/runs/12345", nil
}

func (m *mockRunner) Status(ctx context.Context, repo string, runID int64) (*gh.RunStatus, error) {
	if m.statusFn != nil {
		return m.statusFn(ctx, repo, runID)
	}
	return &gh.RunStatus{Status: "completed", Conclusion: "success"}, nil
}

func (m *mockRunner) Logs(ctx context.Context, repo string, runID int64) (string, error) {
	if m.logsFn != nil {
		return m.logsFn(ctx, repo, runID)
	}
	return "", nil
}

func (m *mockRunner) ListRuns(ctx context.Context, repo, workflow, status string, limit int) ([]gh.RunListEntry, error) {
	if m.listRunsFn != nil {
		return m.listRunsFn(ctx, repo, workflow, status, limit)
	}
	return nil, nil
}

func (m *mockRunner) Version(ctx context.Context) (string, error) {
	if m.versionFn != nil {
		return m.versionFn(ctx)
	}
	return "2.87.0", nil
}

func (m *mockRunner) AuthStatus(ctx context.Context) error {
	if m.authFn != nil {
		return m.authFn(ctx)
	}
	return nil
}

func (m *mockRunner) Compare(ctx context.Context, repo, base, head string) (*gh.CompareResult, error) {
	if m.compareFn != nil {
		return m.compareFn(ctx, repo, base, head)
	}
	return &gh.CompareResult{}, nil
}

func (m *mockRunner) CheckRepoAccess(ctx context.Context, repo string) error {
	if m.repoFn != nil {
		return m.repoFn(ctx, repo)
	}
	return nil
}

func testConfig() *config.Config {
	return &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {
					Stages: []config.Stage{
						{ID: "deploy-app", Name: "Deploy App", Group: "deploy", Repo: "org/app", Workflow: "deploy.yml", Inputs: map[string]string{"env": "test"}},
						{ID: "build-images", Name: "Build Images", Group: "deploy", Repo: "org/infra", Workflow: "build.yml"},
						{ID: "e2e", Name: "E2E Tests", Group: "validate", Repo: "org/app", Workflow: "e2e.yml"},
						{ID: "checklist", Name: "Manual Check", Group: "validate", Type: "checklist", Items: []string{"verify A", "verify B"}},
					},
				},
				"prod": {
					Requires: "test",
					Stages: []config.Stage{
						{ID: "promote", Name: "Promote", Repo: "org/app", Workflow: "promote.yml", Inputs: map[string]string{"artifact_id": "{{test.deploy-app.artifact_id}}"}},
					},
				},
			},
			Rollback: config.RollbackConfig{
				Steps: []config.Stage{
					{ID: "rollback-app", Name: "Rollback App", Group: "rollback", Repo: "org/app", Workflow: "promote.yml", Inputs: map[string]string{"artifact_id": "{{previous_good.artifact_id}}"}},
					{ID: "rollback-images", Name: "Rollback Images", Group: "rollback", Repo: "org/infra", Workflow: "preprov.yml"},
				},
			},
		},
	}
}

func TestNew(t *testing.T) {
	cfg := testConfig()
	runner := &mockRunner{}

	p := New(cfg, runner, true, "main", []string{"deploy-app", "e2e"})

	if p.Config != cfg {
		t.Error("Config not set")
	}
	if p.Runner != runner {
		t.Error("Runner not set")
	}
	if !p.DryRun {
		t.Error("DryRun should be true")
	}
	if p.Branch != "main" {
		t.Errorf("Branch = %q, want %q", p.Branch, "main")
	}
	if !p.FailStages["deploy-app"] || !p.FailStages["e2e"] {
		t.Errorf("FailStages = %v, want deploy-app and e2e", p.FailStages)
	}

	vals := p.Values()
	if vals["branch"] != "main" {
		t.Errorf("values[branch] = %q, want %q", vals["branch"], "main")
	}
}

func TestNewNoFailStages(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "develop", nil)
	if len(p.FailStages) != 0 {
		t.Errorf("FailStages should be empty, got %v", p.FailStages)
	}
}

func TestStageStateString(t *testing.T) {
	tests := []struct {
		state StageState
		want  string
	}{
		{StatePending, "pending"},
		{StateRunning, "running"},
		{StateParsingOutputs, "parsing outputs"},
		{StateSuccess, "success"},
		{StateFailed, "failed"},
		{StateSkipped, "skipped"},
		{StageState(99), "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := tt.state.String(); got != tt.want {
				t.Errorf("String() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestStageStateSymbol(t *testing.T) {
	tests := []struct {
		state StageState
		want  string
	}{
		{StatePending, "○"},
		{StateRunning, "◉"},
		{StateParsingOutputs, "◎"},
		{StateSuccess, "●"},
		{StateFailed, "✗"},
		{StateSkipped, "⊘"},
		{StageState(99), "?"},
	}

	for _, tt := range tests {
		t.Run(tt.state.String(), func(t *testing.T) {
			if got := tt.state.Symbol(); got != tt.want {
				t.Errorf("Symbol() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestStageRunDuration(t *testing.T) {
	t.Run("zero when not started", func(t *testing.T) {
		sr := &StageRun{}
		if d := sr.Duration(); d != 0 {
			t.Errorf("Duration() = %v, want 0", d)
		}
	})

	t.Run("elapsed when running", func(t *testing.T) {
		sr := &StageRun{StartTime: time.Now().Add(-5 * time.Second)}
		d := sr.Duration()
		if d < 4*time.Second || d > 6*time.Second {
			t.Errorf("Duration() = %v, expected ~5s", d)
		}
	})

	t.Run("fixed when completed", func(t *testing.T) {
		start := time.Now().Add(-10 * time.Second)
		end := start.Add(3 * time.Second)
		sr := &StageRun{StartTime: start, EndTime: end}
		if d := sr.Duration(); d != 3*time.Second {
			t.Errorf("Duration() = %v, want 3s", d)
		}
	})
}

func TestBuildStages(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)

	if err := p.BuildStages("test"); err != nil {
		t.Fatalf("BuildStages(test) error: %v", err)
	}

	stages := p.Stages()
	if len(stages) != 4 {
		t.Fatalf("got %d stages, want 4", len(stages))
	}

	if stages[0].Stage.ID != "deploy-app" {
		t.Errorf("stage[0].ID = %q, want %q", stages[0].Stage.ID, "deploy-app")
	}
	if stages[0].Env != "test" {
		t.Errorf("stage[0].Env = %q, want %q", stages[0].Env, "test")
	}
	if stages[0].State != StatePending {
		t.Errorf("stage[0].State = %v, want pending", stages[0].State)
	}
}

func TestBuildStagesUnknownEnv(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)
	if err := p.BuildStages("nonexistent"); err == nil {
		t.Fatal("expected error for unknown environment")
	}
}

func TestBuildStagesMatrix(t *testing.T) {
	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"prod": {
					Stages: []config.Stage{
						{
							ID: "promote", Name: "Promote", Repo: "r", Workflow: "w",
							Matrix: []config.MatrixEntry{
								{Inputs: map[string]string{"image": "agent"}},
								{Inputs: map[string]string{"image": "preview"}},
								{Inputs: map[string]string{"image": "publish"}},
							},
						},
					},
				},
			},
		},
	}

	p := New(cfg, &mockRunner{}, false, "main", nil)
	p.BuildStages("prod")

	stages := p.Stages()
	if len(stages) != 1 {
		t.Fatalf("got %d stages, want 1", len(stages))
	}
	if len(stages[0].MatrixRuns) != 3 {
		t.Errorf("got %d matrix runs, want 3", len(stages[0].MatrixRuns))
	}
}

func TestStageGroups(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)
	p.BuildStages("test")

	groups := p.StageGroups("test")

	if len(groups) != 2 {
		t.Fatalf("got %d groups, want 2 (deploy + validate)", len(groups))
	}

	if len(groups[0]) != 2 {
		t.Errorf("deploy group: got %d stages, want 2", len(groups[0]))
	}
	if len(groups[1]) != 2 {
		t.Errorf("validate group: got %d stages, want 2", len(groups[1]))
	}
}

func TestStageGroupsSequential(t *testing.T) {
	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {
					Stages: []config.Stage{
						{ID: "a", Name: "A", Repo: "r", Workflow: "w"},
						{ID: "b", Name: "B", Repo: "r", Workflow: "w"},
						{ID: "c", Name: "C", Repo: "r", Workflow: "w"},
					},
				},
			},
		},
	}

	p := New(cfg, &mockRunner{}, false, "main", nil)
	p.BuildStages("test")

	groups := p.StageGroups("test")
	if len(groups) != 3 {
		t.Fatalf("got %d groups, want 3 (all sequential)", len(groups))
	}
	for i, g := range groups {
		if len(g) != 1 {
			t.Errorf("group[%d] has %d stages, want 1", i, len(g))
		}
	}
}

func TestStageGroupsMixed(t *testing.T) {
	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {
					Stages: []config.Stage{
						{ID: "a", Name: "A", Group: "parallel", Repo: "r", Workflow: "w"},
						{ID: "b", Name: "B", Group: "parallel", Repo: "r", Workflow: "w"},
						{ID: "c", Name: "C", Repo: "r", Workflow: "w"},
						{ID: "d", Name: "D", Group: "final", Repo: "r", Workflow: "w"},
					},
				},
			},
		},
	}

	p := New(cfg, &mockRunner{}, false, "main", nil)
	p.BuildStages("test")

	groups := p.StageGroups("test")
	if len(groups) != 3 {
		t.Fatalf("got %d groups, want 3 (parallel + sequential + final)", len(groups))
	}
	if len(groups[0]) != 2 {
		t.Errorf("parallel group: %d stages, want 2", len(groups[0]))
	}
	if len(groups[1]) != 1 {
		t.Errorf("sequential: %d stages, want 1", len(groups[1]))
	}
	if len(groups[2]) != 1 {
		t.Errorf("final group: %d stages, want 1", len(groups[2]))
	}
}

func TestSetValueAndValues(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)

	p.SetValue("test.deploy-app.artifact_id", "12345")
	p.SetValue("test.build-images.agent_image_tag", "pi-abc-ext-def")

	vals := p.Values()
	if vals["test.deploy-app.artifact_id"] != "12345" {
		t.Errorf("artifact_id = %q, want %q", vals["test.deploy-app.artifact_id"], "12345")
	}
	if vals["test.build-images.agent_image_tag"] != "pi-abc-ext-def" {
		t.Errorf("agent_image_tag = %q, want %q", vals["test.build-images.agent_image_tag"], "pi-abc-ext-def")
	}
	if vals["branch"] != "main" {
		t.Errorf("branch = %q, want %q", vals["branch"], "main")
	}
}

func TestValuesCopyIsolation(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)
	p.SetValue("key", "original")

	vals := p.Values()
	vals["key"] = "modified"

	if p.Values()["key"] != "original" {
		t.Error("Values() should return a copy, not a reference")
	}
}

func TestSkipStage(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)
	p.BuildStages("test")

	p.SkipStage(0)

	stages := p.Stages()
	if stages[0].State != StateSkipped {
		t.Errorf("State = %v, want skipped", stages[0].State)
	}
}

func TestRetryStage(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)
	p.BuildStages("test")

	sr := p.stages[0]
	sr.State = StateFailed
	sr.Error = "some error"
	sr.RunURL = "https://github.com/org/repo/actions/runs/123"
	sr.RunID = 123
	sr.StartTime = time.Now().Add(-5 * time.Second)
	sr.EndTime = time.Now()

	p.RetryStage(0)

	stages := p.Stages()
	if stages[0].State != StatePending {
		t.Errorf("State = %v, want pending", stages[0].State)
	}
	if stages[0].Error != "" {
		t.Errorf("Error = %q, want empty", stages[0].Error)
	}
	if stages[0].RunURL != "" {
		t.Errorf("RunURL = %q, want empty", stages[0].RunURL)
	}
	if stages[0].RunID != 0 {
		t.Errorf("RunID = %d, want 0", stages[0].RunID)
	}
	if !stages[0].StartTime.IsZero() {
		t.Error("StartTime should be zero")
	}
	if !stages[0].EndTime.IsZero() {
		t.Error("EndTime should be zero")
	}
}

func TestRetryStageResetsMatrixRuns(t *testing.T) {
	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"prod": {
					Stages: []config.Stage{
						{
							ID: "promote", Name: "Promote", Repo: "r", Workflow: "w",
							Matrix: []config.MatrixEntry{
								{Inputs: map[string]string{"image": "agent"}},
								{Inputs: map[string]string{"image": "preview"}},
							},
						},
					},
				},
			},
		},
	}

	p := New(cfg, &mockRunner{}, false, "main", nil)
	p.BuildStages("prod")

	p.stages[0].MatrixRuns[0].State = StateFailed
	p.stages[0].MatrixRuns[0].Error = "failed"
	p.stages[0].MatrixRuns[0].RunURL = "http://example.com"
	p.stages[0].MatrixRuns[0].RunID = 999

	p.RetryStage(0)

	for i, mr := range p.Stages()[0].MatrixRuns {
		if mr.State != StatePending {
			t.Errorf("MatrixRun[%d].State = %v, want pending", i, mr.State)
		}
		if mr.Error != "" {
			t.Errorf("MatrixRun[%d].Error = %q, want empty", i, mr.Error)
		}
		if mr.RunURL != "" {
			t.Errorf("MatrixRun[%d].RunURL = %q, want empty", i, mr.RunURL)
		}
		if mr.RunID != 0 {
			t.Errorf("MatrixRun[%d].RunID = %d, want 0", i, mr.RunID)
		}
	}
}

func TestCompleteChecklist(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)
	p.BuildStages("test")

	checklistIdx := 3
	p.CompleteChecklist(checklistIdx)

	stages := p.Stages()
	if stages[checklistIdx].State != StateSuccess {
		t.Errorf("State = %v, want success", stages[checklistIdx].State)
	}
}

func TestFailChecklist(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)
	p.BuildStages("test")

	checklistIdx := 3
	p.FailChecklist(checklistIdx, "2 of 4 items unchecked")

	stages := p.Stages()
	if stages[checklistIdx].State != StateFailed {
		t.Errorf("State = %v, want failed", stages[checklistIdx].State)
	}
	if stages[checklistIdx].Error != "2 of 4 items unchecked" {
		t.Errorf("Error = %q", stages[checklistIdx].Error)
	}
}

func TestBuildRollbackStages(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)
	p.BuildStages("test")

	initialCount := len(p.Stages())
	p.BuildRollbackStages()

	stages := p.Stages()
	if len(stages) != initialCount+2 {
		t.Fatalf("got %d stages, want %d (initial + 2 rollback)", len(stages), initialCount+2)
	}

	rollbackStages := stages[initialCount:]
	if rollbackStages[0].Env != "rollback" {
		t.Errorf("rollback stage env = %q, want %q", rollbackStages[0].Env, "rollback")
	}
	if rollbackStages[0].Stage.ID != "rollback-app" {
		t.Errorf("rollback stage ID = %q, want %q", rollbackStages[0].Stage.ID, "rollback-app")
	}
}

func TestBuildRollbackStagesIdempotent(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)
	p.BuildStages("test")

	p.BuildRollbackStages()
	count := len(p.Stages())

	p.BuildRollbackStages()
	if len(p.Stages()) != count {
		t.Errorf("double call added stages: got %d, want %d", len(p.Stages()), count)
	}
}

func TestMatchesFilter(t *testing.T) {
	tests := []struct {
		name   string
		title  string
		filter string
		want   bool
	}{
		{
			name:   "empty filter matches everything",
			title:  "any title",
			filter: "",
			want:   true,
		},
		{
			name:   "single contains match",
			title:  "Promoting 12345 to prod",
			filter: "displayTitle contains 'prod'",
			want:   true,
		},
		{
			name:   "single contains no match",
			title:  "Promoting 12345 to test",
			filter: "displayTitle contains 'prod'",
			want:   false,
		},
		{
			name:   "multiple AND conditions match",
			title:  "[app] Promoting 12345 to prod",
			filter: "displayTitle contains '[app]' and 'prod'",
			want:   true,
		},
		{
			name:   "multiple AND conditions partial match",
			title:  "[infra] Promoting 12345 to prod",
			filter: "displayTitle contains '[app]' and 'prod'",
			want:   false,
		},
		{
			name:   "case insensitive match",
			title:  "PROD deployment",
			filter: "displayTitle contains 'prod'",
			want:   true,
		},
		{
			name:   "double-quoted filter value",
			title:  "PROD deployment",
			filter: `displayTitle contains "PROD"`,
			want:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := matchesFilter(tt.title, tt.filter); got != tt.want {
				t.Errorf("matchesFilter(%q, %q) = %v, want %v", tt.title, tt.filter, got, tt.want)
			}
		})
	}
}

func TestRunStageChecklist(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)
	p.BuildStages("test")

	checklistIdx := 3
	err := p.RunStage(context.Background(), checklistIdx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	stages := p.Stages()
	if stages[checklistIdx].State != StateRunning {
		t.Errorf("State = %v, want running (checklist awaits TUI)", stages[checklistIdx].State)
	}
}

func TestRunStageLiveSuccess(t *testing.T) {
	runner := &mockRunner{
		triggerFn: func(_ context.Context, _, _, _ string, _ map[string]string) (string, error) {
			return "https://github.com/org/app/actions/runs/12345", nil
		},
		statusFn: func(_ context.Context, _ string, _ int64) (*gh.RunStatus, error) {
			return &gh.RunStatus{Status: "completed", Conclusion: "success"}, nil
		},
	}

	p := New(testConfig(), runner, false, "main", nil)
	p.BuildStages("test")

	err := p.RunStage(context.Background(), 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	stages := p.Stages()
	if stages[0].State != StateSuccess {
		t.Errorf("State = %v, want success", stages[0].State)
	}
	if stages[0].RunURL != "https://github.com/org/app/actions/runs/12345" {
		t.Errorf("RunURL = %q", stages[0].RunURL)
	}
	if stages[0].RunID != 12345 {
		t.Errorf("RunID = %d, want 12345", stages[0].RunID)
	}
}

func TestRunStagePassesResolvedRef(t *testing.T) {
	var capturedRef string
	runner := &mockRunner{
		triggerFn: func(_ context.Context, _, _, ref string, _ map[string]string) (string, error) {
			capturedRef = ref
			return "https://github.com/org/app/actions/runs/12345", nil
		},
		statusFn: func(_ context.Context, _ string, _ int64) (*gh.RunStatus, error) {
			return &gh.RunStatus{Status: "completed", Conclusion: "success"}, nil
		},
	}

	cfg := testConfig()
	cfg.Pipeline.Environments["test"].Stages[0].Ref = "{{branch}}"

	p := New(cfg, runner, false, "feature-branch", nil)
	p.BuildStages("test")

	if err := p.RunStage(context.Background(), 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if capturedRef != "feature-branch" {
		t.Errorf("ref = %q, want %q", capturedRef, "feature-branch")
	}
}

func TestRunStageOmitsRefWhenEmpty(t *testing.T) {
	var capturedRef string
	runner := &mockRunner{
		triggerFn: func(_ context.Context, _, _, ref string, _ map[string]string) (string, error) {
			capturedRef = ref
			return "https://github.com/org/app/actions/runs/12345", nil
		},
		statusFn: func(_ context.Context, _ string, _ int64) (*gh.RunStatus, error) {
			return &gh.RunStatus{Status: "completed", Conclusion: "success"}, nil
		},
	}

	p := New(testConfig(), runner, false, "main", nil)
	p.BuildStages("test")

	if err := p.RunStage(context.Background(), 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if capturedRef != "" {
		t.Errorf("ref = %q, want empty (no ref in stage config)", capturedRef)
	}
}

func TestRunStageLiveFailure(t *testing.T) {
	runner := &mockRunner{
		triggerFn: func(_ context.Context, _, _, _ string, _ map[string]string) (string, error) {
			return "https://github.com/org/app/actions/runs/12345", nil
		},
		statusFn: func(_ context.Context, _ string, _ int64) (*gh.RunStatus, error) {
			return &gh.RunStatus{Status: "completed", Conclusion: "failure"}, nil
		},
	}

	p := New(testConfig(), runner, false, "main", nil)
	p.BuildStages("test")

	err := p.RunStage(context.Background(), 0)
	if err == nil {
		t.Fatal("expected error for failed run")
	}

	if p.Stages()[0].State != StateFailed {
		t.Errorf("State = %v, want failed", p.Stages()[0].State)
	}
}

func TestRunStageTriggerError(t *testing.T) {
	runner := &mockRunner{
		triggerFn: func(_ context.Context, _, _, _ string, _ map[string]string) (string, error) {
			return "", fmt.Errorf("trigger failed")
		},
	}

	p := New(testConfig(), runner, false, "main", nil)
	p.BuildStages("test")

	err := p.RunStage(context.Background(), 0)
	if err == nil {
		t.Fatal("expected error from trigger")
	}

	if p.Stages()[0].State != StateFailed {
		t.Errorf("State = %v, want failed", p.Stages()[0].State)
	}
}

func TestRunStageLiveWithOutputs(t *testing.T) {
	runner := &mockRunner{
		triggerFn: func(_ context.Context, _, _, _ string, _ map[string]string) (string, error) {
			return "https://github.com/org/app/actions/runs/12345", nil
		},
		statusFn: func(_ context.Context, _ string, _ int64) (*gh.RunStatus, error) {
			return &gh.RunStatus{Status: "completed", Conclusion: "success"}, nil
		},
		logsFn: func(_ context.Context, _ string, _ int64) (string, error) {
			return "some-job / Upload\tArtifact ID: 99887766\n", nil
		},
	}

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {
					Stages: []config.Stage{
						{
							ID: "deploy", Name: "Deploy", Repo: "org/app", Workflow: "deploy.yml",
							Inputs: map[string]string{"env": "test"},
							Outputs: map[string]config.Output{
								"artifact_id": {
									From:    "run-log",
									JobMatch: "some-job.*Upload",
									Pattern: `Artifact ID: (\d+)`,
								},
							},
						},
					},
				},
			},
		},
	}

	p := New(cfg, runner, false, "main", nil)
	p.BuildStages("test")

	err := p.RunStage(context.Background(), 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	vals := p.Values()
	if vals["test.deploy.artifact_id"] != "99887766" {
		t.Errorf("artifact_id = %q, want %q", vals["test.deploy.artifact_id"], "99887766")
	}
}

func TestRunStageDryRunWithPastRun(t *testing.T) {
	runner := &mockRunner{
		listRunsFn: func(_ context.Context, _, _, _ string, _ int) ([]gh.RunListEntry, error) {
			return []gh.RunListEntry{
				{ID: 55555, URL: "https://github.com/org/app/actions/runs/55555"},
			}, nil
		},
	}

	p := New(testConfig(), runner, true, "main", nil)
	p.BuildStages("test")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	err := p.RunStage(ctx, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	stages := p.Stages()
	if stages[0].State != StateSuccess {
		t.Errorf("State = %v, want success", stages[0].State)
	}
	if stages[0].RunURL != "https://github.com/org/app/actions/runs/55555" {
		t.Errorf("RunURL = %q", stages[0].RunURL)
	}
	if stages[0].DryRunCmd == "" {
		t.Error("DryRunCmd should be populated")
	}
}

func TestRunStageDryRunSimulatedFailure(t *testing.T) {
	runner := &mockRunner{
		listRunsFn: func(_ context.Context, _, _, _ string, _ int) ([]gh.RunListEntry, error) {
			return []gh.RunListEntry{{ID: 1, URL: "https://github.com/org/app/actions/runs/1"}}, nil
		},
	}

	p := New(testConfig(), runner, true, "main", []string{"deploy-app"})
	p.BuildStages("test")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	err := p.RunStage(ctx, 0)
	if err == nil {
		t.Fatal("expected simulated failure")
	}

	if p.Stages()[0].State != StateFailed {
		t.Errorf("State = %v, want failed", p.Stages()[0].State)
	}
}

func TestStageGroupsRollback(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)
	p.BuildStages("test")
	p.BuildRollbackStages()

	groups := p.StageGroups("rollback")
	if len(groups) != 1 {
		t.Fatalf("got %d rollback groups, want 1", len(groups))
	}
	if len(groups[0]) != 2 {
		t.Errorf("rollback group has %d stages, want 2 (parallel)", len(groups[0]))
	}
}

func TestFetchRollbackSnapshot(t *testing.T) {
	runner := &mockRunner{
		listRunsFn: func(_ context.Context, _, workflow, _ string, _ int) ([]gh.RunListEntry, error) {
			switch workflow {
			case "promote-artifact.yml":
				return []gh.RunListEntry{
					{ID: 100, Name: "[app] Promoting 12345 to prod", URL: "https://github.com/org/app/actions/runs/100"},
				}, nil
			case "airo-preprov-management-unified.yml":
				return []gh.RunListEntry{
					{ID: 200, Name: "PROD deployment", URL: "https://github.com/org/infra/actions/runs/200"},
				}, nil
			}
			return nil, nil
		},
		logsFn: func(_ context.Context, _ string, runID int64) (string, error) {
			if runID == 200 {
				return `Upsert Template Images	AGENT_TAG="pi-aaa111-ext-bbb222"
Upsert Template Images	PREVIEW_TAG="pi-ccc333-ext-ddd444"
Upsert Template Images	PUBLISH_TAG="pi-eee555-ext-fff666"`, nil
			}
			return "", nil
		},
	}

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{ID: "a", Name: "A", Repo: "r", Workflow: "w"}}},
			},
			Rollback: config.RollbackConfig{
				Sources: config.RollbackSources{
					ArtifactID: config.RollbackSource{
						Repo:           "org/app",
						Workflow:       "promote-artifact.yml",
						Filter:         "displayTitle contains '[app]' and 'prod'",
						ExtractPattern: `Promoting (\d+) to prod`,
					},
					ImageTags: config.RollbackImageTags{
						Repo:     "org/infra",
						Workflow: "airo-preprov-management-unified.yml",
						Filter:   "displayTitle contains 'PROD'",
						JobMatch: "Upsert Template Images",
						Patterns: map[string]string{
							"agent_image_tag":   `AGENT_TAG="(pi-[a-f0-9]+-ext-[a-f0-9]+)"`,
							"preview_image_tag": `PREVIEW_TAG="(pi-[a-f0-9]+-ext-[a-f0-9]+)"`,
							"publish_image_tag": `PUBLISH_TAG="(pi-[a-f0-9]+-ext-[a-f0-9]+)"`,
						},
					},
				},
			},
		},
	}

	p := New(cfg, runner, false, "main", nil)
	if err := p.FetchRollbackSnapshot(context.Background()); err != nil {
		t.Fatalf("FetchRollbackSnapshot error: %v", err)
	}

	if p.Snapshot.ArtifactID != "12345" {
		t.Errorf("ArtifactID = %q, want %q", p.Snapshot.ArtifactID, "12345")
	}
	if p.Snapshot.AgentImageTag != "pi-aaa111-ext-bbb222" {
		t.Errorf("AgentImageTag = %q", p.Snapshot.AgentImageTag)
	}
	if p.Snapshot.PreviewImageTag != "pi-ccc333-ext-ddd444" {
		t.Errorf("PreviewImageTag = %q", p.Snapshot.PreviewImageTag)
	}
	if p.Snapshot.PublishImageTag != "pi-eee555-ext-fff666" {
		t.Errorf("PublishImageTag = %q", p.Snapshot.PublishImageTag)
	}

	vals := p.Values()
	if vals["previous_good.artifact_id"] != "12345" {
		t.Errorf("values[previous_good.artifact_id] = %q", vals["previous_good.artifact_id"])
	}
	if vals["previous_good.agent_image_tag"] != "pi-aaa111-ext-bbb222" {
		t.Errorf("values[previous_good.agent_image_tag] = %q", vals["previous_good.agent_image_tag"])
	}
}

func TestFetchRollbackSnapshotNoMatchingRuns(t *testing.T) {
	runner := &mockRunner{
		listRunsFn: func(_ context.Context, _, _ string, _ string, _ int) ([]gh.RunListEntry, error) {
			return []gh.RunListEntry{
				{ID: 100, Name: "unrelated run"},
			}, nil
		},
	}

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{ID: "a", Name: "A", Repo: "r", Workflow: "w"}}},
			},
			Rollback: config.RollbackConfig{
				Sources: config.RollbackSources{
					ArtifactID: config.RollbackSource{
						Repo:           "org/app",
						Workflow:       "promote-artifact.yml",
						Filter:         "displayTitle contains '[app]' and 'prod'",
						ExtractPattern: `Promoting (\d+) to prod`,
					},
				},
			},
		},
	}

	p := New(cfg, runner, false, "main", nil)
	if err := p.FetchRollbackSnapshot(context.Background()); err == nil {
		t.Fatal("expected error when no matching runs found")
	}
}

func TestRunStageBadRunURL(t *testing.T) {
	runner := &mockRunner{
		triggerFn: func(_ context.Context, _, _, _ string, _ map[string]string) (string, error) {
			return "not-a-valid-url", nil
		},
	}

	p := New(testConfig(), runner, false, "main", nil)
	p.BuildStages("test")

	err := p.RunStage(context.Background(), 0)
	if err == nil {
		t.Fatal("expected error when trigger returns invalid URL")
	}

	if p.Stages()[0].State != StateFailed {
		t.Errorf("State = %v, want failed", p.Stages()[0].State)
	}
}

func TestRunStageDryRunNoPastRuns(t *testing.T) {
	runner := &mockRunner{
		listRunsFn: func(_ context.Context, _, _, _ string, _ int) ([]gh.RunListEntry, error) {
			return nil, nil
		},
	}

	p := New(testConfig(), runner, true, "main", nil)
	p.BuildStages("test")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := p.RunStage(ctx, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	stages := p.Stages()
	if stages[0].State != StateSuccess {
		t.Errorf("State = %v, want success", stages[0].State)
	}
	if stages[0].DryRunCmd == "" {
		t.Error("DryRunCmd should be set even when no past runs")
	}
	if stages[0].RunURL == "" {
		t.Error("RunURL should contain DRY RUN prefix when no past runs")
	}
}

func TestRunStageMatrixLiveSuccess(t *testing.T) {
	var triggerCount atomic.Int32
	runner := &mockRunner{
		triggerFn: func(_ context.Context, _, _, _ string, _ map[string]string) (string, error) {
			n := triggerCount.Add(1)
			return fmt.Sprintf("https://github.com/org/infra/actions/runs/%d", 1000+n), nil
		},
		statusFn: func(_ context.Context, _ string, _ int64) (*gh.RunStatus, error) {
			return &gh.RunStatus{Status: "completed", Conclusion: "success"}, nil
		},
	}

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"prod": {
					Stages: []config.Stage{
						{
							ID: "promote", Name: "Promote Images", Repo: "org/infra", Workflow: "docker-promote.yml",
							Matrix: []config.MatrixEntry{
								{Inputs: map[string]string{"image": "agent"}},
								{Inputs: map[string]string{"image": "preview"}},
							},
						},
					},
				},
			},
		},
	}

	p := New(cfg, runner, false, "main", nil)
	p.BuildStages("prod")

	err := p.RunStage(context.Background(), 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	stages := p.Stages()
	if stages[0].State != StateSuccess {
		t.Errorf("State = %v, want success", stages[0].State)
	}
	if triggerCount.Load() != 2 {
		t.Errorf("trigger called %d times, want 2", triggerCount.Load())
	}
	for i, mr := range stages[0].MatrixRuns {
		if mr.State != StateSuccess {
			t.Errorf("MatrixRun[%d].State = %v, want success", i, mr.State)
		}
		if mr.RunURL == "" {
			t.Errorf("MatrixRun[%d].RunURL should be set", i)
		}
	}
}

func TestRunStageMatrixLivePartialFailure(t *testing.T) {
	var calls atomic.Int32
	runner := &mockRunner{
		triggerFn: func(_ context.Context, _, _, _ string, _ map[string]string) (string, error) {
			n := calls.Add(1)
			return fmt.Sprintf("https://github.com/org/infra/actions/runs/%d", 2000+n), nil
		},
		statusFn: func(_ context.Context, _ string, runID int64) (*gh.RunStatus, error) {
			if runID == 2001 {
				return &gh.RunStatus{Status: "completed", Conclusion: "failure"}, nil
			}
			return &gh.RunStatus{Status: "completed", Conclusion: "success"}, nil
		},
	}

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"prod": {
					Stages: []config.Stage{
						{
							ID: "promote", Name: "Promote", Repo: "org/infra", Workflow: "w.yml",
							Matrix: []config.MatrixEntry{
								{Inputs: map[string]string{"image": "agent"}},
								{Inputs: map[string]string{"image": "preview"}},
							},
						},
					},
				},
			},
		},
	}

	p := New(cfg, runner, false, "main", nil)
	p.BuildStages("prod")

	err := p.RunStage(context.Background(), 0)
	if err == nil {
		t.Fatal("expected error from matrix partial failure")
	}

	if p.Stages()[0].State != StateFailed {
		t.Errorf("State = %v, want failed", p.Stages()[0].State)
	}
}

func TestStageGroupsEmptyForNonexistentEnv(t *testing.T) {
	p := New(testConfig(), &mockRunner{}, false, "main", nil)
	p.BuildStages("test")

	groups := p.StageGroups("nonexistent")
	if len(groups) != 0 {
		t.Errorf("got %d groups, want 0 for nonexistent env", len(groups))
	}
}

func TestFetchRollbackSnapshotSourceURLs(t *testing.T) {
	runner := &mockRunner{
		listRunsFn: func(_ context.Context, _, workflow, _ string, _ int) ([]gh.RunListEntry, error) {
			switch workflow {
			case "promote.yml":
				return []gh.RunListEntry{
					{ID: 100, Name: "[app] Promoting 55555 to prod"},
				}, nil
			case "preprov.yml":
				return []gh.RunListEntry{
					{ID: 200, Name: "PROD deploy"},
				}, nil
			}
			return nil, nil
		},
		logsFn: func(_ context.Context, _ string, runID int64) (string, error) {
			if runID == 200 {
				return `Upsert Images	AGENT_TAG="pi-aaa-ext-bbb"
Upsert Images	PREVIEW_TAG="pi-ccc-ext-ddd"
Upsert Images	PUBLISH_TAG="pi-eee-ext-fff"`, nil
			}
			return "", nil
		},
	}

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{ID: "a", Name: "A", Repo: "r", Workflow: "w"}}},
			},
			Rollback: config.RollbackConfig{
				Sources: config.RollbackSources{
					ArtifactID: config.RollbackSource{
						Repo:           "org/app",
						Workflow:       "promote.yml",
						Filter:         "displayTitle contains '[app]' and 'prod'",
						ExtractPattern: `Promoting (\d+) to prod`,
					},
					ImageTags: config.RollbackImageTags{
						Repo:     "org/infra",
						Workflow: "preprov.yml",
						Filter:   "displayTitle contains 'PROD'",
						JobMatch: "Upsert Images",
						Patterns: map[string]string{
							"agent_image_tag":   `AGENT_TAG="(pi-[a-f0-9]+-ext-[a-f0-9]+)"`,
							"preview_image_tag": `PREVIEW_TAG="(pi-[a-f0-9]+-ext-[a-f0-9]+)"`,
							"publish_image_tag": `PUBLISH_TAG="(pi-[a-f0-9]+-ext-[a-f0-9]+)"`,
						},
					},
				},
			},
		},
	}

	p := New(cfg, runner, false, "main", nil)
	if err := p.FetchRollbackSnapshot(context.Background()); err != nil {
		t.Fatalf("FetchRollbackSnapshot error: %v", err)
	}

	if p.Snapshot.AppSourceURL != "https://github.com/org/app/actions/runs/100" {
		t.Errorf("AppSourceURL = %q", p.Snapshot.AppSourceURL)
	}
	if p.Snapshot.ImagesSourceURL != "https://github.com/org/infra/actions/runs/200" {
		t.Errorf("ImagesSourceURL = %q", p.Snapshot.ImagesSourceURL)
	}
}

func TestFetchRollbackSnapshotListRunsError(t *testing.T) {
	runner := &mockRunner{
		listRunsFn: func(_ context.Context, _, _ string, _ string, _ int) ([]gh.RunListEntry, error) {
			return nil, fmt.Errorf("API timeout")
		},
	}

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{ID: "a", Name: "A", Repo: "r", Workflow: "w"}}},
			},
			Rollback: config.RollbackConfig{
				Sources: config.RollbackSources{
					ArtifactID: config.RollbackSource{
						Repo:     "org/app",
						Workflow: "promote.yml",
					},
				},
			},
		},
	}

	p := New(cfg, runner, false, "main", nil)
	if err := p.FetchRollbackSnapshot(context.Background()); err == nil {
		t.Fatal("expected error when ListRuns fails")
	}
}

func TestParseReleaseNotesSquashMerge(t *testing.T) {
	commits := []gh.CompareCommit{
		{SHA: "aaa", Message: "Add dark mode toggle (#42)", Author: "alice"},
		{SHA: "bbb", Message: "Fix login redirect (#55)\n\nLong description", Author: "bob"},
		{SHA: "ccc", Message: "Update deps", Author: "bot"},
	}

	notes := ParseReleaseNotes(commits)
	if len(notes) != 2 {
		t.Fatalf("expected 2 notes, got %d", len(notes))
	}

	if notes[0].Number != 42 || notes[0].Title != "Add dark mode toggle" || notes[0].Author != "alice" {
		t.Errorf("note 0 mismatch: %+v", notes[0])
	}
	if notes[1].Number != 55 || notes[1].Title != "Fix login redirect" || notes[1].Author != "bob" {
		t.Errorf("note 1 mismatch: %+v", notes[1])
	}
}

func TestParseReleaseNotesMergeCommit(t *testing.T) {
	commits := []gh.CompareCommit{
		{SHA: "aaa", Message: "Merge pull request #99 from feature/auth\n\nAdd OAuth support", Author: "merger"},
	}

	notes := ParseReleaseNotes(commits)
	if len(notes) != 1 {
		t.Fatalf("expected 1 note, got %d", len(notes))
	}
	if notes[0].Number != 99 || notes[0].Title != "Add OAuth support" {
		t.Errorf("note mismatch: %+v", notes[0])
	}
}

func TestParseReleaseNotesDeduplicates(t *testing.T) {
	commits := []gh.CompareCommit{
		{SHA: "aaa", Message: "Fix bug (#10)", Author: "alice"},
		{SHA: "bbb", Message: "Merge pull request #10 from fix/bug\n\nFix bug", Author: "bob"},
	}

	notes := ParseReleaseNotes(commits)
	if len(notes) != 1 {
		t.Fatalf("expected 1 deduplicated note, got %d", len(notes))
	}
	if notes[0].Number != 10 {
		t.Errorf("expected PR #10, got #%d", notes[0].Number)
	}
}

func TestParseReleaseNotesEmpty(t *testing.T) {
	notes := ParseReleaseNotes(nil)
	if len(notes) != 0 {
		t.Errorf("expected 0 notes from nil commits, got %d", len(notes))
	}

	notes = ParseReleaseNotes([]gh.CompareCommit{
		{SHA: "aaa", Message: "no pr reference here", Author: "dev"},
	})
	if len(notes) != 0 {
		t.Errorf("expected 0 notes from commits without PR refs, got %d", len(notes))
	}
}

func TestFetchReleaseNotesSuccess(t *testing.T) {
	runner := &mockRunner{
		compareFn: func(_ context.Context, repo, base, head string) (*gh.CompareResult, error) {
			if repo != "org/app" {
				t.Errorf("unexpected repo: %s", repo)
			}
			if base != "4ba7665" {
				t.Errorf("unexpected base: %s", base)
			}
			if head != "main" {
				t.Errorf("unexpected head: %s", head)
			}
			return &gh.CompareResult{
				HTMLURL: "https://github.com/org/app/compare/4ba7665...main",
				Commits: []gh.CompareCommit{
					{SHA: "aaa", Message: "New feature (#7)", Author: "dev"},
				},
			}, nil
		},
	}

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Rollback: config.RollbackConfig{
				Sources: config.RollbackSources{
					ArtifactID: config.RollbackSource{Repo: "org/app"},
				},
			},
		},
	}

	p := New(cfg, runner, false, "main", nil)
	p.Snapshot.AgentImageTag = "pi-e2420b0-ext-4ba7665"

	notes, htmlURL, err := p.FetchReleaseNotes(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(notes) != 1 || notes[0].Number != 7 {
		t.Errorf("unexpected notes: %+v", notes)
	}
	if htmlURL != "https://github.com/org/app/compare/4ba7665...main" {
		t.Errorf("unexpected URL: %s", htmlURL)
	}
}

func TestFetchReleaseNotesBadImageTag(t *testing.T) {
	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Rollback: config.RollbackConfig{
				Sources: config.RollbackSources{
					ArtifactID: config.RollbackSource{Repo: "org/app"},
				},
			},
		},
	}

	p := New(cfg, &mockRunner{}, false, "main", nil)
	p.Snapshot.AgentImageTag = "pi-abc123"

	_, _, err := p.FetchReleaseNotes(context.Background())
	if err == nil {
		t.Fatal("expected error for bad image tag")
	}
}

func TestFetchReleaseNotesCompareError(t *testing.T) {
	runner := &mockRunner{
		compareFn: func(_ context.Context, _, _, _ string) (*gh.CompareResult, error) {
			return nil, fmt.Errorf("API error")
		},
	}

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Rollback: config.RollbackConfig{
				Sources: config.RollbackSources{
					ArtifactID: config.RollbackSource{Repo: "org/app"},
				},
			},
		},
	}

	p := New(cfg, runner, false, "main", nil)
	p.Snapshot.AgentImageTag = "pi-abc-ext-def"

	_, _, err := p.FetchReleaseNotes(context.Background())
	if err == nil {
		t.Fatal("expected error from Compare failure")
	}
}

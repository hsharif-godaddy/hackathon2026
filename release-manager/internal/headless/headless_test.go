package headless

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/airo-ai-builder/release-manager/internal/config"
	"github.com/airo-ai-builder/release-manager/internal/gh"
	"github.com/airo-ai-builder/release-manager/internal/pipeline"
)

// fakeRunner makes every dispatched stage resolve to a single run whose
// conclusion is configurable. Enough to exercise orchestrate without real gh.
type fakeRunner struct {
	conclusion string // "success" | "failure"
}

func (f *fakeRunner) Trigger(ctx context.Context, repo, workflow, ref string, inputs map[string]string) (string, error) {
	return "https://github.com/o/r/actions/runs/123", nil
}
func (f *fakeRunner) Status(ctx context.Context, repo string, runID int64) (*gh.RunStatus, error) {
	return &gh.RunStatus{Status: "completed", Conclusion: f.conclusion}, nil
}
func (f *fakeRunner) Logs(ctx context.Context, repo string, runID int64) (string, error) {
	return "", nil
}
func (f *fakeRunner) ListRuns(ctx context.Context, repo, workflow, status string, limit int) ([]gh.RunListEntry, error) {
	return nil, nil
}
func (f *fakeRunner) Compare(ctx context.Context, repo, base, head string) (*gh.CompareResult, error) {
	return &gh.CompareResult{}, nil
}
func (f *fakeRunner) ListReleases(ctx context.Context, repo string, limit int) ([]gh.ReleaseEntry, error) {
	return nil, nil
}
func (f *fakeRunner) CreateRelease(ctx context.Context, repo, tag, target, title, body string) (string, error) {
	return "https://github.com/o/r/releases/tag/" + tag, nil
}
func (f *fakeRunner) DeleteRelease(ctx context.Context, repo, tag string) error { return nil }
func (f *fakeRunner) ResolveCommit(ctx context.Context, repo, ref string) (string, error) {
	return "fullsha", nil
}
func (f *fakeRunner) Version(ctx context.Context) (string, error)            { return "gh 2.99.0", nil }
func (f *fakeRunner) AuthStatus(ctx context.Context) error                   { return nil }
func (f *fakeRunner) CheckRepoAccess(ctx context.Context, repo string) error { return nil }

func testConfig() *config.Config {
	return &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{
					{ID: "a", Name: "A", Group: "deploy", Repo: "o/r", Workflow: "a.yml"},
					{ID: "b", Name: "B", Group: "deploy", Repo: "o/r", Workflow: "b.yml"},
				}},
			},
		},
	}
}

func newRun(runner gh.Runner) *run {
	return &run{
		p:        pipeline.New(testConfig(), runner, false, "main", nil),
		operator: "alice",
		branch:   "main",
		start:    time.Now(),
	}
}

func TestOrchestrateSuccess(t *testing.T) {
	r := newRun(&fakeRunner{conclusion: "success"})
	if err := r.p.BuildStages("test"); err != nil {
		t.Fatal(err)
	}
	if err := r.orchestrate(context.Background(), r.p.StageGroups("test")); err != nil {
		t.Fatalf("orchestrate: %v", err)
	}
	for _, sr := range r.p.Stages() {
		if sr.State != pipeline.StateSuccess {
			t.Errorf("stage %s state = %v, want success", sr.Stage.ID, sr.State)
		}
	}
}

func TestOrchestrateAdvisoryFailureDoesNotBlock(t *testing.T) {
	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{
					{ID: "e2e", Name: "E2E", Group: "validate", Advisory: true, Repo: "o/r", Workflow: "e2e.yml"},
				}},
			},
		},
	}
	r := &run{p: pipeline.New(cfg, &fakeRunner{conclusion: "failure"}, false, "main", nil), start: time.Now()}
	if err := r.p.BuildStages("test"); err != nil {
		t.Fatal(err)
	}
	if err := r.orchestrate(context.Background(), r.p.StageGroups("test")); err != nil {
		t.Fatalf("an advisory stage failure must NOT fail the phase, got: %v", err)
	}
	// …but it's still recorded as failed so the reviewer sees it.
	if r.p.Stages()[0].State != pipeline.StateFailed {
		t.Errorf("advisory stage state = %v, want failed (surfaced for the reviewer)", r.p.Stages()[0].State)
	}
}

func TestOrchestrateFailurePropagates(t *testing.T) {
	r := newRun(&fakeRunner{conclusion: "failure"})
	if err := r.p.BuildStages("test"); err != nil {
		t.Fatal(err)
	}
	if err := r.orchestrate(context.Background(), r.p.StageGroups("test")); err == nil {
		t.Fatal("orchestrate returned nil, want error when a stage concludes failure")
	}
}

func TestStateFileRoundTrip(t *testing.T) {
	r := newRun(&fakeRunner{conclusion: "success"})
	if err := r.p.BuildStages("test"); err != nil {
		t.Fatal(err)
	}
	r.p.SetValue("commit", "deadbeefcafe")
	r.releaseNotes = []pipeline.ReleaseNote{{Number: 7, Title: "Thing", Author: "bob"}}
	r.releaseNotesURL = "https://x/compare"

	path := filepath.Join(t.TempDir(), "state.json")
	if err := r.writeState(path); err != nil {
		t.Fatalf("writeState: %v", err)
	}

	st, err := readState(path)
	if err != nil {
		t.Fatalf("readState: %v", err)
	}
	if st.Operator != "alice" || st.Branch != "main" {
		t.Errorf("meta not preserved: %+v", st)
	}
	if len(st.ReleaseNotes) != 1 || st.ReleaseNotes[0].Number != 7 {
		t.Errorf("release notes not preserved: %+v", st.ReleaseNotes)
	}
	// The embedded pipeline state must re-import into a fresh prod pipeline.
	prod := pipeline.New(testConfig(), &fakeRunner{}, false, "main", nil)
	if err := prod.ImportState(st.Pipeline); err != nil {
		t.Fatalf("ImportState(embedded): %v", err)
	}
	if got := prod.Values()["commit"]; got != "deadbeefcafe" {
		t.Errorf("imported commit = %q, want deadbeefcafe", got)
	}
	if n := len(prod.Stages()); n != 2 {
		t.Errorf("imported stages = %d, want 2", n)
	}

	// writeState must error without a path (test phase requires one).
	if err := r.writeState(""); err == nil {
		t.Error("writeState(\"\") = nil, want error")
	}
}

func TestAwaitingState(t *testing.T) {
	r := newRun(&fakeRunner{conclusion: "success"})
	r.runURL = "https://github.com/o/r/actions/runs/99"

	s := r.awaitingState()
	if !s.AwaitingApproval {
		t.Error("awaitingState should set AwaitingApproval=true")
	}
	if s.Finished {
		t.Error("awaitingState must not be Finished (the gate is non-terminal)")
	}
	if s.RunURL != "https://github.com/o/r/actions/runs/99" {
		t.Errorf("awaitingState RunURL = %q, want the run URL", s.RunURL)
	}
}

func TestEnvOrder(t *testing.T) {
	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{ID: "t", Name: "T"}}},
				"prod": {Stages: []config.Stage{{ID: "p", Name: "P"}}},
			},
		},
	}
	r := &run{p: pipeline.New(cfg, &fakeRunner{}, false, "main", nil)}
	_ = r.p.BuildStages("test")
	_ = r.p.BuildStages("prod")
	got := r.envOrder()
	if len(got) != 2 || got[0] != "test" || got[1] != "prod" {
		t.Errorf("envOrder = %v, want [test prod]", got)
	}
}

// Guard: phaseState marshals/unmarshals with a raw pipeline payload.
func TestPhaseStateJSON(t *testing.T) {
	ps := phaseState{Pipeline: json.RawMessage(`{"stages":[],"values":{},"snapshot":{}}`), Operator: "x"}
	b, err := json.Marshal(ps)
	if err != nil {
		t.Fatal(err)
	}
	var back phaseState
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if back.Operator != "x" {
		t.Errorf("operator round-trip = %q", back.Operator)
	}
}

func TestWriteChecklistSection(t *testing.T) {
	stages := []*pipeline.StageRun{
		{Env: "test", Stage: config.Stage{Type: "workflow", Name: "E2E"}}, // not a checklist
		{Env: "test", Stage: config.Stage{Type: "checklist", Name: "Manual Checklist", Items: []string{"Load test URL", "Create an app"}}},
		{Env: "prod", Stage: config.Stage{Type: "checklist", Name: "Manual Checklist", Items: []string{"Load prod URL"}}},
	}

	var test bytes.Buffer
	writeChecklistSection(&test, "test", stages)
	out := test.String()
	for _, want := range []string{"- [ ] Load test URL", "- [ ] Create an app", "Manual Checklist"} {
		if !strings.Contains(out, want) {
			t.Errorf("test checklist missing %q in:\n%s", want, out)
		}
	}
	if strings.Contains(out, "Load prod URL") {
		t.Errorf("prod item leaked into the test section:\n%s", out)
	}

	// An env with no checklist stage produces nothing (no stray header).
	var none bytes.Buffer
	writeChecklistSection(&none, "staging", stages)
	if none.Len() != 0 {
		t.Errorf("expected no output for an env without a checklist, got %q", none.String())
	}
}

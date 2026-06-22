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
// It also implements gh.Approver so the gate-attribution paths are testable;
// an empty approvals slice models "no decision recorded".
type fakeRunner struct {
	conclusion string // "success" | "failure"
	approvals  []gh.Approval
}

// RunApprovals satisfies gh.Approver — returns the canned approval history.
func (f *fakeRunner) RunApprovals(ctx context.Context, repo string, runID int64) ([]gh.Approval, error) {
	return f.approvals, nil
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
		runner:   runner,
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

// withRunEnv sets the GHA run identifiers gateDecision reads, restored on
// cleanup so other tests aren't affected.
func withRunEnv(t *testing.T) {
	t.Helper()
	t.Setenv("GITHUB_REPOSITORY", "gdcorp-partners/airo-app-builder")
	t.Setenv("GITHUB_RUN_ID", "123")
}

func TestDeclineMessageRejected(t *testing.T) {
	withRunEnv(t)
	r := newRun(&fakeRunner{approvals: []gh.Approval{
		{State: "approved", User: "earlier", Environments: []string{"release-prod-approval"}},
		{State: "rejected", User: "matkinson-godaddy", Comment: "e2e tests are failing", Environments: []string{"release-prod-approval"}},
	}})
	r.repo, r.runID = "gdcorp-partners/airo-app-builder", 123

	got := r.declineMessage(context.Background())
	want := "Release rejected by @matkinson-godaddy — e2e tests are failing"
	if got != want {
		t.Errorf("declineMessage = %q, want %q", got, want)
	}
}

func TestDeclineMessageNoComment(t *testing.T) {
	r := newRun(&fakeRunner{approvals: []gh.Approval{
		{State: "rejected", User: "bob", Environments: []string{"release-prod-approval"}},
	}})
	r.repo, r.runID = "o/r", 123
	if got := r.declineMessage(context.Background()); got != "Release rejected by @bob" {
		t.Errorf("declineMessage = %q, want %q", got, "Release rejected by @bob")
	}
}

func TestDeclineMessageCanceled(t *testing.T) {
	// No approval recorded (hard cancel) ⇒ plain "Release canceled".
	r := newRun(&fakeRunner{})
	r.repo, r.runID = "o/r", 123
	if got := r.declineMessage(context.Background()); got != "Release canceled" {
		t.Errorf("declineMessage = %q, want %q", got, "Release canceled")
	}
}

func TestGateApprover(t *testing.T) {
	r := newRun(&fakeRunner{approvals: []gh.Approval{
		{State: "approved", User: "hdewan-godaddy", Environments: []string{"release-prod-approval"}},
	}})
	r.repo, r.runID = "o/r", 123
	if got := r.gateApprover(context.Background()); got != "hdewan-godaddy" {
		t.Errorf("gateApprover = %q, want %q", got, "hdewan-godaddy")
	}
}

func TestGateDecisionDryRunSkips(t *testing.T) {
	// Dry-run must not hit the approvals API even when a decision exists.
	r := newRun(&fakeRunner{approvals: []gh.Approval{
		{State: "rejected", User: "bob", Environments: []string{"release-prod-approval"}},
	}})
	r.repo, r.runID = "o/r", 123
	r.dryRun = true
	if got := r.declineMessage(context.Background()); got != "Release canceled" {
		t.Errorf("dry-run declineMessage = %q, want %q (no API attribution)", got, "Release canceled")
	}
}

func TestGateDecisionWrongEnvIgnored(t *testing.T) {
	// A review for a different environment must not be attributed to the gate.
	r := newRun(&fakeRunner{approvals: []gh.Approval{
		{State: "rejected", User: "bob", Environments: []string{"some-other-env"}},
	}})
	r.repo, r.runID = "o/r", 123
	if got := r.declineMessage(context.Background()); got != "Release canceled" {
		t.Errorf("declineMessage = %q, want %q (wrong env ignored)", got, "Release canceled")
	}
}

func TestAbortMessageReasonOverride(t *testing.T) {
	// A review exists, but an explicit reason (the supersede janitor's) wins
	// and the approval history is not consulted.
	r := newRun(&fakeRunner{approvals: []gh.Approval{
		{State: "rejected", User: "bob", Environments: []string{"release-prod-approval"}},
	}})
	r.repo, r.runID = "o/r", 123

	const reason = "Superseded — no approval before the next scheduled release"
	if got := r.abortMessage(context.Background(), reason); got != reason {
		t.Errorf("abortMessage(reason) = %q, want the reason verbatim", got)
	}
	// Blank/whitespace reason falls back to the approval-derived decline message.
	if got := r.abortMessage(context.Background(), "  "); got != "Release rejected by @bob" {
		t.Errorf("abortMessage(blank) = %q, want derived decline message", got)
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

// recordingRunner records Trigger dispatches so the dark-RG teardown's guard and
// dispatch contract can be asserted.
type recordingRunner struct {
	fakeRunner
	triggers []triggeredWorkflow
}

type triggeredWorkflow struct {
	repo, workflow string
	inputs         map[string]string
}

func (r *recordingRunner) Trigger(ctx context.Context, repo, workflow, ref string, inputs map[string]string) (string, error) {
	r.triggers = append(r.triggers, triggeredWorkflow{repo: repo, workflow: workflow, inputs: inputs})
	return "https://github.com/o/r/actions/runs/123", nil
}

// teardownDarkRG must no-op when no dark Release Group was created (e.g. a cancel
// during the test phase), so the abort path never dispatches a bogus rollback.
func TestTeardownDarkRGNoopWithoutReleaseGroupID(t *testing.T) {
	runner := &recordingRunner{}
	r := newRun(runner)
	r.teardownDarkRG(context.Background())
	if len(runner.triggers) != 0 {
		t.Fatalf("teardownDarkRG dispatched %d workflow(s) with no release_group_id; want 0", len(runner.triggers))
	}
}

// When the dark phase captured a Release Group id, the abort path rolls it back
// via pioneer-infra release-group-simple.yml with the reconciled inputs.
func TestTeardownDarkRGRollsBackWhenPresent(t *testing.T) {
	runner := &recordingRunner{}
	r := newRun(runner)
	r.p.SetValue("prod-dark.dark-create-rg.release_group_id", "rg-abc123")

	r.teardownDarkRG(context.Background())

	if len(runner.triggers) != 1 {
		t.Fatalf("expected exactly 1 teardown dispatch, got %d", len(runner.triggers))
	}
	got := runner.triggers[0]
	if got.repo != darkRGRepo || got.workflow != darkRGWorkflow {
		t.Errorf("dispatched %s/%s, want %s/%s", got.repo, got.workflow, darkRGRepo, darkRGWorkflow)
	}
	if got.inputs["action"] != "Rollback" {
		t.Errorf("action = %q, want Rollback", got.inputs["action"])
	}
	if got.inputs["releaseGroupId"] != "rg-abc123" {
		t.Errorf("releaseGroupId = %q, want rg-abc123", got.inputs["releaseGroupId"])
	}
	if got.inputs["environment"] != darkRGMgmtEnv {
		t.Errorf("environment = %q, want %s", got.inputs["environment"], darkRGMgmtEnv)
	}
}

// darkURL must produce a URL whose hostname + x-katana-version selector are what
// tests/helpers/auth.ts seedDarkVersionCookie parses (cookie domain = hostname,
// value = selector), pinned to the build commit.
func TestDarkURL(t *testing.T) {
	got := darkURL("abc123def")
	want := "https://airo-builder.godaddy.com?x-katana-version=abc123def&cookie=1"
	if got != want {
		t.Errorf("darkURL = %q, want %q", got, want)
	}
}

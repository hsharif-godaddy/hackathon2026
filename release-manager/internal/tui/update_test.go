package tui

import (
	"context"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/airo-ai-builder/release-manager/internal/config"
	"github.com/airo-ai-builder/release-manager/internal/gh"
	"github.com/airo-ai-builder/release-manager/internal/pipeline"
)

func TestExtractVersion(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "gh version output",
			input: "gh version 2.87.0 (2026-03-15)",
			want:  "2.87.0",
		},
		{
			name:  "just version number",
			input: "2.87.0",
			want:  "2.87.0",
		},
		{
			name:  "version with v prefix",
			input: "v1.2.3",
			want:  "1.2.3",
		},
		{
			name:  "version at end",
			input: "version 3.0.1",
			want:  "3.0.1",
		},
		{
			name:  "no version number",
			input: "no numbers here",
			want:  "no numbers here",
		},
		{
			name:  "empty string",
			input: "",
			want:  "",
		},
		{
			name:  "version with trailing text",
			input: "gh version 2.87.0-beta (build abc123)",
			want:  "2.87.0",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := extractVersion(tt.input); got != tt.want {
				t.Errorf("extractVersion(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestIsVersionSufficient(t *testing.T) {
	tests := []struct {
		name       string
		versionStr string
		major      int
		minor      int
		patch      int
		want       bool
	}{
		{
			name:       "exact match",
			versionStr: "gh version 2.87.0 (2026-03-15)",
			major:      2, minor: 87, patch: 0,
			want: true,
		},
		{
			name:       "higher patch",
			versionStr: "gh version 2.87.5",
			major:      2, minor: 87, patch: 0,
			want: true,
		},
		{
			name:       "higher minor",
			versionStr: "gh version 2.90.0",
			major:      2, minor: 87, patch: 0,
			want: true,
		},
		{
			name:       "higher major",
			versionStr: "gh version 3.0.0",
			major:      2, minor: 87, patch: 0,
			want: true,
		},
		{
			name:       "lower patch",
			versionStr: "gh version 2.86.9",
			major:      2, minor: 87, patch: 0,
			want: false,
		},
		{
			name:       "lower minor",
			versionStr: "gh version 2.80.0",
			major:      2, minor: 87, patch: 0,
			want: false,
		},
		{
			name:       "lower major",
			versionStr: "gh version 1.99.99",
			major:      2, minor: 87, patch: 0,
			want: false,
		},
		{
			name:       "just numbers",
			versionStr: "2.87.0",
			major:      2, minor: 87, patch: 0,
			want: true,
		},
		{
			name:       "invalid version string",
			versionStr: "not a version",
			major:      2, minor: 87, patch: 0,
			want: false,
		},
		{
			name:       "empty string",
			versionStr: "",
			major:      2, minor: 87, patch: 0,
			want: false,
		},
		{
			name:       "exact patch boundary",
			versionStr: "2.87.1",
			major:      2, minor: 87, patch: 1,
			want: true,
		},
		{
			name:       "below patch boundary",
			versionStr: "2.87.0",
			major:      2, minor: 87, patch: 1,
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isVersionSufficient(tt.versionStr, tt.major, tt.minor, tt.patch); got != tt.want {
				t.Errorf("isVersionSufficient(%q, %d, %d, %d) = %v, want %v",
					tt.versionStr, tt.major, tt.minor, tt.patch, got, tt.want)
			}
		})
	}
}

func TestHandleGroupCompleteDuplicateIsNoop(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{ID: "a"}, {ID: "b"}}},
			},
		},
	}

	m := Model{
		config:          cfg,
		pipeline:        pipeline.New(cfg, nil, true, "main", nil),
		ctx:             ctx,
		cancel:          cancel,
		phase:           phaseRunning,
		envOrder:        []string{"test"},
		currentEnvIdx:   0,
		envGroups:       [][]int{{0, 1}, {2, 3}},
		currentGroupIdx: 0,
		fv:              &formValues{},
	}

	// First groupCompleteMsg for group 0 should advance to group 1.
	result, _ := m.handleGroupComplete(groupCompleteMsg{env: "test", group: 0})
	m = result.(Model)

	if m.currentGroupIdx != 1 {
		t.Fatalf("after first msg: currentGroupIdx = %d, want 1", m.currentGroupIdx)
	}

	// Duplicate groupCompleteMsg for group 0 should be ignored.
	result, cmd := m.handleGroupComplete(groupCompleteMsg{env: "test", group: 0})
	m = result.(Model)

	if m.currentGroupIdx != 1 {
		t.Fatalf("after duplicate msg: currentGroupIdx = %d, want 1", m.currentGroupIdx)
	}
	if cmd != nil {
		t.Fatalf("duplicate msg should return nil cmd, got %v", cmd)
	}
}

func TestHandleRollbackGroupDoneDuplicateIsNoop(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	m := Model{
		ctx:              ctx,
		cancel:           cancel,
		phase:            phaseRollbackRunning,
		rollbackGroups:   [][]int{{0}, {1}},
		rollbackGroupIdx: 0,
		fv:               &formValues{},
	}

	// First rollbackGroupDoneMsg for group 0 should advance to group 1.
	result, _ := m.handleRollbackGroupDone(rollbackGroupDoneMsg{group: 0})
	m = result.(Model)

	if m.rollbackGroupIdx != 1 {
		t.Fatalf("after first msg: rollbackGroupIdx = %d, want 1", m.rollbackGroupIdx)
	}

	// Duplicate rollbackGroupDoneMsg for group 0 should be ignored.
	result, cmd := m.handleRollbackGroupDone(rollbackGroupDoneMsg{group: 0})
	m = result.(Model)

	if m.rollbackGroupIdx != 1 {
		t.Fatalf("after duplicate msg: rollbackGroupIdx = %d, want 1", m.rollbackGroupIdx)
	}
	if cmd != nil {
		t.Fatalf("duplicate msg should return nil cmd, got %v", cmd)
	}
}

func TestFailurePromptTitleIdentifiesStage(t *testing.T) {
	m := newProdFailureModel(t)

	title := m.failurePromptTitle()

	for _, want := range []string{"PROD failed: Promote App", "promote failed"} {
		if !strings.Contains(title, want) {
			t.Fatalf("expected %q in title, got %q", want, title)
		}
	}
}

func TestRetryWithDeferredFailureWaitsForRetryResult(t *testing.T) {
	m := newProdFailureModel(t)
	m.fv.choice = "retry"

	result, _ := m.handleFormDone()
	m = result.(Model)

	if m.phase != phaseRunning {
		t.Fatalf("phase = %v, want phaseRunning", m.phase)
	}
	if m.form != nil {
		t.Fatal("form should be nil while retry is running")
	}
	if len(m.deferredFailures) != 1 || m.deferredFailures[0] != 1 {
		t.Fatalf("deferredFailures = %v, want [1]", m.deferredFailures)
	}

	m.pipeline.CompleteChecklist(0)
	result, _ = m.handleStageComplete(stageCompleteMsg{idx: 0})
	m = result.(Model)

	if m.phase != phaseFailurePrompt {
		t.Fatalf("phase = %v, want phaseFailurePrompt", m.phase)
	}
	if m.failedStageIdx != 1 {
		t.Fatalf("failedStageIdx = %d, want 1", m.failedStageIdx)
	}
	if m.form == nil {
		t.Fatal("expected deferred failure form after retry succeeded")
	}
	if len(m.deferredFailures) != 0 {
		t.Fatalf("deferredFailures = %v, want empty", m.deferredFailures)
	}
}

func TestContinueAfterRetrySuccessCompletesProd(t *testing.T) {
	m := newProdFailureModel(t)
	m.fv.choice = "retry"

	result, _ := m.handleFormDone()
	m = result.(Model)
	m.pipeline.CompleteChecklist(0)
	result, _ = m.handleStageComplete(stageCompleteMsg{idx: 0})
	m = result.(Model)

	m.fv.choice = "retry"
	result, _ = m.handleFormDone()
	m = result.(Model)
	m.pipeline.FailChecklist(1, "still failing")
	result, _ = m.handleStageComplete(stageCompleteMsg{idx: 1, err: context.Canceled})
	m = result.(Model)

	m.fv.choice = "continue"
	result, _ = m.handleFormDone()
	m = result.(Model)

	cmd := m.checkGroupCompletion()
	if cmd == nil {
		t.Fatal("expected group completion command after continuing final failed prod stage")
	}
	rawMsg := cmd()
	msg, ok := rawMsg.(groupCompleteMsg)
	if !ok {
		t.Fatalf("expected groupCompleteMsg, got %T", rawMsg)
	}

	result, cmd = m.handleGroupComplete(msg)
	m = result.(Model)

	// startReleaseCreation always enters phaseCreatingRelease (so handlers
	// can guard against late messages racing with ctrl+c).
	if m.phase != phaseCreatingRelease {
		t.Fatalf("phase = %v, want phaseCreatingRelease, got %v", m.phase, m.phase)
	}

	// Release config is not set in the test model, so startReleaseCreation
	// short-circuits with a releaseCreatedMsg{} that triggers the completion
	// form once processed.
	if cmd == nil {
		t.Fatal("expected releaseCreatedMsg command after all envs complete")
	}
	rawMsg = cmd()
	relMsg, ok := rawMsg.(releaseCreatedMsg)
	if !ok {
		t.Fatalf("expected releaseCreatedMsg, got %T", rawMsg)
	}
	result, _ = m.Update(relMsg)
	m = result.(Model)

	if m.phase != phaseComplete {
		t.Fatalf("phase after releaseCreatedMsg = %v, want phaseComplete", m.phase)
	}
	if m.form == nil {
		t.Fatal("expected completion form")
	}
}

func TestStartExitCleanupShowsProgressInsteadOfQuitHint(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.config.Release = config.ReleaseConfig{Repo: "org/app", Enabled: true}
		m.config.Lock = config.LockConfig{SSMParameter: "/deploy-lock"}
		m.lockHeld = true
	})
	m.pipeline.BuildStages("test")

	result, cmd := m.startExitCleanup(true)
	m = result

	if cmd == nil {
		t.Fatal("expected cleanup command")
	}
	if m.phase != phaseCleanup {
		t.Fatalf("phase = %v, want phaseCleanup", m.phase)
	}
	// Release creation moved to phaseCreatingRelease, so the cleanup status
	// only mentions Slack + lock release now.
	if !strings.Contains(m.statusMessage, "releasing deploy lock") {
		t.Fatalf("expected %q in status message, got %q", "releasing deploy lock", m.statusMessage)
	}

	view := m.View().Content
	if strings.Contains(view, "ctrl+c to quit") {
		t.Fatalf("cleanup view should not show quit hint:\n%s", view)
	}
	if !strings.Contains(view, "please wait") {
		t.Fatalf("cleanup view should ask users to wait:\n%s", view)
	}
}

func TestStartExitCleanupNoWorkReturnsQuitWithoutCleanupPhase(t *testing.T) {
	m := newTestModel()
	before := m.phase

	result, cmd := m.startExitCleanup(false)

	if cmd == nil {
		t.Fatal("expected quit command when no cleanup work is needed")
	}
	if result.phase != before {
		t.Fatalf("phase = %v, want unchanged %v", result.phase, before)
	}
}

func TestCleanupPhaseIgnoresQuitKeys(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.phase = phaseCleanup
		m.statusMessage = "Finalizing: releasing deploy lock..."
	})

	result, cmd := m.Update(tea.KeyPressMsg(tea.Key{Code: 'c', Mod: tea.ModCtrl}))
	m = result.(Model)

	if cmd != nil {
		t.Fatalf("ctrl+c during cleanup should be ignored, got cmd %v", cmd)
	}
	if m.phase != phaseCleanup {
		t.Fatalf("phase = %v, want phaseCleanup", m.phase)
	}

	result, cmd = m.Update(tea.KeyPressMsg(tea.Key{Text: "q", Code: 'q'}))
	m = result.(Model)

	if cmd != nil {
		t.Fatalf("q during cleanup should be ignored, got cmd %v", cmd)
	}
	if m.phase != phaseCleanup {
		t.Fatalf("phase = %v, want phaseCleanup", m.phase)
	}

	m.phase = phaseCleanupDone
	result, cmd = m.Update(tea.KeyPressMsg(tea.Key{Code: 'c', Mod: tea.ModCtrl}))
	m = result.(Model)

	if cmd != nil {
		t.Fatalf("ctrl+c during cleanup done should be ignored, got cmd %v", cmd)
	}
	if m.phase != phaseCleanupDone {
		t.Fatalf("phase = %v, want phaseCleanupDone", m.phase)
	}
}

func TestExitCleanupDoneShowsCompleteBeforeQuit(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.phase = phaseCleanup
		m.statusMessage = "Finalizing: releasing deploy lock..."
	})

	result, cmd := m.Update(exitCleanupDoneMsg{})
	m = result.(Model)

	if cmd == nil {
		t.Fatal("expected delayed quit command")
	}
	if m.phase != phaseCleanupDone {
		t.Fatalf("phase = %v, want phaseCleanupDone", m.phase)
	}

	view := m.View().Content
	if !strings.Contains(view, "Final cleanup complete.") {
		t.Fatalf("expected complete message:\n%s", view)
	}
	if strings.Contains(view, "please wait") {
		t.Fatalf("done view should not ask users to wait:\n%s", view)
	}
	if !strings.Contains(view, "done; exiting") {
		t.Fatalf("done view should say exiting:\n%s", view)
	}
}

func TestExitCleanupDoneWarnsWhenCleanupIncomplete(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.phase = phaseCleanup
		m.statusMessage = "Finalizing: releasing deploy lock..."
	})

	result, cmd := m.Update(exitCleanupDoneMsg{warning: "Final cleanup may not have completed; check logs."})
	m = result.(Model)

	if cmd == nil {
		t.Fatal("expected delayed quit command")
	}
	if m.phase != phaseCleanupDone {
		t.Fatalf("phase = %v, want phaseCleanupDone", m.phase)
	}

	view := m.View().Content
	for _, want := range []string{"⚠", "Final cleanup may not have completed", "done; exiting"} {
		if !strings.Contains(view, want) {
			t.Fatalf("expected %q in warning view:\n%s", want, view)
		}
	}
	if strings.Contains(view, "Final cleanup complete.") {
		t.Fatalf("warning view should not claim cleanup completed:\n%s", view)
	}
}

func TestDeferFailureDeduplicatesQueuedFailures(t *testing.T) {
	m := newProdFailureModel(t)
	m.deferredFailures = nil

	m.deferFailure(m.failedStageIdx)
	if len(m.deferredFailures) != 0 {
		t.Fatalf("deferredFailures = %v, want empty when deferring current failure", m.deferredFailures)
	}

	m.deferFailure(1)
	m.deferFailure(1)
	if len(m.deferredFailures) != 1 || m.deferredFailures[0] != 1 {
		t.Fatalf("deferredFailures = %v, want [1]", m.deferredFailures)
	}

	m.deferFailure(2)
	if len(m.deferredFailures) != 2 || m.deferredFailures[0] != 1 || m.deferredFailures[1] != 2 {
		t.Fatalf("deferredFailures = %v, want [1 2]", m.deferredFailures)
	}
}

func TestDeferFailureKeepsIndexZeroOutsideFailurePrompt(t *testing.T) {
	m := newProdFailureModel(t)
	m.phase = phaseChecklist
	m.deferredFailures = nil

	m.deferFailure(0)

	if len(m.deferredFailures) != 1 || m.deferredFailures[0] != 0 {
		t.Fatalf("deferredFailures = %v, want [0]", m.deferredFailures)
	}
}

func TestBuildNextFailureFormSkipsStaleDeferredFailures(t *testing.T) {
	m := newProdFailureModel(t)
	m.pipeline.CompleteChecklist(1)
	m.deferredFailures = []int{1, 0}

	cmd := m.buildNextFailureForm()

	if cmd == nil {
		t.Fatal("expected failure form for next failed stage")
	}
	if m.failedStageIdx != 0 {
		t.Fatalf("failedStageIdx = %d, want 0", m.failedStageIdx)
	}
	if len(m.deferredFailures) != 0 {
		t.Fatalf("deferredFailures = %v, want empty", m.deferredFailures)
	}
}

func TestBuildNextFailureFormKeepsInFlightDeferredFailure(t *testing.T) {
	m := newProdFailureModel(t)
	m.pipeline.RetryStage(1)
	m.deferredFailures = []int{1, 0}

	cmd := m.buildNextFailureForm()

	if cmd != nil {
		t.Fatalf("expected no form while deferred failure is in flight, got %v", cmd)
	}
	if len(m.deferredFailures) != 2 || m.deferredFailures[0] != 1 || m.deferredFailures[1] != 0 {
		t.Fatalf("deferredFailures = %v, want [1 0]", m.deferredFailures)
	}
}

func TestBuildNextFailureFormPromptsAfterInFlightFailureResolves(t *testing.T) {
	m := newProdFailureModel(t)
	m.pipeline.RetryStage(1)
	m.deferredFailures = []int{1, 0}

	cmd := m.buildNextFailureForm()
	if cmd != nil {
		t.Fatalf("expected no form while first deferred failure is in flight, got %v", cmd)
	}

	m.pipeline.CompleteChecklist(1)
	cmd = m.buildNextFailureForm()

	if cmd == nil {
		t.Fatal("expected failure form after in-flight deferred failure resolves")
	}
	if m.failedStageIdx != 0 {
		t.Fatalf("failedStageIdx = %d, want 0", m.failedStageIdx)
	}
	if len(m.deferredFailures) != 0 {
		t.Fatalf("deferredFailures = %v, want empty", m.deferredFailures)
	}
}

func TestBuildNextFailureFormUsesFailedBeforeInFlight(t *testing.T) {
	m := newProdFailureModel(t)
	m.pipeline.RetryStage(1)
	m.deferredFailures = []int{0, 1}

	cmd := m.buildNextFailureForm()

	if cmd == nil {
		t.Fatal("expected failure form for failed stage before in-flight stage")
	}
	if m.failedStageIdx != 0 {
		t.Fatalf("failedStageIdx = %d, want 0", m.failedStageIdx)
	}
	if len(m.deferredFailures) != 1 || m.deferredFailures[0] != 1 {
		t.Fatalf("deferredFailures = %v, want [1]", m.deferredFailures)
	}
}

func TestFailurePromptUsesFallbackNameForInvalidStageIndex(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.phase = phaseFailurePrompt
		m.failedStageIdx = -1
		m.fv.choice = "abort"
	})

	result, _ := m.handleFormDone()
	m = result.(Model)

	if m.phase != phaseAborted {
		t.Fatalf("phase = %v, want phaseAborted", m.phase)
	}
}

func TestFailedStageReturnsFalseWithoutPipeline(t *testing.T) {
	stage, ok := (Model{failedStageIdx: 0}).failedStage()

	if ok {
		t.Fatalf("ok = true, want false with stage %v", stage)
	}
	if stage != nil {
		t.Fatalf("stage = %v, want nil", stage)
	}
}

func TestPreflightStringRequiredFailureShowsHint(t *testing.T) {
	m := Model{
		preflight: []preflightCheck{
			{Name: "gh CLI installed", Done: true, Passed: true, Required: true},
			{Name: "aws CLI authenticated", Done: true, Passed: false, Required: true, Error: "Token expired", Hint: "run: aws sso login --profile test"},
		},
	}

	output := m.preflightString()

	for _, want := range []string{"aws CLI authenticated", "Token expired", "run: aws sso login --profile test"} {
		if !strings.Contains(output, want) {
			t.Errorf("expected %q in output, got:\n%s", want, output)
		}
	}
}

func TestRenderSlackDeployValuesUsesStageOutputs(t *testing.T) {
	stages := []*pipeline.StageRun{
		{
			Env:     "test",
			Outputs: map[string]string{"artifact_id": "195147"},
		},
		{
			Env: "test",
			Outputs: map[string]string{
				"agent_image_tag":   "pi-abc-ext-def",
				"preview_image_tag": "pi-abc-ext-def",
				"publish_image_tag": "pi-abc-ext-def",
			},
		},
		{
			Env:     "test",
			Outputs: map[string]string{},
		},
		{
			Env:     "prod",
			Outputs: map[string]string{"artifact_id": "200000"},
		},
	}

	m := Model{envOrder: []string{"test", "prod"}}
	var sb strings.Builder
	m.renderSlackDeployValues(&sb, "prod", stages)
	output := sb.String()

	for _, want := range []string{
		"artifact: `200000`",
		"agent: `pi-abc-ext-def`",
		"preview: `pi-abc-ext-def`",
		"publish: `pi-abc-ext-def`",
	} {
		if !strings.Contains(output, want) {
			t.Errorf("expected %q in output, got:\n%s", want, output)
		}
	}
	if strings.Contains(output, "195147") {
		t.Errorf("prod stage should override test artifact_id, got:\n%s", output)
	}
}

func TestRenderSlackDeployValuesSkipsFirstEnv(t *testing.T) {
	stages := []*pipeline.StageRun{
		{
			Env: "test",
			Outputs: map[string]string{
				"agent_image_tag": "pi-abc-ext-def",
			},
		},
	}

	m := Model{envOrder: []string{"test", "prod"}}
	var sb strings.Builder
	m.renderSlackDeployValues(&sb, "test", stages)

	if sb.Len() != 0 {
		t.Errorf("expected no output for first env, got:\n%s", sb.String())
	}
}

func TestRenderSlackDeployValuesSkipsRollbackStages(t *testing.T) {
	stages := []*pipeline.StageRun{
		{
			Env: "test",
			Outputs: map[string]string{
				"agent_image_tag":   "pi-new-ext-new",
				"preview_image_tag": "pi-new-ext-new",
				"publish_image_tag": "pi-new-ext-new",
			},
		},
		{
			Env: "rollback",
			Outputs: map[string]string{
				"agent_image_tag":   "pi-old-ext-old",
				"preview_image_tag": "pi-old-ext-old",
				"publish_image_tag": "pi-old-ext-old",
			},
		},
	}

	m := Model{envOrder: []string{"test", "prod"}}
	var sb strings.Builder
	m.renderSlackDeployValues(&sb, "prod", stages)
	output := sb.String()

	if strings.Contains(output, "pi-old-ext-old") {
		t.Errorf("rollback stage outputs should be excluded, got:\n%s", output)
	}
	if !strings.Contains(output, "pi-new-ext-new") {
		t.Errorf("expected new image tag in output, got:\n%s", output)
	}
}

func TestRenderSlackDeployValuesNoOutputsNoLine(t *testing.T) {
	stages := []*pipeline.StageRun{
		{
			Env:     "test",
			Outputs: map[string]string{},
		},
		{
			Env:     "prod",
			Outputs: map[string]string{},
		},
	}

	m := Model{envOrder: []string{"test", "prod"}}
	var sb strings.Builder
	m.renderSlackDeployValues(&sb, "prod", stages)

	if sb.Len() != 0 {
		t.Errorf("expected no output when no stages have values, got:\n%s", sb.String())
	}
}

func TestSlackEmojiToUnicode(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"check mark", ":white_check_mark: Deploy", "\u2705 Deploy"},
		{"x mark", ":x: Failed", "\u274C Failed"},
		{"rocket", ":rocket: Launching", "\U0001F680 Launching"},
		{"checkered flag", ":checkered_flag: Done", "\U0001F3C1 Done"},
		{"blue circle", ":large_blue_circle: Running", "\U0001F535 Running"},
		{"white circle", ":white_circle: Pending", "\u26AA Pending"},
		{"no entry", ":no_entry: Blocked", "\u26D4 Blocked"},
		{"fast forward", ":fast_forward: Skipped", "\u23E9 Skipped"},
		{"label", ":label: v1.0", "\U0001F3F7\uFE0F v1.0"},
		{"spinner removed", ":spinner_: Loading", " Loading"},
		{"multiple emoji", ":rocket: :white_check_mark:", "\U0001F680 \u2705"},
		{"no emoji", "plain text", "plain text"},
		{"empty string", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := slackEmojiToUnicode(tt.input); got != tt.want {
				t.Errorf("slackEmojiToUnicode(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func newTestModel(opts ...func(*Model)) Model {
	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{ID: "deploy", Name: "Deploy App to Test"}}},
			},
		},
	}
	p := pipeline.New(cfg, nil, true, "main", nil)
	m := Model{
		config:         cfg,
		pipeline:       p,
		branch:         "main",
		operator:       "testuser",
		envOrder:       []string{"test"},
		fv:             &formValues{},
		failedStageIdx: -1,
	}
	for _, fn := range opts {
		fn(&m)
	}
	return m
}

func TestSlackMessageHeader(t *testing.T) {
	m := newTestModel()
	msg := m.slackMessage(false)

	if !strings.Contains(msg, ":rocket: **testuser** is deploying `main`") {
		t.Errorf("missing header, got:\n%s", msg)
	}
}

func TestSlackMessageHeaderWithCommit(t *testing.T) {
	m := newTestModel()
	m.pipeline.SetValue("commit", "abc1234def5678")

	msg := m.slackMessage(false)

	if !strings.Contains(msg, "(`abc1234`)") {
		t.Errorf("expected truncated commit hash, got:\n%s", msg)
	}
}

func TestSlackMessageDryRun(t *testing.T) {
	m := newTestModel(func(m *Model) { m.dryRun = true })
	msg := m.slackMessage(false)

	if !strings.Contains(msg, "(DRY RUN)") {
		t.Errorf("expected DRY RUN badge, got:\n%s", msg)
	}
}

func TestSlackMessageReleaseNotes(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.releaseNotes = []pipeline.ReleaseNote{
			{Number: 100, Title: "fix: first bug", Author: "alice"},
			{Number: 200, Title: "feat: new feature", Author: "bob"},
		}
		m.releaseNotesURL = "https://github.com/org/repo/compare/a...b"
	})

	msg := m.slackMessage(false)

	for _, want := range []string{
		"**Release Notes** (2 PRs)",
		"[Full diff](https://github.com/org/repo/compare/a...b)",
		"• #100 fix: first bug - `alice`",
		"• #200 feat: new feature - `bob`",
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("expected %q in output, got:\n%s", want, msg)
		}
	}
}

func TestSlackMessageReleaseNotesURLOnly(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.releaseNotesURL = "https://github.com/org/repo/compare/a...b"
	})

	msg := m.slackMessage(false)

	if !strings.Contains(msg, "[Full diff](https://github.com/org/repo/compare/a...b)") {
		t.Errorf("expected full diff link, got:\n%s", msg)
	}
	if strings.Contains(msg, "**Release Notes**") {
		t.Errorf("should not show Release Notes header without PRs, got:\n%s", msg)
	}
}

func TestSlackMessageStages(t *testing.T) {
	m := newTestModel()
	m.pipeline.BuildStages("test")
	m.pipeline.CompleteChecklist(0)

	msg := m.slackMessage(false)

	for _, want := range []string{
		"**TEST**",
		":white_check_mark:",
		"Deploy App to Test",
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("expected %q in output, got:\n%s", want, msg)
		}
	}
}

func TestSlackMessageMatrixRuns(t *testing.T) {
	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{
					ID:   "promote",
					Name: "Promote Images",
					Matrix: []config.MatrixEntry{
						{Inputs: map[string]string{"env": "prod", "image": "agent"}},
					},
				}}},
			},
		},
	}
	p := pipeline.New(cfg, nil, true, "main", nil)
	p.BuildStages("test")

	m := Model{
		config:   cfg,
		pipeline: p,
		branch:   "main",
		operator: "testuser",
		envOrder: []string{"test"},
		fv:       &formValues{},
	}

	msg := m.slackMessage(false)

	if !strings.Contains(msg, nbspx2) {
		t.Errorf("matrix runs should be indented with nbspx2, got:\n%s", msg)
	}
	if !strings.Contains(msg, "env=prod image=agent") {
		t.Errorf("expected matrix inputs, got:\n%s", msg)
	}
}

func TestSlackMessageInProgress(t *testing.T) {
	m := newTestModel()
	msg := m.slackMessage(false)

	if !strings.Contains(msg, ":spinner_: *In progress...*") {
		t.Errorf("expected in-progress footer, got:\n%s", msg)
	}
}

func TestSlackMessageComplete(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.startTime = time.Now().Add(-30 * time.Second)
	})

	msg := m.slackMessage(true)

	if !strings.Contains(msg, ":checkered_flag: **Complete**") {
		t.Errorf("expected complete footer, got:\n%s", msg)
	}
}

func TestSlackMessageFinishedWithReleaseTag(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.startTime = time.Now().Add(-15 * time.Second)
		m.releaseTag = "v2026.05.14.1"
		m.releaseURL = "https://github.com/org/app/releases/tag/v2026.05.14.1"
	})

	msg := m.slackMessage(true)

	want := ":label: [v2026.05.14.1](https://github.com/org/app/releases/tag/v2026.05.14.1)"
	if !strings.Contains(msg, want) {
		t.Errorf("expected release link %q in finished message, got:\n%s", want, msg)
	}
}

func TestSlackMessageFinishedWithoutReleaseTagOmitsLink(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.startTime = time.Now().Add(-15 * time.Second)
	})

	msg := m.slackMessage(true)

	if strings.Contains(msg, ":label:") {
		t.Errorf("did not expect :label: marker without releaseTag, got:\n%s", msg)
	}
}

func TestSlackMessageInProgressOmitsReleaseTag(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.releaseTag = "v2026.05.14.1"
		m.releaseURL = "https://example/v"
	})

	msg := m.slackMessage(false)

	if strings.Contains(msg, ":label:") {
		t.Errorf("in-progress message should not include release link, got:\n%s", msg)
	}
}

func TestSlackMessageAborted(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.phase = phaseAborted
		m.statusMessage = "Aborted by user"
		m.startTime = time.Now().Add(-10 * time.Second)
	})

	msg := m.slackMessage(true)

	if !strings.Contains(msg, ":no_entry: **Aborted by user**") {
		t.Errorf("expected aborted footer, got:\n%s", msg)
	}
}

func TestSlackMessageUsesMarkdownFormat(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.releaseNotes = []pipeline.ReleaseNote{
			{Number: 42, Title: "test PR", Author: "dev"},
		}
		m.releaseNotesURL = "https://github.com/org/repo/compare/a...b"
	})

	msg := m.slackMessage(true)

	if strings.Contains(msg, "<https://") {
		t.Errorf("should not contain mrkdwn link syntax, got:\n%s", msg)
	}
	if strings.Contains(msg, "|Full diff>") {
		t.Errorf("should not contain mrkdwn link labels, got:\n%s", msg)
	}
	if !strings.Contains(msg, "[Full diff](") {
		t.Errorf("expected standard markdown links, got:\n%s", msg)
	}
	if !strings.Contains(msg, "**testuser**") {
		t.Errorf("expected ** bold syntax, got:\n%s", msg)
	}
}

func TestSlackMessageBlankLineSeparators(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.releaseNotes = []pipeline.ReleaseNote{
			{Number: 1, Title: "test"},
		}
	})
	m.pipeline.BuildStages("test")

	msg := m.slackMessage(false)

	if !strings.Contains(msg, blankLine) {
		t.Errorf("expected zero-width space section separators, got:\n%s", msg)
	}
}

func TestSlackMessageStageIndentation(t *testing.T) {
	m := newTestModel()
	m.pipeline.BuildStages("test")

	msg := m.slackMessage(false)

	if !strings.Contains(msg, nbsp) {
		t.Errorf("stage lines should be indented with nbsp, got:\n%s", msg)
	}
}

func newProdFailureModel(t *testing.T) Model {
	t.Helper()

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{ID: "deploy-test", Name: "Deploy App to Test"}}},
				"prod": {Stages: []config.Stage{
					{ID: "promote-app", Name: "Promote App", Group: "deploy-prod"},
					{ID: "upsert-reload-preprov", Name: "Upsert + Reload Pre-Prov", Group: "deploy-prod"},
				}},
			},
		},
	}
	p := pipeline.New(cfg, nil, true, "main", nil)
	if err := p.BuildStages("prod"); err != nil {
		t.Fatalf("BuildStages() error: %v", err)
	}
	p.FailChecklist(0, "promote failed")
	p.FailChecklist(1, "preprov failed")

	return Model{
		config:           cfg,
		pipeline:         p,
		ctx:              ctx,
		cancel:           cancel,
		phase:            phaseFailurePrompt,
		currentEnvIdx:    1,
		envOrder:         []string{"test", "prod"},
		envGroups:        [][]int{{0, 1}},
		currentGroupIdx:  0,
		fv:               &formValues{},
		failedStageIdx:   0,
		deferredFailures: []int{1},
	}
}

func TestBuildReleaseBodyStripsHeaderAndConvertsEmoji(t *testing.T) {
	slackText := ":rocket: **op** is deploying `main`\n" +
		"\u200b\n" +
		":white_check_mark: stage one\n" +
		":x: stage two\n"

	body := buildReleaseBody(slackText, "")

	if strings.Contains(body, ":rocket:") || strings.Contains(body, "**op** is deploying") {
		t.Errorf("expected header line to be stripped, got:\n%s", body)
	}
	if strings.Contains(body, "\u200b") {
		t.Errorf("expected blankLine zero-width char to be removed, got:\n%s", body)
	}
	if strings.Contains(body, ":white_check_mark:") || strings.Contains(body, ":x:") {
		t.Errorf("expected slack emoji shortcodes to be converted, got:\n%s", body)
	}
}

func TestBuildReleaseBodyAppendsPermalink(t *testing.T) {
	slackText := "header line\n\nbody content"

	body := buildReleaseBody(slackText, "https://example.slack.com/p123")

	want := "[Slack thread](https://example.slack.com/p123)"
	if !strings.Contains(body, want) {
		t.Errorf("expected %q in body, got:\n%s", want, body)
	}
	if !strings.Contains(body, "---") {
		t.Errorf("expected --- separator before Slack thread link, got:\n%s", body)
	}
}

func TestBuildReleaseBodyOmitsPermalinkWhenEmpty(t *testing.T) {
	slackText := "header\n\nbody"

	body := buildReleaseBody(slackText, "")

	if strings.Contains(body, "Slack thread") {
		t.Errorf("did not expect Slack thread link when permalink is empty, got:\n%s", body)
	}
}

func TestHandleReleaseCreatedLateAbortMessageDoesNotMutateState(t *testing.T) {
	// Simulate ctrl+c-during-phaseCreatingRelease where the gh CLI was
	// canceled (no tag returned): phase has already transitioned to
	// phaseCleanup (because m.startExitCleanup overwrites phaseAborted with
	// phaseCleanup when there's cleanup work). A late releaseCreatedMsg with
	// no tag must not clobber that state and must not dispatch a delete.
	m := newTestModel(func(m *Model) {
		m.phase = phaseCleanup
		m.statusMessage = "Finalizing: releasing deploy lock..."
	})

	result, cmd := m.handleReleaseCreated(releaseCreatedMsg{err: context.Canceled})
	m = result.(Model)

	if m.phase != phaseCleanup {
		t.Fatalf("phase = %v, want phaseCleanup (handler must not transition out of cleanup)", m.phase)
	}
	if m.releaseTag != "" || m.releaseURL != "" {
		t.Errorf("late releaseCreatedMsg should not populate releaseTag/URL after abort, got tag=%q url=%q", m.releaseTag, m.releaseURL)
	}
	if cmd != nil {
		t.Errorf("expected nil cmd from ignored late error message, got non-nil")
	}
	if m.form != nil {
		t.Error("late releaseCreatedMsg should not build a completion form during cleanup")
	}
}

func TestHandleReleaseCreatedLateSuccessMessageDispatchesCompensatingDelete(t *testing.T) {
	// Simulate the ctrl+c-during-creation race where gh release create
	// already succeeded on GitHub before m.cancel() killed the goroutine.
	// The model has moved past phaseCreatingRelease, but the release exists
	// on GitHub. handleReleaseCreated must dispatch a compensating delete
	// rather than leaving an orphaned release on the repo.
	deleteCalled := false
	var deletedTag string
	runner := &capturingRunner{
		deleteFn: func(_ context.Context, _, tag string) error {
			deleteCalled = true
			deletedTag = tag
			return nil
		},
	}

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{ID: "deploy", Name: "Deploy"}}},
			},
		},
		Release: config.ReleaseConfig{Repo: "org/app", Enabled: true},
	}
	p := pipeline.New(cfg, runner, true, "main", nil)
	m := Model{
		config:         cfg,
		runner:         runner,
		pipeline:       p,
		branch:         "main",
		operator:       "testuser",
		envOrder:       []string{"test"},
		fv:             &formValues{},
		failedStageIdx: -1,
		phase:          phaseCleanup, // already aborted into cleanup
		statusMessage:  "Finalizing: releasing deploy lock...",
	}
	m.ctx, m.cancel = context.WithCancel(context.Background())
	// Mimic ctrl+c — parent ctx is canceled, but compensation should still run.
	m.cancel()

	result, cmd := m.handleReleaseCreated(releaseCreatedMsg{tag: "v2026.05.14.1", url: "https://example/v"})
	m = result.(Model)

	if m.phase != phaseCleanup {
		t.Fatalf("phase = %v, want phaseCleanup (handler must not transition out of cleanup)", m.phase)
	}
	if m.releaseTag != "" || m.releaseURL != "" {
		t.Errorf("late releaseCreatedMsg should not populate releaseTag/URL on the model, got tag=%q url=%q", m.releaseTag, m.releaseURL)
	}
	if cmd == nil {
		t.Fatal("expected compensating delete cmd for orphaned release, got nil")
	}

	flushBatch(t, cmd)

	if !deleteCalled {
		t.Fatal("expected runner.DeleteRelease to be invoked for orphaned release")
	}
	if deletedTag != "v2026.05.14.1" {
		t.Errorf("DeleteRelease tag = %q, want %q", deletedTag, "v2026.05.14.1")
	}
}

func TestHandleReleaseCreatedIgnoresLateMessageAfterCleanupDone(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.phase = phaseCleanupDone
	})

	result, cmd := m.handleReleaseCreated(releaseCreatedMsg{err: context.Canceled})
	m = result.(Model)

	if m.phase != phaseCleanupDone {
		t.Fatalf("phase = %v, want phaseCleanupDone", m.phase)
	}
	if cmd != nil {
		t.Errorf("expected nil cmd from late error message after cleanupDone, got non-nil")
	}
}

func TestExitCleanupDoneMsgPreservesPreExistingCleanupWarning(t *testing.T) {
	// When release creation failed earlier, handleReleaseCreated set
	// cleanupWarning. If the subsequent cleanup goroutine succeeds (warning
	// is empty), the exitCleanupDoneMsg handler must preserve the existing
	// warning rather than render a green success indicator over a real
	// failure.
	m := newTestModel(func(m *Model) {
		m.phase = phaseCleanup
		m.cleanupWarning = "GitHub release creation failed; check logs."
	})

	result, _ := m.Update(exitCleanupDoneMsg{}) // empty warning = cleanup OK
	m = result.(Model)

	if m.phase != phaseCleanupDone {
		t.Fatalf("phase = %v, want phaseCleanupDone", m.phase)
	}
	if m.cleanupWarning != "GitHub release creation failed; check logs." {
		t.Errorf("cleanupWarning was overwritten, got %q", m.cleanupWarning)
	}
	if m.statusMessage != "GitHub release creation failed; check logs." {
		t.Errorf("statusMessage = %q, want it to surface the existing warning", m.statusMessage)
	}
}

func TestExitCleanupDoneMsgUsesNewWarningWhenProvided(t *testing.T) {
	// Cleanup itself failed (msg.warning != ""): the new warning takes
	// precedence over any prior one.
	m := newTestModel(func(m *Model) {
		m.phase = phaseCleanup
		m.cleanupWarning = "old warning"
	})

	result, _ := m.Update(exitCleanupDoneMsg{warning: "Final cleanup may not have completed; check logs."})
	m = result.(Model)

	if m.cleanupWarning != "Final cleanup may not have completed; check logs." {
		t.Errorf("cleanupWarning = %q, want the new warning", m.cleanupWarning)
	}
}

func TestExitCleanupDoneMsgShowsSuccessWhenNoWarnings(t *testing.T) {
	m := newTestModel(func(m *Model) {
		m.phase = phaseCleanup
	})

	result, _ := m.Update(exitCleanupDoneMsg{})
	m = result.(Model)

	if m.cleanupWarning != "" {
		t.Errorf("cleanupWarning = %q, want empty for success path", m.cleanupWarning)
	}
	if m.statusMessage != "Final cleanup complete." {
		t.Errorf("statusMessage = %q, want 'Final cleanup complete.'", m.statusMessage)
	}
}

func TestDeleteReleaseCmdSurvivesParentCancellation(t *testing.T) {
	// Verify that ctrl+c during phaseRollbackRunning (which cancels m.ctx)
	// does NOT abort the in-flight gh release delete. The compensating
	// delete is finalization — it must complete (or hit the timeout) even
	// when the parent context is canceled.
	deleteCalled := false
	var deletedTag string
	runner := &capturingRunner{
		deleteFn: func(ctx context.Context, _, tag string) error {
			// If WithoutCancel is wired correctly, ctx.Err() is nil here even
			// though the parent was canceled before this ran.
			if ctx.Err() != nil {
				t.Errorf("DeleteRelease context inherited cancellation: %v", ctx.Err())
			}
			deleteCalled = true
			deletedTag = tag
			return nil
		},
	}

	cfg := &config.Config{Release: config.ReleaseConfig{Repo: "org/app", Enabled: true}}
	p := pipeline.New(cfg, runner, true, "main", nil)

	parent, cancel := context.WithCancel(context.Background())
	cancel() // Cancel BEFORE the cmd runs, simulating ctrl+c-then-delete-fires

	cmd := deleteReleaseCmd(p, parent, "v2026.05.14.1")
	if cmd == nil {
		t.Fatal("expected non-nil cmd")
	}
	cmd() // Run synchronously

	if !deleteCalled {
		t.Fatal("expected runner.DeleteRelease to be invoked despite parent cancellation")
	}
	if deletedTag != "v2026.05.14.1" {
		t.Errorf("DeleteRelease tag = %q, want %q", deletedTag, "v2026.05.14.1")
	}
}

func TestRollbackConfirmTriggersDeleteReleaseAndClearsTag(t *testing.T) {
	deleteCalled := false
	var deletedRepo, deletedTag string
	runner := &capturingRunner{
		deleteFn: func(_ context.Context, repo, tag string) error {
			deleteCalled = true
			deletedRepo = repo
			deletedTag = tag
			return nil
		},
	}

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{ID: "deploy", Name: "Deploy App to Test"}}},
			},
			Rollback: config.RollbackConfig{Steps: []config.Stage{{ID: "rollback", Name: "Rollback"}}},
		},
		Release: config.ReleaseConfig{Repo: "org/app", Enabled: true},
	}
	p := pipeline.New(cfg, runner, true, "main", nil)
	m := Model{
		config:         cfg,
		runner:         runner,
		pipeline:       p,
		branch:         "main",
		operator:       "testuser",
		envOrder:       []string{"test"},
		fv:             &formValues{confirm: true},
		failedStageIdx: -1,
		phase:          phaseRollbackConfirm,
		releaseTag:     "v2026.05.14.1",
		releaseURL:     "https://github.com/org/app/releases/tag/v2026.05.14.1",
	}
	m.ctx, m.cancel = context.WithCancel(context.Background())
	defer m.cancel()

	result, cmd := m.handleFormDone()
	m = result.(Model)

	if m.phase != phaseRollbackRunning {
		t.Fatalf("phase = %v, want phaseRollbackRunning", m.phase)
	}
	if m.releaseTag != "" || m.releaseURL != "" {
		t.Errorf("expected releaseTag/URL to be cleared on rollback confirm, got tag=%q url=%q", m.releaseTag, m.releaseURL)
	}
	if cmd == nil {
		t.Fatal("expected batch command including delete")
	}

	// Drain the batch — at least one of its sub-commands must invoke
	// runner.DeleteRelease. Bubble Tea's tea.Batch returns a BatchMsg whose
	// elements are the sub-commands; we run them all to flush side effects.
	flushBatch(t, cmd)

	if !deleteCalled {
		t.Fatal("expected runner.DeleteRelease to be called when rollback is confirmed with a release tag")
	}
	if deletedRepo != "org/app" || deletedTag != "v2026.05.14.1" {
		t.Errorf("DeleteRelease args = (%q, %q), want (%q, %q)", deletedRepo, deletedTag, "org/app", "v2026.05.14.1")
	}
}

func TestRollbackConfirmWithoutReleaseTagSkipsDelete(t *testing.T) {
	deleteCalled := false
	runner := &capturingRunner{
		deleteFn: func(_ context.Context, _, _ string) error {
			deleteCalled = true
			return nil
		},
	}

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{ID: "deploy", Name: "Deploy"}}},
			},
			Rollback: config.RollbackConfig{Steps: []config.Stage{{ID: "rollback", Name: "Rollback"}}},
		},
		Release: config.ReleaseConfig{Repo: "org/app", Enabled: true},
	}
	p := pipeline.New(cfg, runner, true, "main", nil)
	m := Model{
		config:         cfg,
		runner:         runner,
		pipeline:       p,
		branch:         "main",
		operator:       "testuser",
		envOrder:       []string{"test"},
		fv:             &formValues{confirm: true},
		failedStageIdx: -1,
		phase:          phaseRollbackConfirm,
	}
	m.ctx, m.cancel = context.WithCancel(context.Background())
	defer m.cancel()

	_, cmd := m.handleFormDone()
	flushBatch(t, cmd)

	if deleteCalled {
		t.Fatal("DeleteRelease should not be invoked when no release tag is set")
	}
}

// flushBatch executes a tea.Cmd, recursively walking BatchMsg payloads so
// that all sub-command side effects (e.g., runner calls) run synchronously
// in the test. Panics are converted to t.Fatal.
func flushBatch(t *testing.T, cmd tea.Cmd) {
	t.Helper()
	if cmd == nil {
		return
	}
	msg := cmd()
	switch v := msg.(type) {
	case tea.BatchMsg:
		for _, sub := range v {
			flushBatch(t, sub)
		}
	}
}

// capturingRunner is a minimal gh.Runner used by rollback-delete tests. Most
// methods are no-ops; deleteFn captures the DeleteRelease call.
type capturingRunner struct {
	deleteFn   func(ctx context.Context, repo, tag string) error
	listRunsFn func(ctx context.Context, repo, workflow, status string, limit int) ([]gh.RunListEntry, error)
}

func (r *capturingRunner) Trigger(_ context.Context, _, _, _ string, _ map[string]string) (string, error) {
	return "", nil
}
func (r *capturingRunner) Status(_ context.Context, _ string, _ int64) (*gh.RunStatus, error) {
	return &gh.RunStatus{Status: "completed", Conclusion: "success"}, nil
}
func (r *capturingRunner) Logs(_ context.Context, _ string, _ int64) (string, error) {
	return "", nil
}
func (r *capturingRunner) ListRuns(ctx context.Context, repo, workflow, status string, limit int) ([]gh.RunListEntry, error) {
	if r.listRunsFn != nil {
		return r.listRunsFn(ctx, repo, workflow, status, limit)
	}
	return nil, nil
}
func (r *capturingRunner) Compare(_ context.Context, _, _, _ string) (*gh.CompareResult, error) {
	return &gh.CompareResult{}, nil
}
func (r *capturingRunner) ListReleases(_ context.Context, _ string, _ int) ([]gh.ReleaseEntry, error) {
	return nil, nil
}
func (r *capturingRunner) CreateRelease(_ context.Context, _, _, _, _, _ string) (string, error) {
	return "", nil
}
func (r *capturingRunner) DeleteRelease(ctx context.Context, repo, tag string) error {
	if r.deleteFn != nil {
		return r.deleteFn(ctx, repo, tag)
	}
	return nil
}
func (r *capturingRunner) ResolveCommit(_ context.Context, _, ref string) (string, error) {
	return ref, nil
}
func (r *capturingRunner) Version(_ context.Context) (string, error)         { return "2.87.0", nil }
func (r *capturingRunner) AuthStatus(_ context.Context) error                { return nil }
func (r *capturingRunner) CheckRepoAccess(_ context.Context, _ string) error { return nil }

func TestPreflightStringOptionalFailureShowsHint(t *testing.T) {
	m := Model{
		preflight: []preflightCheck{
			{Name: "Slack notifications", Done: true, Passed: false, Required: false, Error: "secret not found", Hint: "run: aws sso login --profile test"},
		},
	}

	output := m.preflightString()

	for _, want := range []string{"disabled", "secret not found", "run: aws sso login --profile test"} {
		if !strings.Contains(output, want) {
			t.Errorf("expected %q in output, got:\n%s", want, output)
		}
	}
}

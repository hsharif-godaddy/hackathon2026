package render

import (
	"strings"
	"testing"
	"time"

	"github.com/airo-ai-builder/release-manager/internal/config"
	"github.com/airo-ai-builder/release-manager/internal/pipeline"
)

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		d    time.Duration
		want string
	}{
		{0, "(0s)"},
		{5 * time.Second, "(5s)"},
		{59 * time.Second, "(59s)"},
		{60 * time.Second, "(1m00s)"},
		{125 * time.Second, "(2m05s)"},
	}
	for _, tt := range tests {
		if got := FormatDuration(tt.d); got != tt.want {
			t.Errorf("FormatDuration(%v) = %q, want %q", tt.d, got, tt.want)
		}
	}
}

func TestFormatElapsed(t *testing.T) {
	tests := []struct {
		d    time.Duration
		want string
	}{
		{0, "0s"},
		{5 * time.Second, "5s"},
		{59500 * time.Millisecond, "59s"}, // truncates to second
		{60 * time.Second, "1m00s"},
		{125 * time.Second, "2m05s"},
	}
	for _, tt := range tests {
		if got := FormatElapsed(tt.d); got != tt.want {
			t.Errorf("FormatElapsed(%v) = %q, want %q", tt.d, got, tt.want)
		}
	}
}

func TestEmoji(t *testing.T) {
	tests := []struct {
		state pipeline.StageState
		want  string
	}{
		{pipeline.StateRunning, ":large_blue_circle:"},
		{pipeline.StateParsingOutputs, ":large_blue_circle:"},
		{pipeline.StateSuccess, ":white_check_mark:"},
		{pipeline.StateFailed, ":x:"},
		{pipeline.StateSkipped, ":fast_forward:"},
		{pipeline.StatePending, ":white_circle:"},
	}
	for _, tt := range tests {
		if got := Emoji(tt.state); got != tt.want {
			t.Errorf("Emoji(%v) = %q, want %q", tt.state, got, tt.want)
		}
	}
}

func TestEmojiToUnicode(t *testing.T) {
	in := ":rocket: :white_check_mark: :x: :spinner_:done"
	got := EmojiToUnicode(in)
	if strings.Contains(got, ":rocket:") || strings.Contains(got, ":white_check_mark:") ||
		strings.Contains(got, ":x:") || strings.Contains(got, ":spinner_:") {
		t.Errorf("EmojiToUnicode left a code unconverted: %q", got)
	}
	if !strings.Contains(got, "\U0001F680") || !strings.Contains(got, "✅") || !strings.Contains(got, "❌") {
		t.Errorf("EmojiToUnicode missing expected unicode: %q", got)
	}
	// :spinner_: maps to empty, so "done" stays adjacent with no leftover code.
	if !strings.HasSuffix(got, "done") {
		t.Errorf("EmojiToUnicode(:spinner_:) should erase the code, got suffix of %q", got)
	}
}

func TestFormatMatrixInputs(t *testing.T) {
	// Deterministic sorted-key order regardless of map iteration order.
	got := FormatMatrixInputs(map[string]string{"component": "agent", "arch": "amd64"})
	want := "arch=amd64 component=agent"
	if got != want {
		t.Errorf("FormatMatrixInputs = %q, want %q", got, want)
	}
}

// stage is a tiny fixture helper.
func stage(env, name string, state pipeline.StageState, dur time.Duration, runURL string) *pipeline.StageRun {
	start := time.Unix(1000, 0)
	sr := &pipeline.StageRun{
		Stage:     config.Stage{Name: name},
		Env:       env,
		State:     state,
		RunURL:    runURL,
		StartTime: start,
		EndTime:   start.Add(dur),
	}
	return sr
}

// TestMessageGolden pins the overall structure + ordering of the rendered
// message. The expected string is assembled from the exported indentation
// constants so the (invisible) nbsp/zero-width chars stay correct by
// construction; this guards header/section/footer layout and ordering.
func TestMessageGolden(t *testing.T) {
	s := State{
		Operator:        "alice",
		Branch:          "main",
		Commit:          "abc1234def",
		ReleaseNotes:    []pipeline.ReleaseNote{{Number: 42, Title: "Add thing", Author: "bob"}},
		ReleaseNotesURL: "https://x/compare",
		EnvOrder:        []string{"test", "prod"},
		Stages: []*pipeline.StageRun{
			stage("test", "Deploy App", pipeline.StateSuccess, 5*time.Second, "https://x/runs/1"),
			stage("prod", "Promote App", pipeline.StateSuccess, 0, ""),
		},
		Finished:   true,
		ReleaseTag: "release-2026-05-29-abc1234",
		ReleaseURL: "https://x/releases/tag/release",
		Elapsed:    125 * time.Second,
	}

	got := Message(s)

	var want strings.Builder
	want.WriteString(":rocket: **alice** is deploying `main` (`abc1234`)\n")
	want.WriteString("\n" + BlankLine + "\n**Release Notes** (1 PRs) — [Full diff](https://x/compare)\n")
	want.WriteString("• #42 Add thing — @bob\n")
	want.WriteString("\n" + BlankLine + "\n**TEST**\n")
	// test is envOrder[0] → no deploy-values block.
	want.WriteString(Nbsp + ":white_check_mark: Deploy App (5s) — [View Run](https://x/runs/1)\n")
	want.WriteString("\n" + BlankLine + "\n**PROD**\n")
	// prod is a later env, but no stage emitted artifact/image outputs → no values line.
	want.WriteString(Nbsp + ":white_check_mark: Promote App\n")
	want.WriteString("\n" + BlankLine + "\n:checkered_flag: **Complete** (2m05s)")
	want.WriteString("\n\n:label: [release-2026-05-29-abc1234](https://x/releases/tag/release)")

	if got != want.String() {
		t.Errorf("Message mismatch:\n--- got ---\n%q\n--- want ---\n%q", got, want.String())
	}
}

func TestMessageAwaitingApproval(t *testing.T) {
	got := Message(State{
		Operator:         "alice",
		Branch:           "main",
		AwaitingApproval: true,
		RunURL:           "https://github.com/o/r/actions/runs/123",
	})
	if !strings.Contains(got, ":hourglass_flowing_sand: **Awaiting prod approval**") {
		t.Errorf("missing awaiting-approval footer:\n%s", got)
	}
	if !strings.Contains(got, "[Review & approve](https://github.com/o/r/actions/runs/123)") {
		t.Errorf("missing Review & approve link:\n%s", got)
	}
	if strings.Contains(got, "In progress") {
		t.Errorf("awaiting state should not show the generic spinner:\n%s", got)
	}

	// Without a run URL, show the CTA text but no broken link.
	noURL := Message(State{AwaitingApproval: true})
	if !strings.Contains(noURL, ":hourglass_flowing_sand: **Awaiting prod approval**") {
		t.Errorf("missing footer when RunURL empty:\n%s", noURL)
	}
	if strings.Contains(noURL, "Review & approve") {
		t.Errorf("should omit the link when RunURL is empty:\n%s", noURL)
	}

	// Finished outranks AwaitingApproval (terminal state wins).
	done := Message(State{Finished: true, AwaitingApproval: true})
	if strings.Contains(done, "Awaiting prod approval") {
		t.Errorf("finished message must not show awaiting footer:\n%s", done)
	}
	if !strings.Contains(done, ":checkered_flag: **Complete**") {
		t.Errorf("finished message should show Complete:\n%s", done)
	}
}

func TestMessageInProgressAndAborted(t *testing.T) {
	base := State{Operator: "alice", Branch: "main"}

	inProgress := Message(base)
	if !strings.Contains(inProgress, ":spinner_: *In progress...*") {
		t.Errorf("in-progress message missing spinner line: %q", inProgress)
	}

	base.Finished = true
	base.Aborted = true
	base.StatusMessage = "Deploy declined"
	aborted := Message(base)
	if !strings.Contains(aborted, ":no_entry: **Deploy declined**") {
		t.Errorf("aborted message missing no_entry line: %q", aborted)
	}
}

func TestMessageApprovedBy(t *testing.T) {
	base := State{Operator: "alice", Branch: "main", ApprovedBy: "hdewan-godaddy"}

	// Prod in progress, post-approval: credit the approver beside the spinner.
	inProgress := Message(base)
	if !strings.Contains(inProgress, "Approved by @hdewan-godaddy") {
		t.Errorf("in-progress prod message missing approver credit: %q", inProgress)
	}
	if !strings.Contains(inProgress, "Deploying to prod") {
		t.Errorf("in-progress prod message missing deploy spinner: %q", inProgress)
	}

	// Complete: the approver is credited on the Complete line.
	base.Finished = true
	done := Message(base)
	if !strings.Contains(done, ":checkered_flag: **Complete**") {
		t.Errorf("complete message missing Complete line: %q", done)
	}
	if !strings.Contains(done, "approved by @hdewan-godaddy") {
		t.Errorf("complete message missing approver credit: %q", done)
	}

	// No approver ⇒ the generic spinner, no stray "approved by".
	plain := Message(State{Operator: "alice", Branch: "main"})
	if strings.Contains(plain, "approved by") || !strings.Contains(plain, ":spinner_: *In progress...*") {
		t.Errorf("no-approver message should show the generic spinner: %q", plain)
	}
}

func TestMessageRejectedAttribution(t *testing.T) {
	// The abort path renders via the aborted footer with the attribution as the
	// status message — exercise that the reviewer + comment survive rendering.
	s := State{
		Operator:      "scheduler",
		Branch:        "main",
		Finished:      true,
		Aborted:       true,
		StatusMessage: "Release rejected by @matkinson-godaddy — e2e tests are failing",
	}
	out := Message(s)
	if !strings.Contains(out, ":no_entry: **Release rejected by @matkinson-godaddy — e2e tests are failing**") {
		t.Errorf("rejected message missing attributed no_entry line: %q", out)
	}
}

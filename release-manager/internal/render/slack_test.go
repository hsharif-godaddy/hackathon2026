package render

import (
	"strings"
	"testing"
	"time"

	"github.com/airo-ai-builder/release-manager/internal/config"
	"github.com/airo-ai-builder/release-manager/internal/pipeline"
	"github.com/airo-ai-builder/release-manager/internal/testreport"
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
	want.WriteString("• #42 Add thing - `bob`\n")
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

func TestMessageTestReportBreakdown(t *testing.T) {
	sr := stage("test", "Regression Tests", pipeline.StateFailed, 25*time.Minute, "https://x/runs/3775")
	sr.Error = "run concluded with failure" // should be suppressed once a report is attached
	sr.TestReport = &testreport.Summary{
		Overall: "failure",
		Suites: []testreport.Suite{
			{Key: "regression", Label: "AAB regression", Status: "failed",
				Total: 30, Passed: 27, Failed: 1, Skipped: 2,
				FailedShards: []int{6},
				FailedTests:  []string{"develop-media.spec.ts › uploads an image"}},
		},
	}

	out := Message(State{
		Operator: "alice", Branch: "main",
		EnvOrder: []string{"test"},
		Stages:   []*pipeline.StageRun{sr},
	})

	for _, want := range []string{
		Nbspx2 + ":x: AAB regression — 1 failed, 27 passed, 2 skipped (30 total) · failed shard(s): 6\n",
		Nbspx3 + "• develop-media.spec.ts › uploads an image\n",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("rendered message missing %q:\n%s", want, out)
		}
	}
	// Generic stage error must be suppressed when a per-suite report is present.
	if strings.Contains(out, "run concluded with failure") {
		t.Errorf("generic error should be suppressed when TestReport is set:\n%s", out)
	}
}

func TestMessageTestReportPassedCounts(t *testing.T) {
	sr := stage("test", "Regression Tests", pipeline.StateSuccess, 7*time.Minute, "https://x/runs/1")
	sr.TestReport = &testreport.Summary{
		Overall: "success",
		Suites: []testreport.Suite{
			{Key: "regression", Label: "AAB regression", Status: "passed", Total: 1, Passed: 1},
		},
	}

	out := Message(State{Operator: "alice", Branch: "main", EnvOrder: []string{"test"}, Stages: []*pipeline.StageRun{sr}})
	if !strings.Contains(out, Nbspx2+":white_check_mark: AAB regression — 1 passed (1 total)\n") {
		t.Errorf("missing passed-suite counts line:\n%s", out)
	}
}

func TestMessageE2EProductSplit(t *testing.T) {
	// A host_paas e2e stage renders as TWO peer top-level lines (AAB e2e + PaaS
	// e2e), not one "E2E Tests" stage line. AAB carries its per-test failures;
	// PaaS is pass/fail only. Both link to the same dispatched run.
	sr := stage("test", "E2E Tests", pipeline.StateFailed, 24*time.Minute, "https://x/runs/42")
	sr.Stage.HostPaas = true
	sr.Error = "run concluded with failure"
	sr.TestReport = &testreport.Summary{
		Overall: "failure",
		Suites: []testreport.Suite{
			{Key: "e2e", Label: "AAB e2e", Status: "failed", Total: 2, Passed: 1, Failed: 1,
				FailedTests: []string{"develop.spec.ts › creates an app"}},
		},
		HostPaas: testreport.HostPaas{Present: true, Status: "passed"},
	}

	out := Message(State{Operator: "alice", Branch: "main", EnvOrder: []string{"test"}, Stages: []*pipeline.StageRun{sr}})

	for _, want := range []string{
		// AAB e2e: top-level (Nbsp), with duration and run link…
		Nbsp + ":x: AAB e2e — 1 failed, 1 passed, 0 skipped (2 total) (24m00s) — [View Run](https://x/runs/42)\n",
		// …its failed test bulleted one level in…
		Nbspx2 + "• develop.spec.ts › creates an app\n",
		// …and PaaS e2e as a SECOND top-level line, pass/fail only, same link.
		Nbsp + ":white_check_mark: PaaS e2e — passed — [View Run](https://x/runs/42)\n",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("split render missing %q:\n%s", want, out)
		}
	}
	// The combined "E2E Tests" stage header is replaced, so it must not appear.
	if strings.Contains(out, "E2E Tests") {
		t.Errorf("a host_paas stage must not render a combined stage line:\n%s", out)
	}
	// Generic stage error suppressed — the AAB breakdown carries the detail.
	if strings.Contains(out, "run concluded with failure") {
		t.Errorf("generic error should be suppressed in the split render:\n%s", out)
	}
}

func TestMessageE2EProductSplitPaasSkipped(t *testing.T) {
	// host-paas is opt-in; when it didn't run the PaaS line still shows — as
	// "skipped" with a neutral emoji, never a misleading green check.
	sr := stage("test", "E2E Tests", pipeline.StateSuccess, time.Minute, "https://x/runs/7")
	sr.Stage.HostPaas = true
	sr.TestReport = &testreport.Summary{
		Overall:  "success",
		Suites:   []testreport.Suite{{Key: "e2e", Label: "AAB e2e", Status: "passed", Total: 1, Passed: 1}},
		HostPaas: testreport.HostPaas{Present: false, Status: "skipped"},
	}

	out := Message(State{Operator: "alice", Branch: "main", EnvOrder: []string{"test"}, Stages: []*pipeline.StageRun{sr}})
	if !strings.Contains(out, Nbsp+":fast_forward: PaaS e2e — skipped — [View Run](https://x/runs/7)\n") {
		t.Errorf("expected a skipped PaaS line with a neutral emoji:\n%s", out)
	}
	if !strings.Contains(out, Nbsp+":white_check_mark: AAB e2e — 1 passed (1 total) (1m00s) — [View Run](https://x/runs/7)\n") {
		t.Errorf("expected AAB e2e as a top-level line with duration:\n%s", out)
	}
}

func TestMessageTestReportEmptyKeepsError(t *testing.T) {
	// A non-nil but content-free report (no suites, no host-paas, not infra)
	// must NOT swallow the generic stage error — otherwise the failed stage
	// line would carry no detail at all.
	sr := stage("test", "Regression Tests", pipeline.StateFailed, time.Minute, "https://x/runs/9")
	sr.Error = "run concluded with failure"
	sr.TestReport = &testreport.Summary{Overall: "failure"} // empty

	out := Message(State{Operator: "alice", Branch: "main", EnvOrder: []string{"test"}, Stages: []*pipeline.StageRun{sr}})
	if !strings.Contains(out, "run concluded with failure") {
		t.Errorf("empty report should not suppress the generic error:\n%s", out)
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

func TestReleaseNoteAuthorFormat(t *testing.T) {
	base := State{
		Operator: "alice",
		Branch:   "main",
		EnvOrder: []string{"test"},
		Stages:   []*pipeline.StageRun{stage("test", "Deploy", pipeline.StateSuccess, 0, "")},
	}

	t.Run("godaddy author with resolved mention", func(t *testing.T) {
		s := base
		s.ReleaseNotes = []pipeline.ReleaseNote{{Number: 10, Title: "Fix bug", Author: "jdoe-godaddy"}}
		s.AuthorMentions = map[string]string{"jdoe": "<@U_JDOE>"}
		out := Message(s)
		if !strings.Contains(out, "• #10 Fix bug - `jdoe-godaddy` (<@U_JDOE>)") {
			t.Errorf("resolved mention not rendered:\n%s", out)
		}
	})

	t.Run("mixed-case godaddy author matches lowercased map key", func(t *testing.T) {
		s := base
		s.ReleaseNotes = []pipeline.ReleaseNote{{Number: 10, Title: "Fix bug", Author: "HDewan-godaddy"}}
		s.AuthorMentions = map[string]string{"hdewan": "<@U_HD>"}
		out := Message(s)
		if !strings.Contains(out, "• #10 Fix bug - `HDewan-godaddy` (<@U_HD>)") {
			t.Errorf("mixed-case author did not match lowercased map key:\n%s", out)
		}
	})

	t.Run("godaddy author without resolved mention falls back", func(t *testing.T) {
		s := base
		s.ReleaseNotes = []pipeline.ReleaseNote{{Number: 10, Title: "Fix bug", Author: "jdoe-godaddy"}}
		out := Message(s)
		if !strings.Contains(out, "• #10 Fix bug - `jdoe-godaddy` (@jdoe)") {
			t.Errorf("fallback @handle not rendered:\n%s", out)
		}
	})

	t.Run("non-godaddy author rendered as code", func(t *testing.T) {
		s := base
		s.ReleaseNotes = []pipeline.ReleaseNote{{Number: 11, Title: "Add feature", Author: "external-user"}}
		out := Message(s)
		if !strings.Contains(out, "• #11 Add feature - `external-user`") {
			t.Errorf("non-godaddy author not formatted correctly:\n%s", out)
		}
		if strings.Contains(out, "(@") {
			t.Errorf("non-godaddy author should not have a Slack mention:\n%s", out)
		}
	})

	t.Run("empty author omitted", func(t *testing.T) {
		s := base
		s.ReleaseNotes = []pipeline.ReleaseNote{{Number: 12, Title: "Cleanup"}}
		out := Message(s)
		if strings.Contains(out, "• #12 Cleanup -") || strings.Contains(out, "• #12 Cleanup `") {
			t.Errorf("empty author should produce no suffix:\n%s", out)
		}
		if !strings.Contains(out, "• #12 Cleanup\n") {
			t.Errorf("empty author line missing or malformed:\n%s", out)
		}
	})
}

func TestAuthorHandles(t *testing.T) {
	notes := []pipeline.ReleaseNote{
		{Number: 1, Author: "Alice-godaddy"},
		{Number: 2, Author: "bob"},
		{Number: 3, Author: "alice-godaddy"},
		{Number: 4, Author: "Carol-godaddy"},
		{Number: 5},
	}
	got := AuthorHandles(notes)
	if len(got) != 2 || got[0] != "alice" || got[1] != "carol" {
		t.Errorf("AuthorHandles = %v, want [alice carol] (lowercased, deduped)", got)
	}
}

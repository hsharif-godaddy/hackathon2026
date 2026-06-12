package probe

import (
	"bufio"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/process"
)

// TestRunner_Start_RejectsRunWhileRunning pins the contract that Start returns an error
// when a run is already in flight, without spawning a real subprocess.
func TestRunner_Start_RejectsRunWhileRunning(t *testing.T) {
	r := &Runner{ProbeDir: t.TempDir()}
	r.mu.Lock()
	r.state = StateRunning
	r.mu.Unlock()

	err := r.Start(RunArgs{Command: CmdEval, Target: SuiteTarget{Name: "golden-light"}})
	if err == nil {
		t.Fatal("Start while already running should error, got nil")
	}
	if !strings.Contains(err.Error(), "already in progress") {
		t.Errorf("error message = %q, want it to mention 'already in progress'", err.Error())
	}
}

// TestRunner_ClearLines_ResetsBuffer checks that ClearLines empties the ring buffer.
func TestRunner_ClearLines_ResetsBuffer(t *testing.T) {
	r := &Runner{ProbeDir: t.TempDir()}
	r.mu.Lock()
	r.lines = []process.OutputLine{
		{Text: "line1", Time: time.Now()},
		{Text: "line2", Time: time.Now()},
	}
	r.mu.Unlock()

	r.ClearLines()

	got := r.GetLines()
	if len(got) != 0 {
		t.Errorf("after ClearLines, len(GetLines()) = %d, want 0", len(got))
	}
}

// TestRunner_GetLines_ReturnsCopy verifies that GetLines returns a copy, not a live
// reference to the internal buffer. Mutations to the returned slice must not affect
// the runner's internal state.
func TestRunner_GetLines_ReturnsCopy(t *testing.T) {
	r := &Runner{ProbeDir: t.TempDir()}
	original := process.OutputLine{Text: "original", Time: time.Now()}
	r.mu.Lock()
	r.lines = []process.OutputLine{original}
	r.mu.Unlock()

	got := r.GetLines()
	if len(got) == 0 {
		t.Fatal("GetLines returned empty slice, expected 1 element")
	}

	// Mutate the returned slice
	got[0].Text = "mutated"

	// Internal buffer must be unchanged
	internal := r.GetLines()
	if internal[0].Text != "original" {
		t.Errorf("internal buffer was mutated via GetLines return value; got %q, want %q",
			internal[0].Text, "original")
	}
}

// TestRunner_RingBuffer_CapsAt10000 verifies the ring buffer prunes 10% when full.
func TestRunner_RingBuffer_CapsAt10000(t *testing.T) {
	r := &Runner{ProbeDir: t.TempDir()}

	// Fill to exactly maxLines
	for i := 0; i < maxLines; i++ {
		r.appendLine(process.OutputLine{Text: "line", Time: time.Now()})
	}
	if got := len(r.GetLines()); got != maxLines {
		t.Fatalf("expected %d lines after fill, got %d", maxLines, got)
	}

	// One more line should trigger pruning: drop 10% (1000 lines), then append
	r.appendLine(process.OutputLine{Text: "overflow", Time: time.Now()})

	drop := maxLines / 10
	want := maxLines - drop + 1 // dropped 1000, added 1
	if got := len(r.GetLines()); got != want {
		t.Errorf("after overflow: len = %d, want %d (pruned %d)", got, want, drop)
	}

	// The last line must be the one we just appended
	lines := r.GetLines()
	last := lines[len(lines)-1]
	if last.Text != "overflow" {
		t.Errorf("last line text = %q, want %q", last.Text, "overflow")
	}
}

// TestRunner_RingBuffer_PrunesOldestLines verifies the oldest lines are removed
// when the ring buffer overflows (FIFO ordering preserved after prune).
func TestRunner_RingBuffer_PrunesOldestLines(t *testing.T) {
	r := &Runner{ProbeDir: t.TempDir()}

	// Fill to maxLines with sequential labels "0", "1", ..., "9999"
	for i := 0; i < maxLines; i++ {
		r.appendLine(process.OutputLine{Text: strings.Repeat("x", i%10+1), Time: time.Now()})
	}

	// Mark the very first line so we can confirm it's gone after overflow
	r.mu.Lock()
	r.lines[0].Text = "oldest"
	r.mu.Unlock()

	r.appendLine(process.OutputLine{Text: "newest", Time: time.Now()})

	lines := r.GetLines()
	// "oldest" was in the first 10% — it should have been pruned
	for _, l := range lines {
		if l.Text == "oldest" {
			t.Error("expected oldest line to be pruned, but it is still present")
		}
	}
	// "newest" must still be present
	last := lines[len(lines)-1]
	if last.Text != "newest" {
		t.Errorf("last line = %q, want %q", last.Text, "newest")
	}
}

// TestRunner_GetState_Transitions verifies State transitions through the lifecycle.
func TestRunner_GetState_Transitions(t *testing.T) {
	r := &Runner{ProbeDir: t.TempDir()}

	if got := r.GetState(); got != StateIdle {
		t.Errorf("initial state = %v, want StateIdle", got)
	}

	// Manually transition to Running
	r.mu.Lock()
	r.setStateLocked(StateRunning)
	r.mu.Unlock()
	if got := r.GetState(); got != StateRunning {
		t.Errorf("after setStateLocked(Running): state = %v, want StateRunning", got)
	}

	// Manually transition to Stopped
	r.mu.Lock()
	r.setStateLocked(StateStopped)
	r.mu.Unlock()
	if got := r.GetState(); got != StateStopped {
		t.Errorf("after setStateLocked(Stopped): state = %v, want StateStopped", got)
	}

	// Manually transition to Errored
	r.mu.Lock()
	r.setStateLocked(StateErrored)
	r.mu.Unlock()
	if got := r.GetState(); got != StateErrored {
		t.Errorf("after setStateLocked(Errored): state = %v, want StateErrored", got)
	}
}

// TestRunner_State_String verifies all State String() representations.
func TestRunner_State_String(t *testing.T) {
	cases := map[State]string{
		StateIdle:    "Idle",
		StateRunning: "Running",
		StateStopped: "Stopped",
		StateErrored: "Errored",
	}
	for s, want := range cases {
		if got := s.String(); got != want {
			t.Errorf("State(%d).String() = %q, want %q", int(s), got, want)
		}
	}
}

// TestRunner_ConcurrentAccess verifies that concurrent GetLines and appendLine
// are safe under the race detector (-race flag).
func TestRunner_ConcurrentAccess(t *testing.T) {
	r := &Runner{ProbeDir: t.TempDir()}

	const writers = 10
	const linesPerWriter = 50

	var wg sync.WaitGroup
	wg.Add(writers)

	// Multiple goroutines appending concurrently
	for i := 0; i < writers; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < linesPerWriter; j++ {
				r.appendLine(process.OutputLine{Text: "concurrent", Time: time.Now()})
			}
		}()
	}

	// Concurrent readers
	wg.Add(3)
	for i := 0; i < 3; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				_ = r.GetLines()
				runtime_yield()
			}
		}()
	}

	wg.Wait()
}

// runtime_yield yields the goroutine scheduler to increase interleaving in tests.
func runtime_yield() { //nolint:revive
	time.Sleep(0)
}

// TestBuildCmdArgs_Eval_Suite verifies flag assembly for a suite eval run.
func TestBuildCmdArgs_Eval_Suite(t *testing.T) {
	args := RunArgs{
		Command:        CmdEval,
		Target:         SuiteTarget{Name: "golden-light"},
		Trials:         3,
		ParallelSuites: true,
		SkipBaseline:   false,
	}
	got := BuildCmdArgs(args)
	want := []string{"run", "eval", "--suite", "golden-light", "--trials", "3", "--fan-out"}
	if !equalSlice(got, want) {
		t.Errorf("BuildCmdArgs = %v, want %v", got, want)
	}
}

// TestBuildCmdArgs_Eval_Scenario verifies flag assembly for a single-scenario run.
func TestBuildCmdArgs_Eval_Scenario(t *testing.T) {
	args := RunArgs{
		Command: CmdEval,
		Target:  ScenarioTarget{Name: "landing-page"},
		Trials:  1,
	}
	got := BuildCmdArgs(args)
	want := []string{"run", "eval", "--scenario", "landing-page", "--trials", "1"}
	if !equalSlice(got, want) {
		t.Errorf("BuildCmdArgs = %v, want %v", got, want)
	}
}

// TestBuildCmdArgs_SaveBaseline verifies flag assembly for save-baseline.
func TestBuildCmdArgs_SaveBaseline(t *testing.T) {
	args := RunArgs{
		Command: CmdSaveBaseline,
		RunID:   "abc-123",
		Target:  SuiteTarget{Name: "golden-light"},
	}
	got := BuildCmdArgs(args)
	want := []string{"run", "save-baseline", "abc-123", "--suite", "golden-light"}
	if !equalSlice(got, want) {
		t.Errorf("BuildCmdArgs = %v, want %v", got, want)
	}
}

// TestBuildCmdArgs_SkipBaseline verifies --skip-baseline flag is added.
func TestBuildCmdArgs_SkipBaseline(t *testing.T) {
	args := RunArgs{
		Command:      CmdEval,
		Target:       SuiteTarget{Name: "my-suite"},
		SkipBaseline: true,
	}
	got := BuildCmdArgs(args)
	found := false
	for _, a := range got {
		if a == "--skip-baseline" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected --skip-baseline in args, got %v", got)
	}
}

// TestBuildCmdArgs_CaptureFlags verifies --capture-concurrency and --max-routes
// are emitted only when set (> 0).
func TestBuildCmdArgs_CaptureFlags(t *testing.T) {
	args := RunArgs{
		Command:            CmdEval,
		Target:             ScenarioTarget{Name: "landing-page"},
		Trials:             1,
		CaptureConcurrency: 2,
		MaxRoutes:          5,
	}
	got := BuildCmdArgs(args)
	want := []string{
		"run", "eval", "--scenario", "landing-page", "--trials", "1",
		"--capture-concurrency", "2", "--max-routes", "5",
	}
	if !equalSlice(got, want) {
		t.Errorf("BuildCmdArgs = %v, want %v", got, want)
	}
}

// TestBuildCmdArgs_CaptureFlags_OmittedWhenZero verifies the capture flags are
// absent when their values are 0 (use config defaults).
func TestBuildCmdArgs_CaptureFlags_OmittedWhenZero(t *testing.T) {
	args := RunArgs{
		Command: CmdEval,
		Target:  ScenarioTarget{Name: "landing-page"},
		Trials:  1,
	}
	got := BuildCmdArgs(args)
	for _, a := range got {
		if a == "--capture-concurrency" || a == "--max-routes" {
			t.Errorf("expected no capture flags when unset, got %v", got)
		}
	}
}

// TestParseRunID extracts UUID from the eval's "Starting eval run: <uuid>" line.
func TestParseRunID(t *testing.T) {
	cases := []struct {
		name  string
		lines []process.OutputLine
		want  string
	}{
		{
			name: "valid uuid line",
			lines: []process.OutputLine{
				{Text: "Scenarios: landing-page"},
				{Text: "Starting eval run: 550e8400-e29b-41d4-a716-446655440000"},
				{Text: "Running trial 1/3"},
			},
			want: "550e8400-e29b-41d4-a716-446655440000",
		},
		{
			name:  "no matching line",
			lines: []process.OutputLine{{Text: "some output"}, {Text: "other output"}},
			want:  "",
		},
		{
			name:  "empty lines",
			lines: []process.OutputLine{},
			want:  "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseRunID(tc.lines)
			if got != tc.want {
				t.Errorf("parseRunID = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestRunner_Reset_FromStopped verifies Reset transitions Stopped → Idle and clears lines.
func TestRunner_Reset_FromStopped(t *testing.T) {
	r := &Runner{ProbeDir: t.TempDir()}
	r.mu.Lock()
	r.state = StateStopped
	r.lines = []process.OutputLine{{Text: "output", Time: time.Now()}}
	r.mu.Unlock()

	r.Reset()

	if got := r.GetState(); got != StateIdle {
		t.Errorf("after Reset from Stopped: state = %v, want StateIdle", got)
	}
	if got := r.GetLines(); len(got) != 0 {
		t.Errorf("after Reset from Stopped: len(lines) = %d, want 0", len(got))
	}
}

// TestRunner_Reset_FromErrored verifies Reset transitions Errored → Idle and clears lines.
func TestRunner_Reset_FromErrored(t *testing.T) {
	r := &Runner{ProbeDir: t.TempDir()}
	r.mu.Lock()
	r.state = StateErrored
	r.lines = []process.OutputLine{{Text: "error output", Time: time.Now()}}
	r.mu.Unlock()

	r.Reset()

	if got := r.GetState(); got != StateIdle {
		t.Errorf("after Reset from Errored: state = %v, want StateIdle", got)
	}
	if got := r.GetLines(); len(got) != 0 {
		t.Errorf("after Reset from Errored: len(lines) = %d, want 0", len(got))
	}
}

// TestRunner_Reset_NoopWhenIdle verifies Reset is a no-op when already Idle.
func TestRunner_Reset_NoopWhenIdle(t *testing.T) {
	r := &Runner{ProbeDir: t.TempDir()}
	// state is already StateIdle by zero value

	r.Reset()

	if got := r.GetState(); got != StateIdle {
		t.Errorf("Reset from Idle: state = %v, want StateIdle", got)
	}
}

// TestRunner_Reset_NoopWhenRunning verifies Reset does not interrupt a running eval.
func TestRunner_Reset_NoopWhenRunning(t *testing.T) {
	r := &Runner{ProbeDir: t.TempDir()}
	r.mu.Lock()
	r.state = StateRunning
	r.lines = []process.OutputLine{{Text: "in-progress", Time: time.Now()}}
	r.mu.Unlock()

	r.Reset()

	if got := r.GetState(); got != StateRunning {
		t.Errorf("Reset while Running should be no-op: state = %v, want StateRunning", got)
	}
	if got := r.GetLines(); len(got) != 1 {
		t.Errorf("Reset while Running should not clear lines: len = %d, want 1", len(got))
	}
}

// TestScanLinesOrCR verifies the custom split function handles \n, \r\n, and bare \r.
func TestScanLinesOrCR(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  []string
	}{
		{"newline only", "hello\nworld\n", []string{"hello", "world"}},
		{"crlf", "hello\r\nworld\r\n", []string{"hello", "world"}},
		{"bare cr (progress bar)", "50%\r75%\r100%\n", []string{"50%", "75%", "100%"}},
		{"mixed terminators", "a\nb\rc\r\nd\n", []string{"a", "b", "c", "d"}},
		{"no trailing terminator", "partial", []string{"partial"}},
		{"empty lines", "\n\n", []string{"", ""}},
		{"cr then crlf", "x\r\r\n", []string{"x", ""}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sc := bufio.NewScanner(strings.NewReader(tc.input))
			sc.Split(scanLinesOrCR)
			var got []string
			for sc.Scan() {
				got = append(got, sc.Text())
			}
			if err := sc.Err(); err != nil {
				t.Fatalf("scanner error: %v", err)
			}
			if !equalSlice(got, tc.want) {
				t.Errorf("scanLinesOrCR(%q) = %v, want %v", tc.input, got, tc.want)
			}
		})
	}
}

func equalSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

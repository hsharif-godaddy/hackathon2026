package e2e

import (
	"reflect"
	"strings"
	"testing"
)

func TestBuildScriptArgs_NoTests(t *testing.T) {
	got := BuildScriptArgs(Args{Project: "e2e", Env: "local"})
	want := []string{"--env=local", "--project=e2e", "--headed"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestBuildScriptArgs_SingleTest(t *testing.T) {
	got := BuildScriptArgs(Args{
		Project:   "regression",
		Env:       "test",
		TestNames: []string{"creates an app"},
	})
	want := []string{"--env=test", "--project=regression", "--headed", "-g", "creates an app"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestBuildScriptArgs_RegexEscaping(t *testing.T) {
	// Test titles that include regex meta-characters must be escaped before
	// being joined into a -g pattern, otherwise a title like "publish (paid)"
	// matches "publish paid" too. QuoteMeta is the canonical Go regex escape.
	got := BuildScriptArgs(Args{
		Project:   "regression",
		Env:       "local",
		TestNames: []string{"publish (paid)", "develop|edit"},
	})
	if len(got) != 5 {
		t.Fatalf("expected 5 args, got %v", got)
	}
	if got[3] != "-g" {
		t.Fatalf("expected -g flag at index 3, got %v", got)
	}
	pattern := got[4]
	// QuoteMeta escapes the special chars and we join with literal | as the
	// alternation separator between titles.
	want := `publish \(paid\)|develop\|edit`
	if pattern != want {
		t.Errorf("regex pattern = %q, want %q", pattern, want)
	}
}

func TestBuildScriptArgs_DropsEmptyTitles(t *testing.T) {
	// Empty/whitespace titles must not produce empty alternation slots — an
	// empty alternative in a regex matches every test name, defeating the
	// filter. Defensive against bugs in the picker upstream.
	got := BuildScriptArgs(Args{
		Project:   "e2e",
		Env:       "local",
		TestNames: []string{"valid", "", "  "},
	})
	if len(got) != 5 {
		t.Fatalf("expected 5 args, got %v", got)
	}
	if got[4] != "valid" {
		t.Errorf("regex pattern = %q, want %q (empty titles dropped)", got[4], "valid")
	}
}

func TestBuildScriptArgs_AlwaysHeaded(t *testing.T) {
	// The TUI is a developer-facing tool so we hard-code --headed regardless
	// of env. This test pins that behavior so removing the flag requires
	// touching the test on purpose.
	for _, env := range []string{"local", "dev", "pre-test", "test", "prod"} {
		t.Run(env, func(t *testing.T) {
			got := BuildScriptArgs(Args{Project: "e2e", Env: env})
			found := false
			for _, arg := range got {
				if arg == "--headed" {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("--headed missing from args for env=%s: %v", env, got)
			}
		})
	}
}

func TestParseTestList(t *testing.T) {
	// Sample shape mirrors `pnpm exec playwright test --list --reporter=line`.
	// Includes the project tag, file:line:col, and the title.
	output := `
Listing tests:
  [e2e] › tests/e2e/critical-path.spec.ts:14:5 › critical path > creates an app
  [e2e] › tests/e2e/critical-path.spec.ts:42:5 › critical path > publishes the app
Total: 2 tests in 1 file
`
	got := parseTestList(output)
	want := []string{"critical path > creates an app", "critical path > publishes the app"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestParseTestList_DedupsRepeats(t *testing.T) {
	output := `
  [e2e] › tests/e2e/a.spec.ts:1:1 › same title
  [e2e] › tests/e2e/b.spec.ts:1:1 › same title
`
	got := parseTestList(output)
	want := []string{"same title"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestParseTestList_EmptyOutput(t *testing.T) {
	if got := parseTestList(""); len(got) != 0 {
		t.Errorf("empty input should yield empty result, got %v", got)
	}
}

func TestRunner_Start_RejectsConcurrentRun(t *testing.T) {
	// Pin the contract that Start() returns an error when a run is already
	// in flight. Manipulate state directly rather than spawning a real
	// subprocess so the test stays hermetic — the guard in Start() reads
	// r.state under r.mu, which we can fake.
	r := &Runner{ProjectRoot: t.TempDir()}
	r.mu.Lock()
	r.state = StateRunning
	r.mu.Unlock()

	err := r.Start(Args{Project: "e2e", Env: "local"})
	if err == nil {
		t.Fatal("Start while already running should error, got nil")
	}
	if !strings.Contains(err.Error(), "already in progress") {
		t.Errorf("error message = %q, want it to mention 'already in progress'", err.Error())
	}
}

func TestState_String(t *testing.T) {
	cases := map[State]string{
		StateIdle:    "Idle",
		StateRunning: "Running",
		StateStopped: "Stopped",
		StateErrored: "Errored",
	}
	for s, want := range cases {
		if got := s.String(); got != want {
			t.Errorf("State(%d).String() = %q, want %q", s, got, want)
		}
	}
}

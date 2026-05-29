package probe

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/process"
)

// TestSaveBaselineChain is a table-driven test covering the SaveBaseline code
// path inside run(). The execFn injection point lets us exercise the chain
// logic without spawning real subprocesses.
func TestSaveBaselineChain(t *testing.T) {
	const testRunID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

	type testCase struct {
		name string
		// setupExecFn builds the fake executor. It receives the runner so
		// it can append lines (needed for parseRunID).
		setupExecFn func(r *Runner, cancel context.CancelFunc) func(ctx context.Context, args RunArgs) (int, error)
		wantState   State
		wantRunID   string
		// wantOutput is a substring that must appear in the concatenated output lines.
		wantOutput string
		// wantNoSave asserts save-baseline was never invoked.
		wantNoSave bool
	}

	cases := []testCase{
		{
			name: "no run ID parsed - state Stopped with footer",
			setupExecFn: func(r *Runner, _ context.CancelFunc) func(ctx context.Context, args RunArgs) (int, error) {
				return func(_ context.Context, args RunArgs) (int, error) {
					// Eval succeeds but produces no run ID line.
					if args.Command == CmdEval {
						r.appendLine(process.OutputLine{Text: "some output without run id", Time: time.Now()})
						return 0, nil
					}
					t.Fatal("save-baseline should not be called when run ID is missing")
					return 0, nil
				}
			},
			wantState:  StateStopped,
			wantRunID:  "",
			wantOutput: "could not parse run ID",
		},
		{
			name: "save-baseline exits non-zero - state Errored with run ID populated",
			setupExecFn: func(r *Runner, _ context.CancelFunc) func(ctx context.Context, args RunArgs) (int, error) {
				return func(_ context.Context, args RunArgs) (int, error) {
					if args.Command == CmdEval {
						r.appendLine(process.OutputLine{
							Text: "Starting eval run: " + testRunID,
							Time: time.Now(),
						})
						return 0, nil
					}
					// save-baseline fails
					return 1, nil
				}
			},
			wantState:  StateErrored,
			wantRunID:  testRunID,
			wantOutput: "save-baseline exited with code 1",
		},
		{
			name: "save-baseline succeeds - state Stopped with baseline saved footer",
			setupExecFn: func(r *Runner, _ context.CancelFunc) func(ctx context.Context, args RunArgs) (int, error) {
				return func(_ context.Context, args RunArgs) (int, error) {
					if args.Command == CmdEval {
						r.appendLine(process.OutputLine{
							Text: "Starting eval run: " + testRunID,
							Time: time.Now(),
						})
						return 0, nil
					}
					// save-baseline succeeds
					return 0, nil
				}
			},
			wantState:  StateStopped,
			wantRunID:  testRunID,
			wantOutput: "baseline saved",
		},
		{
			name: "ctx cancelled between eval and save - no save attempted",
			setupExecFn: func(r *Runner, cancel context.CancelFunc) func(ctx context.Context, args RunArgs) (int, error) {
				return func(_ context.Context, args RunArgs) (int, error) {
					if args.Command == CmdEval {
						r.appendLine(process.OutputLine{
							Text: "Starting eval run: " + testRunID,
							Time: time.Now(),
						})
						// Cancel the context before returning, simulating user stop.
						cancel()
						return 0, nil
					}
					t.Fatal("save-baseline should not be called after ctx cancel")
					return 0, nil
				}
			},
			wantState:  StateStopped,
			wantRunID:  "",
			wantOutput: "stopped by user",
			wantNoSave: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			r := &Runner{ProbeDir: "/fake/probe"}
			r.execFn = tc.setupExecFn(r, cancel)

			// Simulate the same setup that Start() does before calling run().
			r.state = StateRunning
			r.done = make(chan struct{})

			// Execute run synchronously (no goroutine needed for tests).
			args := RunArgs{Command: CmdEval, SaveBaseline: true, Target: SuiteTarget{Name: "golden-light"}}
			r.run(ctx, args)

			// Assert final state.
			if got := r.GetState(); got != tc.wantState {
				t.Errorf("state = %v, want %v", got, tc.wantState)
			}

			// Assert ParsedRunID on LastRun.
			last := r.LastRun()
			if last == nil {
				t.Fatal("LastRun() is nil after run() completed")
			}
			if last.ParsedRunID != tc.wantRunID {
				t.Errorf("ParsedRunID = %q, want %q", last.ParsedRunID, tc.wantRunID)
			}

			// Assert output contains expected substring.
			lines := r.GetLines()
			var combined strings.Builder
			for _, l := range lines {
				combined.WriteString(l.Text)
				combined.WriteString("\n")
			}
			if !strings.Contains(combined.String(), tc.wantOutput) {
				t.Errorf("output does not contain %q\ngot:\n%s", tc.wantOutput, combined.String())
			}
		})
	}
}

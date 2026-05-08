package preflight

import (
	"context"
	"testing"
)

type fakeCheck struct {
	name     string
	category string
	result   CheckResult
}

func (f *fakeCheck) Name() string     { return f.name }
func (f *fakeCheck) Category() string { return f.category }
func (f *fakeCheck) Run(_ context.Context, _ string) CheckResult {
	return f.result
}

func TestRunnerRunAll(t *testing.T) {
	runner := &Runner{
		Categories: []CategoryGroup{
			{
				Name: "Tools",
				Checks: []CheckWithFixer{
					{Check: &fakeCheck{
						name:     "Node.js",
						category: "Tools",
						result:   CheckResult{Status: StatusPass, Name: "Node.js", Category: "Tools", Message: "v22.22.2"},
					}},
					{Check: &fakeCheck{
						name:     "Go",
						category: "Tools",
						result:   CheckResult{Status: StatusFail, Name: "Go", Category: "Tools", Message: "not found"},
					}},
				},
			},
		},
	}

	results := runner.RunAll(context.Background(), "/tmp")
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if results[0].Status != StatusPass {
		t.Errorf("expected Node.js pass, got %v", results[0].Status)
	}
	if results[1].Status != StatusFail {
		t.Errorf("expected Go fail, got %v", results[1].Status)
	}
}

func TestRunAll_BlockOnFailureShortCircuits(t *testing.T) {
	// First category is blocking and fails — second category must not run.
	runner := &Runner{
		Categories: []CategoryGroup{
			{
				Name:           "Prereqs",
				BlockOnFailure: true,
				Checks: []CheckWithFixer{
					{Check: &fakeCheck{
						name:     "direnv",
						category: "Prereqs",
						result:   CheckResult{Status: StatusFail, Name: "direnv", Category: "Prereqs"},
					}},
				},
			},
			{
				Name: "Tools",
				Checks: []CheckWithFixer{
					{Check: &fakeCheck{
						name:     "Node.js",
						category: "Tools",
						result:   CheckResult{Status: StatusPass, Name: "Node.js", Category: "Tools"},
					}},
				},
			},
		},
	}

	results := runner.RunAll(context.Background(), "/tmp")
	if len(results) != 1 {
		t.Fatalf("expected short-circuit to yield 1 result, got %d", len(results))
	}
	if results[0].Name != "direnv" {
		t.Errorf("expected only the blocking category's result, got %q", results[0].Name)
	}
}

func TestRunAll_BlockOnFailurePassesThrough(t *testing.T) {
	// Blocking category passes — subsequent categories must still run.
	runner := &Runner{
		Categories: []CategoryGroup{
			{
				Name:           "Prereqs",
				BlockOnFailure: true,
				Checks: []CheckWithFixer{
					{Check: &fakeCheck{
						name:     "direnv",
						category: "Prereqs",
						result:   CheckResult{Status: StatusPass, Name: "direnv", Category: "Prereqs"},
					}},
				},
			},
			{
				Name: "Tools",
				Checks: []CheckWithFixer{
					{Check: &fakeCheck{
						name:     "Node.js",
						category: "Tools",
						result:   CheckResult{Status: StatusFail, Name: "Node.js", Category: "Tools"},
					}},
				},
			},
		},
	}

	results := runner.RunAll(context.Background(), "/tmp")
	if len(results) != 2 {
		t.Fatalf("expected 2 results when gate passes, got %d", len(results))
	}
	// A non-blocking category failing must not stop the runner from
	// returning its results, but there are no further categories here to
	// assert on — the important assertion is that both categories ran.
}

func TestRunFailed_BlockOnFailureShortCircuits(t *testing.T) {
	// When re-running failed checks, a blocking category that still fails
	// must prevent subsequent categories from running, matching RunAll.
	runner := &Runner{
		Categories: []CategoryGroup{
			{
				Name:           "Prereqs",
				BlockOnFailure: true,
				Checks: []CheckWithFixer{
					{Check: &fakeCheck{
						name:     "direnv",
						category: "Prereqs",
						result:   CheckResult{Status: StatusFail, Name: "direnv", Category: "Prereqs"},
					}},
				},
			},
			{
				Name: "Tools",
				Checks: []CheckWithFixer{
					{Check: &fakeCheck{
						name:     "Node.js",
						category: "Tools",
						result:   CheckResult{Status: StatusFail, Name: "Node.js", Category: "Tools"},
					}},
				},
			},
		},
	}

	results := runner.RunFailed(context.Background(), "/tmp", map[string]bool{
		"direnv":  true,
		"Node.js": true,
	})
	if len(results) != 1 {
		t.Fatalf("expected short-circuit to yield 1 result, got %d", len(results))
	}
	if results[0].Name != "direnv" {
		t.Errorf("expected only the blocking category's result, got %q", results[0].Name)
	}
}

func TestHasFailures(t *testing.T) {
	results := []CheckResult{
		{Status: StatusPass},
		{Status: StatusWarn},
	}
	if HasFailures(results) {
		t.Error("expected no failures")
	}
	results = append(results, CheckResult{Status: StatusFail})
	if !HasFailures(results) {
		t.Error("expected failures")
	}
}

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

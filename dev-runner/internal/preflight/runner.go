package preflight

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Runner orchestrates preflight checks by category.
// Categories run sequentially; checks within a category run concurrently.
type Runner struct {
	Categories []CategoryGroup

	// CheckTimeout bounds each individual check so one slow external
	// dependency (for example, a wedged Docker CLI) cannot leave the TUI stuck
	// on "Checking prerequisites..." forever. Zero uses DefaultCheckTimeout.
	CheckTimeout time.Duration
}

const DefaultCheckTimeout = 10 * time.Second

// CategoryGroup holds checks for a single category.
//
// When BlockOnFailure is true and any check in the group returns StatusFail,
// both RunAll and RunFailed stop immediately and subsequent categories are
// not executed. Use this for prerequisite checks (e.g. direnv) whose failure
// would make downstream checks produce misleading results — without direnv
// loaded, the Node version check would read the wrong node from PATH and
// report a false version mismatch.
type CategoryGroup struct {
	Name           string
	Checks         []CheckWithFixer
	BlockOnFailure bool
}

// RunAll executes all checks and returns results.
// Categories run in order. Within each category, checks run concurrently.
// A category marked BlockOnFailure halts execution on any StatusFail.
func (r *Runner) RunAll(ctx context.Context, projectRoot string) []CheckResult {
	var allResults []CheckResult
	for _, cat := range r.Categories {
		results := r.runCategory(ctx, projectRoot, cat)
		allResults = append(allResults, results...)
		if cat.BlockOnFailure && HasFailures(results) {
			break
		}
	}
	return allResults
}

// RunFailed re-runs only checks that previously failed. A category marked
// BlockOnFailure halts execution on any StatusFail, matching RunAll.
func (r *Runner) RunFailed(ctx context.Context, projectRoot string, failedNames map[string]bool) []CheckResult {
	var allResults []CheckResult
	for _, cat := range r.Categories {
		var toRun []CheckWithFixer
		for _, cwf := range cat.Checks {
			if failedNames[cwf.Check.Name()] {
				toRun = append(toRun, cwf)
			}
		}
		if len(toRun) == 0 {
			continue
		}
		group := CategoryGroup{Name: cat.Name, Checks: toRun, BlockOnFailure: cat.BlockOnFailure}
		results := r.runCategory(ctx, projectRoot, group)
		allResults = append(allResults, results...)
		if cat.BlockOnFailure && HasFailures(results) {
			break
		}
	}
	return allResults
}

func (r *Runner) runCategory(ctx context.Context, projectRoot string, cat CategoryGroup) []CheckResult {
	results := make([]CheckResult, len(cat.Checks))
	var wg sync.WaitGroup
	for i, cwf := range cat.Checks {
		wg.Add(1)
		go func(idx int, c Check) {
			defer wg.Done()
			results[idx] = r.runCheck(ctx, projectRoot, c)
		}(i, cwf.Check)
	}
	wg.Wait()
	return results
}

func (r *Runner) runCheck(ctx context.Context, projectRoot string, c Check) CheckResult {
	timeout := r.CheckTimeout
	if timeout <= 0 {
		timeout = DefaultCheckTimeout
	}

	checkCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	resultCh := make(chan CheckResult, 1)
	go func() {
		resultCh <- c.Run(checkCtx, projectRoot)
	}()

	select {
	case result := <-resultCh:
		return result
	case <-checkCtx.Done():
		message := fmt.Sprintf("timed out after %s", timeout)
		if err := ctx.Err(); err != nil {
			message = "cancelled: " + err.Error()
		}
		return CheckResult{
			Status:   StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  message,
		}
	}
}

// FailedChecks returns CheckWithFixer entries whose checks failed and have fixers.
func (r *Runner) FailedChecks(results []CheckResult) []CheckWithFixer {
	nameToFixer := make(map[string]CheckWithFixer)
	for _, cat := range r.Categories {
		for _, cwf := range cat.Checks {
			nameToFixer[cwf.Check.Name()] = cwf
		}
	}
	var failed []CheckWithFixer
	for _, result := range results {
		if result.Status == StatusFail && result.FixAvailable {
			if cwf, ok := nameToFixer[result.Name]; ok && cwf.Fixer != nil {
				failed = append(failed, cwf)
			}
		}
	}
	return failed
}

// FixableChecks returns CheckWithFixer entries whose checks failed or warned and have fixers.
func (r *Runner) FixableChecks(results []CheckResult) []CheckWithFixer {
	nameToFixer := make(map[string]CheckWithFixer)
	for _, cat := range r.Categories {
		for _, cwf := range cat.Checks {
			nameToFixer[cwf.Check.Name()] = cwf
		}
	}
	var fixable []CheckWithFixer
	for _, result := range results {
		if (result.Status == StatusFail || result.Status == StatusWarn) && result.FixAvailable {
			if cwf, ok := nameToFixer[result.Name]; ok && cwf.Fixer != nil {
				fixable = append(fixable, cwf)
			}
		}
	}
	return fixable
}

// HasUnfixableFailures returns true if any check failed without a fix available.
func HasUnfixableFailures(results []CheckResult) bool {
	for _, r := range results {
		if r.Status == StatusFail && !r.FixAvailable {
			return true
		}
	}
	return false
}

// HasFailures returns true if any check failed (not warn).
func HasFailures(results []CheckResult) bool {
	for _, r := range results {
		if r.Status == StatusFail {
			return true
		}
	}
	return false
}

// HasWarnings returns true if any check has a warning.
func HasWarnings(results []CheckResult) bool {
	for _, r := range results {
		if r.Status == StatusWarn {
			return true
		}
	}
	return false
}

// HasIssues returns true if any check failed or warned.
func HasIssues(results []CheckResult) bool {
	return HasFailures(results) || HasWarnings(results)
}

// FailedNames returns a set of names that failed.
func FailedNames(results []CheckResult) map[string]bool {
	names := make(map[string]bool)
	for _, r := range results {
		if r.Status == StatusFail {
			names[r.Name] = true
		}
	}
	return names
}

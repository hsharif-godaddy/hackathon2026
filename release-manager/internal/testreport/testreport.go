// Package testreport models the per-suite E2E summary produced by the
// playwright-e2e workflow (tests/scripts/summarize-e2e-results.mjs) and
// uploaded as the `e2e-summary` artifact's summary.json. The release-manager
// downloads and parses it so the release Slack thread can show which suite
// failed and how many tests, without scraping the run logs.
//
// It is a dependency-clean leaf package: it depends on nothing else internal,
// so both the pipeline (which fetches + attaches it) and the render package
// (which formats it) can import it without an import cycle.
package testreport

import (
	"encoding/json"
	"fmt"
)

// Summary mirrors the JSON shape emitted by summarize-e2e-results.mjs. Field
// names and tags must stay in sync with that script.
type Summary struct {
	Environment    string   `json:"environment"`
	Overall        string   `json:"overall"` // "success" | "failure"
	TestJobResult  string   `json:"testJobResult"`
	MergeResult    string   `json:"mergeResult"`
	HostPaasResult string   `json:"hostPaasResult"`
	InfraFailure   bool     `json:"infraFailure"`
	Suites         []Suite  `json:"suites"`
	HostPaas       HostPaas `json:"hostPaas"`
}

// Suite is one Playwright project's aggregated result (e.g. e2e or regression).
type Suite struct {
	Key                 string   `json:"key"`
	Label               string   `json:"label"`
	Status              string   `json:"status"` // "passed" | "failed"
	Total               int      `json:"total"`
	Passed              int      `json:"passed"`
	Failed              int      `json:"failed"`
	Skipped             int      `json:"skipped"`
	FailedShards        []int    `json:"failedShards"`
	FailedTests         []string `json:"failedTests"`
	FailedTestsOverflow int      `json:"failedTestsOverflow"`
}

// HostPaas is the external PaaS E2E job's coarse pass/fail (no per-test data).
type HostPaas struct {
	Present bool   `json:"present"`
	Status  string `json:"status"` // "passed" | "failed" | "skipped"
}

// HasRenderableContent reports whether rendering this summary would emit any
// lines (suite breakdown, host-paas line, or an infra-failure note). The
// renderer uses it to decide whether the generic stage error can be safely
// suppressed in favor of the per-suite block — a parsed-but-empty summary
// must NOT swallow the only failure detail. Nil-safe.
func (s *Summary) HasRenderableContent() bool {
	if s == nil {
		return false
	}
	return len(s.Suites) > 0 || s.HostPaas.Present || s.InfraFailure
}

// Parse decodes summary.json bytes into a Summary.
func Parse(data []byte) (*Summary, error) {
	var s Summary
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("parsing e2e summary: %w", err)
	}
	return &s, nil
}

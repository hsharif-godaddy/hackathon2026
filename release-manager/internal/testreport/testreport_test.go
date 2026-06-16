package testreport

import "testing"

func TestParse(t *testing.T) {
	data := []byte(`{
		"environment": "test",
		"overall": "failure",
		"testJobResult": "failure",
		"mergeResult": "success",
		"hostPaasResult": "failure",
		"infraFailure": false,
		"suites": [
			{
				"key": "regression",
				"label": "AAB regression",
				"status": "failed",
				"total": 30, "passed": 27, "failed": 1, "skipped": 2,
				"failedShards": [6],
				"failedTests": ["develop-media.spec.ts › uploads an image"],
				"failedTestsOverflow": 0
			}
		],
		"hostPaas": { "present": true, "status": "failed" }
	}`)

	s, err := Parse(data)
	if err != nil {
		t.Fatalf("Parse: unexpected error: %v", err)
	}
	if s.Overall != "failure" {
		t.Errorf("Overall = %q, want %q", s.Overall, "failure")
	}
	if len(s.Suites) != 1 {
		t.Fatalf("Suites = %d, want 1", len(s.Suites))
	}
	suite := s.Suites[0]
	if suite.Key != "regression" || suite.Failed != 1 || suite.Passed != 27 || suite.Skipped != 2 || suite.Total != 30 {
		t.Errorf("suite tallies wrong: %+v", suite)
	}
	if len(suite.FailedShards) != 1 || suite.FailedShards[0] != 6 {
		t.Errorf("FailedShards = %v, want [6]", suite.FailedShards)
	}
	if len(suite.FailedTests) != 1 {
		t.Errorf("FailedTests = %v, want 1 entry", suite.FailedTests)
	}
	if !s.HostPaas.Present || s.HostPaas.Status != "failed" {
		t.Errorf("HostPaas = %+v, want present+failed", s.HostPaas)
	}
}

func TestParseInvalid(t *testing.T) {
	if _, err := Parse([]byte("not json")); err == nil {
		t.Error("Parse(invalid) expected error, got nil")
	}
}

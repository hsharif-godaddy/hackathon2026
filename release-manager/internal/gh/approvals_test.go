package gh

import "testing"

func TestParseApprovals(t *testing.T) {
	// Shape mirrors the real GET /actions/runs/{id}/approvals payload.
	data := []byte(`[
	  {
	    "state": "rejected",
	    "comment": "e2e tests are failing",
	    "user": {"login": "matkinson-godaddy"},
	    "environments": [{"name": "release-prod-approval"}]
	  }
	]`)

	got, err := parseApprovals(data)
	if err != nil {
		t.Fatalf("parseApprovals: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 approval, got %d", len(got))
	}
	a := got[0]
	if a.State != "rejected" {
		t.Errorf("state: want rejected, got %q", a.State)
	}
	if a.User != "matkinson-godaddy" {
		t.Errorf("user: want matkinson-godaddy, got %q", a.User)
	}
	if a.Comment != "e2e tests are failing" {
		t.Errorf("comment: want %q, got %q", "e2e tests are failing", a.Comment)
	}
	if len(a.Environments) != 1 || a.Environments[0] != "release-prod-approval" {
		t.Errorf("environments: want [release-prod-approval], got %v", a.Environments)
	}
}

func TestParseApprovalsEmpty(t *testing.T) {
	// A run canceled before any decision returns an empty array.
	got, err := parseApprovals([]byte(`[]`))
	if err != nil {
		t.Fatalf("parseApprovals: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("want 0 approvals, got %d", len(got))
	}
}

func TestParseApprovalsInvalid(t *testing.T) {
	if _, err := parseApprovals([]byte(`not json`)); err == nil {
		t.Error("want error for invalid JSON, got nil")
	}
}

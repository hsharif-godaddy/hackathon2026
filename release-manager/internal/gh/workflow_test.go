package gh

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestExtractRunID(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		want    int64
		wantErr bool
	}{
		{
			name: "valid URL",
			url:  "https://github.com/org/repo/actions/runs/12345678",
			want: 12345678,
		},
		{
			name: "large run ID",
			url:  "https://github.com/gdcorp-partners/airo-app-builder/actions/runs/23841234",
			want: 23841234,
		},
		{
			name:    "invalid URL - no runs segment",
			url:     "https://github.com/org/repo/pull/123",
			wantErr: true,
		},
		{
			name:    "empty string",
			url:     "",
			wantErr: true,
		},
		{
			name:    "non-numeric run ID",
			url:     "https://github.com/org/repo/actions/runs/abc",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ExtractRunID(tt.url)
			if tt.wantErr {
				if err == nil {
					t.Errorf("ExtractRunID(%q) expected error, got %d", tt.url, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ExtractRunID(%q) unexpected error: %v", tt.url, err)
			}
			if got != tt.want {
				t.Errorf("ExtractRunID(%q) = %d, want %d", tt.url, got, tt.want)
			}
		})
	}
}

func TestRunURL(t *testing.T) {
	tests := []struct {
		name  string
		repo  string
		runID int64
		want  string
	}{
		{
			name:  "standard URL",
			repo:  "org/repo",
			runID: 12345,
			want:  "https://github.com/org/repo/actions/runs/12345",
		},
		{
			name:  "long org name",
			repo:  "gdcorp-partners/airo-app-builder",
			runID: 23841234,
			want:  "https://github.com/gdcorp-partners/airo-app-builder/actions/runs/23841234",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := RunURL(tt.repo, tt.runID); got != tt.want {
				t.Errorf("RunURL(%q, %d) = %q, want %q", tt.repo, tt.runID, got, tt.want)
			}
		})
	}
}

func TestExtractRunIDAndRunURLRoundTrip(t *testing.T) {
	repo := "gdcorp-partners/airo-app-builder"
	runID := int64(99887766)

	url := RunURL(repo, runID)
	got, err := ExtractRunID(url)
	if err != nil {
		t.Fatalf("round-trip error: %v", err)
	}
	if got != runID {
		t.Errorf("round-trip: got %d, want %d", got, runID)
	}
}

func TestFormatCommand(t *testing.T) {
	tests := []struct {
		name     string
		repo     string
		workflow string
		ref      string
		inputs   map[string]string
		want     string
	}{
		{
			name:     "no inputs no ref",
			repo:     "org/repo",
			workflow: "deploy.yml",
			inputs:   map[string]string{},
			want:     "gh workflow run deploy.yml --repo org/repo",
		},
		{
			name:     "with ref",
			repo:     "org/repo",
			workflow: "deploy.yml",
			ref:      "main",
			inputs:   map[string]string{"env": "test"},
			want:     "gh workflow run deploy.yml --repo org/repo --ref main -f env=test",
		},
		{
			name:     "inputs are sorted alphabetically",
			repo:     "org/repo",
			workflow: "deploy.yml",
			inputs:   map[string]string{"z-env": "prod", "a-component": "app", "m-artifact": "123"},
			want:     "gh workflow run deploy.yml --repo org/repo -f a-component=app -f m-artifact=123 -f z-env=prod",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FormatCommand(tt.repo, tt.workflow, tt.ref, tt.inputs); got != tt.want {
				t.Errorf("FormatCommand() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestParseOutputsFromLogs(t *testing.T) {
	logs := `build-airo-app-builder-agent / Build	2026-04-01T12:00:00Z Step 1
build-airo-app-builder-agent / Send Notifications	2026-04-01T12:01:00Z MOST_SPECIFIC_IMMUTABLE_TAG_SUFFIX=pi-e2420b0-ext-4ba7665
build-airo-app-builder-preview / Send Notifications	2026-04-01T12:01:00Z MOST_SPECIFIC_IMMUTABLE_TAG_SUFFIX=pi-abc1234-ext-def5678
build-airo-app-builder-publish / Send Notifications	2026-04-01T12:01:00Z MOST_SPECIFIC_IMMUTABLE_TAG_SUFFIX=pi-111aaaa-ext-222bbbb
some-other-job / Upload	2026-04-01T12:01:00Z Artifact ID: 99999`

	tests := []struct {
		name     string
		jobMatch string
		pattern  string
		want     string
		wantErr  bool
	}{
		{
			name:     "agent image tag",
			jobMatch: `build-airo-app-builder-agent.*Send Notifications`,
			pattern:  `MOST_SPECIFIC_IMMUTABLE_TAG_SUFFIX=(pi-[a-f0-9]+-ext-[a-f0-9]+)`,
			want:     "pi-e2420b0-ext-4ba7665",
		},
		{
			name:     "preview image tag",
			jobMatch: `build-airo-app-builder-preview.*Send Notifications`,
			pattern:  `MOST_SPECIFIC_IMMUTABLE_TAG_SUFFIX=(pi-[a-f0-9]+-ext-[a-f0-9]+)`,
			want:     "pi-abc1234-ext-def5678",
		},
		{
			name:     "publish image tag",
			jobMatch: `build-airo-app-builder-publish.*Send Notifications`,
			pattern:  `MOST_SPECIFIC_IMMUTABLE_TAG_SUFFIX=(pi-[a-f0-9]+-ext-[a-f0-9]+)`,
			want:     "pi-111aaaa-ext-222bbbb",
		},
		{
			name:     "artifact ID",
			jobMatch: `some-other-job.*Upload`,
			pattern:  `Artifact ID: (\d+)`,
			want:     "99999",
		},
		{
			name:     "no matching job",
			jobMatch: `nonexistent-job`,
			pattern:  `MOST_SPECIFIC_IMMUTABLE_TAG_SUFFIX=(pi-[a-f0-9]+-ext-[a-f0-9]+)`,
			wantErr:  true,
		},
		{
			name:     "no matching pattern",
			jobMatch: `build-airo-app-builder-agent`,
			pattern:  `NONEXISTENT_VALUE=(\S+)`,
			wantErr:  true,
		},
		{
			name:     "invalid job match regex",
			jobMatch: `[invalid`,
			pattern:  `(.*)`,
			wantErr:  true,
		},
		{
			name:     "invalid value pattern regex",
			jobMatch: `.*`,
			pattern:  `[invalid`,
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseOutputsFromLogs(logs, tt.jobMatch, tt.pattern)
			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestParseRunURL(t *testing.T) {
	tests := []struct {
		name   string
		output string
		want   string
	}{
		{
			name:   "URL in output",
			output: "Created workflow run https://github.com/org/repo/actions/runs/12345\nDone",
			want:   "https://github.com/org/repo/actions/runs/12345",
		},
		{
			name:   "no URL",
			output: "some random output",
			want:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parseRunURL(tt.output); got != tt.want {
				t.Errorf("parseRunURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

// mockRunner implements Runner for testing WaitForCompletion and DryRunner.
type mockRunner struct {
	triggerFn       func(ctx context.Context, repo, workflow, ref string, inputs map[string]string) (string, error)
	statusFn        func(ctx context.Context, repo string, runID int64) (*RunStatus, error)
	logsFn          func(ctx context.Context, repo string, runID int64) (string, error)
	listRunsFn      func(ctx context.Context, repo, workflow, status string, limit int) ([]RunListEntry, error)
	versionFn       func(ctx context.Context) (string, error)
	authStatusFn    func(ctx context.Context) error
	checkRepoFn     func(ctx context.Context, repo string) error
	compareFn       func(ctx context.Context, repo, base, head string) (*CompareResult, error)
	listReleasesFn  func(ctx context.Context, repo string, limit int) ([]ReleaseEntry, error)
	createReleaseFn func(ctx context.Context, repo, tag, target, title, body string) (string, error)
	resolveCommitFn func(ctx context.Context, repo, ref string) (string, error)
}

func (m *mockRunner) Trigger(ctx context.Context, repo, workflow, ref string, inputs map[string]string) (string, error) {
	if m.triggerFn != nil {
		return m.triggerFn(ctx, repo, workflow, ref, inputs)
	}
	return "", nil
}

func (m *mockRunner) Status(ctx context.Context, repo string, runID int64) (*RunStatus, error) {
	if m.statusFn != nil {
		return m.statusFn(ctx, repo, runID)
	}
	return &RunStatus{Status: "completed", Conclusion: "success"}, nil
}

func (m *mockRunner) Logs(ctx context.Context, repo string, runID int64) (string, error) {
	if m.logsFn != nil {
		return m.logsFn(ctx, repo, runID)
	}
	return "", nil
}

func (m *mockRunner) ListRuns(ctx context.Context, repo, workflow, status string, limit int) ([]RunListEntry, error) {
	if m.listRunsFn != nil {
		return m.listRunsFn(ctx, repo, workflow, status, limit)
	}
	return nil, nil
}

func (m *mockRunner) Version(ctx context.Context) (string, error) {
	if m.versionFn != nil {
		return m.versionFn(ctx)
	}
	return "gh version 2.87.0 (2026-03-15)", nil
}

func (m *mockRunner) AuthStatus(ctx context.Context) error {
	if m.authStatusFn != nil {
		return m.authStatusFn(ctx)
	}
	return nil
}

func (m *mockRunner) Compare(ctx context.Context, repo, base, head string) (*CompareResult, error) {
	if m.compareFn != nil {
		return m.compareFn(ctx, repo, base, head)
	}
	return &CompareResult{}, nil
}

func (m *mockRunner) CheckRepoAccess(ctx context.Context, repo string) error {
	if m.checkRepoFn != nil {
		return m.checkRepoFn(ctx, repo)
	}
	return nil
}

func (m *mockRunner) ListReleases(ctx context.Context, repo string, limit int) ([]ReleaseEntry, error) {
	if m.listReleasesFn != nil {
		return m.listReleasesFn(ctx, repo, limit)
	}
	return nil, nil
}

func (m *mockRunner) CreateRelease(ctx context.Context, repo, tag, target, title, body string) (string, error) {
	if m.createReleaseFn != nil {
		return m.createReleaseFn(ctx, repo, tag, target, title, body)
	}
	return "", nil
}

func (m *mockRunner) ResolveCommit(ctx context.Context, repo, ref string) (string, error) {
	if m.resolveCommitFn != nil {
		return m.resolveCommitFn(ctx, repo, ref)
	}
	return ref + "0000000000000000000000000000000000", nil
}

func TestWaitForCompletionImmediate(t *testing.T) {
	runner := &mockRunner{
		statusFn: func(_ context.Context, _ string, _ int64) (*RunStatus, error) {
			return &RunStatus{
				ID:         123,
				Status:     "completed",
				Conclusion: "success",
			}, nil
		},
	}

	ctx := context.Background()
	status, err := WaitForCompletion(ctx, runner, "org/repo", 123, 10*time.Millisecond, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status.Conclusion != "success" {
		t.Errorf("conclusion = %q, want %q", status.Conclusion, "success")
	}
}

func TestWaitForCompletionPolls(t *testing.T) {
	calls := 0
	runner := &mockRunner{
		statusFn: func(_ context.Context, _ string, _ int64) (*RunStatus, error) {
			calls++
			if calls < 3 {
				return &RunStatus{Status: "in_progress"}, nil
			}
			return &RunStatus{Status: "completed", Conclusion: "failure"}, nil
		},
	}

	ctx := context.Background()
	status, err := WaitForCompletion(ctx, runner, "org/repo", 123, 10*time.Millisecond, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calls != 3 {
		t.Errorf("polled %d times, want 3", calls)
	}
	if status.Conclusion != "failure" {
		t.Errorf("conclusion = %q, want %q", status.Conclusion, "failure")
	}
}

func TestWaitForCompletionCallsOnStatus(t *testing.T) {
	runner := &mockRunner{
		statusFn: func(_ context.Context, _ string, _ int64) (*RunStatus, error) {
			return &RunStatus{Status: "completed", Conclusion: "success"}, nil
		},
	}

	onStatusCalled := false
	ctx := context.Background()
	_, err := WaitForCompletion(ctx, runner, "org/repo", 123, 10*time.Millisecond, func(s *RunStatus) {
		onStatusCalled = true
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !onStatusCalled {
		t.Error("onStatus callback was not called")
	}
}

func TestWaitForCompletionContextCancel(t *testing.T) {
	runner := &mockRunner{
		statusFn: func(_ context.Context, _ string, _ int64) (*RunStatus, error) {
			return &RunStatus{Status: "in_progress"}, nil
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	_, err := WaitForCompletion(ctx, runner, "org/repo", 123, 10*time.Millisecond, nil)
	if err == nil {
		t.Fatal("expected context cancellation error")
	}
}

func TestWaitForCompletionStatusErrorRetriesUntilCancel(t *testing.T) {
	var calls int
	runner := &mockRunner{
		statusFn: func(_ context.Context, _ string, _ int64) (*RunStatus, error) {
			calls++
			return nil, fmt.Errorf("API error")
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	var statuses []string
	_, err := WaitForCompletion(ctx, runner, "org/repo", 123, 10*time.Millisecond, func(s *RunStatus) {
		statuses = append(statuses, s.Status)
	})
	if err == nil {
		t.Fatal("expected error from cancelled context")
	}
	if calls < 2 {
		t.Fatalf("expected multiple retries, got %d calls", calls)
	}
	if len(statuses) == 0 {
		t.Fatal("expected onStatus to be called with network error status")
	}
	for _, s := range statuses {
		if !strings.Contains(s, "network error") {
			t.Fatalf("expected network error status, got %q", s)
		}
	}
}

func TestExtractExtHash(t *testing.T) {
	tests := []struct {
		name string
		tag  string
		want string
	}{
		{"full tag", "pi-e2420b0-ext-4ba7665", "4ba7665"},
		{"longer hashes", "pi-abc123def-ext-789xyz456", "789xyz456"},
		{"no ext separator", "pi-e2420b0", ""},
		{"empty string", "", ""},
		{"just ext prefix", "pi-abc-ext-", ""},
		{"multiple ext segments", "pi-abc-ext-def-ext-ghi", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ExtractExtHash(tt.tag); got != tt.want {
				t.Errorf("ExtractExtHash(%q) = %q, want %q", tt.tag, got, tt.want)
			}
		})
	}
}

func TestProgressNoJobs(t *testing.T) {
	s := &RunStatus{Status: "in_progress"}
	if got := s.Progress(); got != "in_progress" {
		t.Errorf("Progress() = %q, want %q", got, "in_progress")
	}
}

func TestProgressPartiallyComplete(t *testing.T) {
	s := &RunStatus{
		Status: "in_progress",
		Jobs: []RunJob{
			{Name: "build", Status: "completed", Conclusion: "success"},
			{Name: "test", Status: "in_progress"},
			{Name: "deploy", Status: "queued"},
		},
	}
	if got := s.Progress(); got != "1/3 jobs done" {
		t.Errorf("Progress() = %q, want %q", got, "1/3 jobs done")
	}
}

func TestProgressAllComplete(t *testing.T) {
	s := &RunStatus{
		Status: "completed",
		Jobs: []RunJob{
			{Name: "build", Status: "completed", Conclusion: "success"},
			{Name: "test", Status: "completed", Conclusion: "success"},
		},
	}
	if got := s.Progress(); got != "2/2 jobs done" {
		t.Errorf("Progress() = %q, want %q", got, "2/2 jobs done")
	}
}

func TestProgressNoneComplete(t *testing.T) {
	s := &RunStatus{
		Status: "queued",
		Jobs: []RunJob{
			{Name: "build", Status: "queued"},
			{Name: "test", Status: "queued"},
		},
	}
	if got := s.Progress(); got != "0/2 jobs done" {
		t.Errorf("Progress() = %q, want %q", got, "0/2 jobs done")
	}
}

func TestDryRunnerCompare(t *testing.T) {
	called := false
	real := &mockRunner{
		compareFn: func(_ context.Context, repo, base, head string) (*CompareResult, error) {
			called = true
			if repo != "org/repo" || base != "abc" || head != "main" {
				t.Errorf("unexpected args: repo=%s base=%s head=%s", repo, base, head)
			}
			return &CompareResult{
				HTMLURL: "https://github.com/org/repo/compare/abc...main",
				Commits: []CompareCommit{{SHA: "def456", Message: "Fix bug (#42)", Author: "user1"}},
			}, nil
		},
	}

	dry := &DryRunner{Real: real}
	result, err := dry.Compare(context.Background(), "org/repo", "abc", "main")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Error("Compare was not delegated to real runner")
	}
	if len(result.Commits) != 1 {
		t.Errorf("expected 1 commit, got %d", len(result.Commits))
	}
}

func TestVerifyPush(t *testing.T) {
	tests := []struct {
		name    string
		output  string
		wantErr bool
		errMsg  string
	}{
		{
			name:   "write access",
			output: "true\n",
		},
		{
			name:   "write access no newline",
			output: "true",
		},
		{
			name:    "read-only access",
			output:  "false\n",
			wantErr: true,
			errMsg:  "read-only access",
		},
		{
			name:    "null permissions",
			output:  "null\n",
			wantErr: true,
			errMsg:  "read-only access",
		},
		{
			name:    "empty output",
			output:  "",
			wantErr: true,
			errMsg:  "read-only access",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := verifyPush(tt.output, "org/repo")
			if tt.wantErr && err == nil {
				t.Fatal("expected error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.wantErr && !strings.Contains(err.Error(), tt.errMsg) {
				t.Errorf("expected error containing %q, got %q", tt.errMsg, err.Error())
			}
		})
	}
}

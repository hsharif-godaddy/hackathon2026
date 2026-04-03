package gh

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"time"
)

// RunStatus represents the status of a GitHub Actions workflow run.
type RunStatus struct {
	ID         int64    `json:"databaseId"`
	Status     string   `json:"status"`
	Conclusion string   `json:"conclusion"`
	Name       string   `json:"displayTitle"`
	URL        string   `json:"url"`
	Jobs       []RunJob `json:"jobs"`
}

// RunJob represents an individual job within a workflow run.
type RunJob struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
}

// Progress returns a human-readable progress string from the jobs array.
// Falls back to the run-level status if no jobs are present.
func (s *RunStatus) Progress() string {
	if len(s.Jobs) == 0 {
		return s.Status
	}
	completed := 0
	for _, j := range s.Jobs {
		if j.Status == "completed" {
			completed++
		}
	}
	return fmt.Sprintf("%d/%d jobs done", completed, len(s.Jobs))
}

// RunListEntry represents an entry from gh run list.
type RunListEntry struct {
	ID         int64  `json:"databaseId"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
	Name       string `json:"displayTitle"`
	URL        string `json:"url"`
	CreatedAt  string `json:"createdAt"`
}

// Runner defines the interface for executing gh CLI commands.
// The real implementation calls gh, while dry-run provides read-only behavior.
type Runner interface {
	Trigger(ctx context.Context, repo, workflow, ref string, inputs map[string]string) (runURL string, err error)
	Status(ctx context.Context, repo string, runID int64) (*RunStatus, error)
	Logs(ctx context.Context, repo string, runID int64) (string, error)
	ListRuns(ctx context.Context, repo, workflow string, status string, limit int) ([]RunListEntry, error)
	Compare(ctx context.Context, repo, base, head string) (*CompareResult, error)
	Version(ctx context.Context) (string, error)
	AuthStatus(ctx context.Context) error
	CheckRepoAccess(ctx context.Context, repo string) error
}

// LiveRunner executes real gh CLI commands.
type LiveRunner struct{}

func (r *LiveRunner) Trigger(ctx context.Context, repo, workflow, ref string, inputs map[string]string) (string, error) {
	args := []string{"workflow", "run", workflow, "--repo", repo}
	if ref != "" {
		args = append(args, "--ref", ref)
	}
	for k, v := range inputs {
		args = append(args, "--field", k+"="+v)
	}

	output, err := execute(ctx, args...)
	if err != nil {
		return "", fmt.Errorf("triggering %s in %s: %w", workflow, repo, err)
	}

	return parseRunURL(output), nil
}

func (r *LiveRunner) Status(ctx context.Context, repo string, runID int64) (*RunStatus, error) {
	output, err := execute(ctx, "run", "view", fmt.Sprintf("%d", runID),
		"--repo", repo, "--json", "databaseId,status,conclusion,displayTitle,url,jobs")
	if err != nil {
		return nil, fmt.Errorf("getting run status %d: %w", runID, err)
	}

	var status RunStatus
	if err := json.Unmarshal([]byte(output), &status); err != nil {
		return nil, fmt.Errorf("parsing run status: %w", err)
	}
	return &status, nil
}

func (r *LiveRunner) Logs(ctx context.Context, repo string, runID int64) (string, error) {
	output, err := execute(ctx, "run", "view", fmt.Sprintf("%d", runID), "--repo", repo, "--log")
	if err != nil {
		return "", fmt.Errorf("fetching logs for run %d: %w", runID, err)
	}
	return output, nil
}

func (r *LiveRunner) ListRuns(ctx context.Context, repo, workflow, status string, limit int) ([]RunListEntry, error) {
	args := []string{"run", "list",
		"--workflow", workflow,
		"--repo", repo,
		"--json", "databaseId,status,conclusion,displayTitle,url,createdAt",
		"-L", fmt.Sprintf("%d", limit),
	}
	if status != "" {
		args = append(args, "--status", status)
	}

	output, err := execute(ctx, args...)
	if err != nil {
		return nil, fmt.Errorf("listing runs for %s: %w", workflow, err)
	}

	var entries []RunListEntry
	if err := json.Unmarshal([]byte(output), &entries); err != nil {
		return nil, fmt.Errorf("parsing run list: %w", err)
	}
	return entries, nil
}

func (r *LiveRunner) Compare(ctx context.Context, repo, base, head string) (*CompareResult, error) {
	output, err := execute(ctx, "api", fmt.Sprintf("repos/%s/compare/%s...%s", repo, base, head))
	if err != nil {
		return nil, fmt.Errorf("comparing %s...%s in %s: %w", base, head, repo, err)
	}

	var resp compareResponse
	if err := json.Unmarshal([]byte(output), &resp); err != nil {
		return nil, fmt.Errorf("parsing compare response: %w", err)
	}

	result := &CompareResult{HTMLURL: resp.HTMLURL}
	for _, c := range resp.Commits {
		author := ""
		if c.Author != nil {
			author = c.Author.Login
		}
		result.Commits = append(result.Commits, CompareCommit{
			SHA:     c.SHA,
			Message: c.Commit.Message,
			Author:  author,
		})
	}
	return result, nil
}

func (r *LiveRunner) Version(ctx context.Context) (string, error) {
	output, err := execute(ctx, "--version")
	if err != nil {
		return "", fmt.Errorf("getting gh version: %w", err)
	}
	return strings.TrimSpace(output), nil
}

func (r *LiveRunner) AuthStatus(ctx context.Context) error {
	_, err := execute(ctx, "auth", "status")
	return err
}

func (r *LiveRunner) CheckRepoAccess(ctx context.Context, repo string) error {
	_, err := execute(ctx, "api", fmt.Sprintf("repos/%s", repo), "--jq", ".id")
	if err != nil {
		return fmt.Errorf("no access to %s: %w", repo, err)
	}
	return nil
}

func execute(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "gh", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("gh %s: %w\n%s", strings.Join(args, " "), err, string(out))
	}
	return string(out), nil
}

var runURLPattern = regexp.MustCompile(`https://github\.com/[^/]+/[^/]+/actions/runs/\d+`)

// parseRunURL extracts a GitHub Actions run URL from gh CLI output.
// Relies on `gh workflow run` printing the run URL to stdout — this is
// undocumented behavior but has been stable across gh CLI versions.
func parseRunURL(output string) string {
	return runURLPattern.FindString(output)
}

// ExtractRunID extracts the numeric run ID from a GitHub Actions run URL.
func ExtractRunID(runURL string) (int64, error) {
	re := regexp.MustCompile(`/actions/runs/(\d+)`)
	matches := re.FindStringSubmatch(runURL)
	if len(matches) < 2 {
		return 0, fmt.Errorf("could not extract run ID from URL: %s", runURL)
	}
	var id int64
	_, err := fmt.Sscanf(matches[1], "%d", &id)
	return id, err
}

// RunURL constructs a GitHub Actions run URL from repo and run ID.
func RunURL(repo string, runID int64) string {
	return fmt.Sprintf("https://github.com/%s/actions/runs/%d", repo, runID)
}

// WaitForCompletion polls a run until it completes, calling onStatus on each poll.
// Retries indefinitely on network errors with capped exponential backoff,
// surfacing errors via onStatus so the user can see connectivity issues.
func WaitForCompletion(ctx context.Context, runner Runner, repo string, runID int64, interval time.Duration, onStatus func(*RunStatus)) (*RunStatus, error) {
	const maxBackoff = 2 * time.Minute
	consecutiveErrors := 0

	for {
		status, err := runner.Status(ctx, repo, runID)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			consecutiveErrors++
			if onStatus != nil {
				onStatus(&RunStatus{Status: fmt.Sprintf("network error (retry #%d)", consecutiveErrors)})
			}
			backoff := time.Duration(1<<min(consecutiveErrors, 6)) * interval
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
			continue
		}
		consecutiveErrors = 0

		if onStatus != nil {
			onStatus(status)
		}

		if status.Status == "completed" {
			return status, nil
		}

		select {
		case <-ctx.Done():
			return status, ctx.Err()
		case <-time.After(interval):
		}
	}
}

// ParseOutputsFromLogs parses output values from workflow run logs.
// jobMatch is a regex to filter log lines by job name.
// pattern is a regex with a capture group to extract the value.
func ParseOutputsFromLogs(logs, jobMatch, pattern string) (string, error) {
	jobRe, err := regexp.Compile(jobMatch)
	if err != nil {
		return "", fmt.Errorf("invalid job match pattern: %w", err)
	}
	valRe, err := regexp.Compile(pattern)
	if err != nil {
		return "", fmt.Errorf("invalid value pattern: %w", err)
	}

	for _, line := range strings.Split(logs, "\n") {
		if !jobRe.MatchString(line) {
			continue
		}
		if matches := valRe.FindStringSubmatch(line); len(matches) >= 2 {
			return matches[1], nil
		}
	}
	return "", fmt.Errorf("pattern %q not found in logs matching job %q", pattern, jobMatch)
}

// CompareCommit represents a single commit from a GitHub compare response.
type CompareCommit struct {
	SHA     string
	Message string
	Author  string
}

type compareResponse struct {
	Commits []struct {
		SHA    string `json:"sha"`
		Commit struct {
			Message string `json:"message"`
		} `json:"commit"`
		Author *struct {
			Login string `json:"login"`
		} `json:"author"`
	} `json:"commits"`
	HTMLURL string `json:"html_url"`
}

// CompareResult holds the commits and the browser-friendly compare URL.
type CompareResult struct {
	Commits []CompareCommit
	HTMLURL string
}

// ExtractExtHash parses the ext commit hash from an image tag like "pi-XXXXXXX-ext-XXXXXXX".
func ExtractExtHash(imageTag string) string {
	parts := strings.Split(imageTag, "-ext-")
	if len(parts) != 2 || parts[1] == "" {
		return ""
	}
	return parts[1]
}

// FormatCommand returns the gh command string that would be executed for display purposes.
func FormatCommand(repo, workflow, ref string, inputs map[string]string) string {
	keys := make([]string, 0, len(inputs))
	for k := range inputs {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("gh workflow run %s --repo %s", workflow, repo))
	if ref != "" {
		sb.WriteString(fmt.Sprintf(" --ref %s", ref))
	}
	for _, k := range keys {
		sb.WriteString(fmt.Sprintf(" -f %s=%s", k, inputs[k]))
	}
	return sb.String()
}

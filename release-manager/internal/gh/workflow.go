package gh

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
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

// ReleaseEntry represents an entry from gh release list.
type ReleaseEntry struct {
	TagName string `json:"tagName"`
}

// Approval is one entry in a workflow run's environment review history
// (GET /repos/{owner}/{repo}/actions/runs/{run_id}/approvals): who approved or
// rejected a deployment to a gated environment, and any comment they left.
type Approval struct {
	State        string   // "approved" | "rejected"
	User         string   // reviewer login
	Comment      string   // optional reviewer comment
	Environments []string // environment names this review covers
}

// Approver is the OPTIONAL capability of reading a run's approval history. Only
// LiveRunner implements it; callers type-assert (`r.(gh.Approver)`) so the
// test/pipeline/tui fakes don't have to grow a method they never exercise. A
// runner that doesn't implement it simply yields no attribution.
type Approver interface {
	RunApprovals(ctx context.Context, repo string, runID int64) ([]Approval, error)
}

// ArtifactDownloader is the OPTIONAL capability of fetching one file from a
// completed run's uploaded artifact. Only LiveRunner implements it (DryRunner
// delegates); callers type-assert (`r.(gh.ArtifactDownloader)`) so the
// test/pipeline fakes don't have to grow a method they never exercise. A runner
// that doesn't implement it simply yields no per-suite test summary. Used to
// read the `e2e-summary` artifact's summary.json so the release thread can show
// a per-suite breakdown without scraping multi-megabyte run logs.
type ArtifactDownloader interface {
	DownloadArtifactFile(ctx context.Context, repo string, runID int64, artifactName, fileName string) ([]byte, error)
}

// Runner defines the interface for executing gh CLI commands.
// The real implementation calls gh, while dry-run provides read-only behavior.
type Runner interface {
	Trigger(ctx context.Context, repo, workflow, ref string, inputs map[string]string) (runURL string, err error)
	Status(ctx context.Context, repo string, runID int64) (*RunStatus, error)
	Logs(ctx context.Context, repo string, runID int64) (string, error)
	ListRuns(ctx context.Context, repo, workflow string, status string, limit int) ([]RunListEntry, error)
	Compare(ctx context.Context, repo, base, head string) (*CompareResult, error)
	ListReleases(ctx context.Context, repo string, limit int) ([]ReleaseEntry, error)
	CreateRelease(ctx context.Context, repo, tag, target, title, body string) (url string, err error)
	DeleteRelease(ctx context.Context, repo, tag string) error
	ResolveCommit(ctx context.Context, repo, ref string) (fullSHA string, err error)
	Version(ctx context.Context) (string, error)
	AuthStatus(ctx context.Context) error
	CheckRepoAccess(ctx context.Context, repo string) error
}

// LiveRunner executes real gh CLI commands.
type LiveRunner struct {
	// TokenForRepo, if set, returns the GH_TOKEN to use for gh commands
	// scoped to the given repo. Returning "" means "use ambient gh auth"
	// (the default — preserves the interactive TUI's behavior, which relies
	// on `gh auth login` credentials). Headless/CI callers set this to route
	// a dedicated cross-org token (e.g. PIONEER_INFRA_TOKEN for
	// gdcorp-commerce/pioneer-infra) while letting same-org repos fall back
	// to the ambient default token. A nil func ⇒ always ambient.
	TokenForRepo func(repo string) string
}

// tokenFor resolves the token for a repo, treating a nil TokenForRepo as
// "ambient auth" so the zero-value LiveRunner behaves exactly as before.
func (r *LiveRunner) tokenFor(repo string) string {
	if r.TokenForRepo == nil {
		return ""
	}
	return r.TokenForRepo(repo)
}

// executeRepo runs a gh command scoped to repo, injecting the routed token
// (if any) as GH_TOKEN for that single invocation.
func (r *LiveRunner) executeRepo(ctx context.Context, repo string, args ...string) (string, error) {
	return executeWithToken(ctx, r.tokenFor(repo), args...)
}

// RepoTokenRouter builds a TokenForRepo func that maps a repository's owner
// (the part before "/") to a token. Owners absent from the map — or mapped to
// "" — resolve to "" (ambient gh auth). Example:
//
//	gh.RepoTokenRouter(map[string]string{"gdcorp-commerce": pioneerToken})
//
// routes pioneer-infra dispatches through pioneerToken while every other repo
// uses the runner's ambient GH_TOKEN.
func RepoTokenRouter(ownerTokens map[string]string) func(repo string) string {
	return func(repo string) string {
		owner, _, _ := strings.Cut(repo, "/")
		return ownerTokens[owner]
	}
}

func (r *LiveRunner) Trigger(ctx context.Context, repo, workflow, ref string, inputs map[string]string) (string, error) {
	args := []string{"workflow", "run", workflow, "--repo", repo}
	if ref != "" {
		args = append(args, "--ref", ref)
	}
	for k, v := range inputs {
		args = append(args, "--field", k+"="+v)
	}

	output, err := r.executeRepo(ctx, repo, args...)
	if err != nil {
		return "", fmt.Errorf("triggering %s in %s: %w", workflow, repo, err)
	}

	return parseRunURL(output), nil
}

func (r *LiveRunner) Status(ctx context.Context, repo string, runID int64) (*RunStatus, error) {
	output, err := r.executeRepo(ctx, repo, "run", "view", fmt.Sprintf("%d", runID),
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
	output, err := r.executeRepo(ctx, repo, "run", "view", fmt.Sprintf("%d", runID), "--repo", repo, "--log")
	if err != nil {
		return "", fmt.Errorf("fetching logs for run %d: %w", runID, err)
	}
	return output, nil
}

// DownloadArtifactFile downloads a single named artifact from a completed run
// into a temp dir and returns the contents of fileName within it. Satisfies the
// optional ArtifactDownloader capability.
func (r *LiveRunner) DownloadArtifactFile(ctx context.Context, repo string, runID int64, artifactName, fileName string) ([]byte, error) {
	dir, err := os.MkdirTemp("", "rm-artifact-")
	if err != nil {
		return nil, fmt.Errorf("creating temp dir: %w", err)
	}
	defer os.RemoveAll(dir)

	if _, err := r.executeRepo(ctx, repo, "run", "download", fmt.Sprintf("%d", runID),
		"--repo", repo, "--name", artifactName, "--dir", dir); err != nil {
		return nil, fmt.Errorf("downloading artifact %q from run %d: %w", artifactName, runID, err)
	}

	data, err := os.ReadFile(filepath.Join(dir, fileName))
	if err != nil {
		return nil, fmt.Errorf("reading %s from artifact %q: %w", fileName, artifactName, err)
	}
	return data, nil
}

// Compile-time assertion that LiveRunner provides the optional capability.
var _ ArtifactDownloader = (*LiveRunner)(nil)

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

	output, err := r.executeRepo(ctx, repo, args...)
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
	output, err := r.executeRepo(ctx, repo, "api", fmt.Sprintf("repos/%s/compare/%s...%s", repo, base, head))
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
	output, err := r.executeRepo(ctx, repo, "api", fmt.Sprintf("repos/%s", repo), "--jq", ".permissions.push")
	if err != nil {
		return fmt.Errorf("no access to %s: %w", repo, err)
	}
	return verifyPush(output, repo)
}

func verifyPush(output, repo string) error {
	if strings.TrimSpace(output) != "true" {
		return fmt.Errorf("read-only access to %s (write required to dispatch workflows)", repo)
	}
	return nil
}

func (r *LiveRunner) ListReleases(ctx context.Context, repo string, limit int) ([]ReleaseEntry, error) {
	output, err := r.executeRepo(ctx, repo, "release", "list",
		"--repo", repo,
		"--json", "tagName",
		"-L", fmt.Sprintf("%d", limit),
	)
	if err != nil {
		return nil, fmt.Errorf("listing releases for %s: %w", repo, err)
	}

	var entries []ReleaseEntry
	if err := json.Unmarshal([]byte(output), &entries); err != nil {
		return nil, fmt.Errorf("parsing release list: %w", err)
	}
	return entries, nil
}

// RunApprovals returns the environment review history for a workflow run — used
// to attribute who approved or rejected the prod gate. Routed through the
// repo's token like every other call.
func (r *LiveRunner) RunApprovals(ctx context.Context, repo string, runID int64) ([]Approval, error) {
	output, err := r.executeRepo(ctx, repo, "api",
		fmt.Sprintf("/repos/%s/actions/runs/%d/approvals", repo, runID),
	)
	if err != nil {
		return nil, fmt.Errorf("fetching approvals for %s run %d: %w", repo, runID, err)
	}
	return parseApprovals([]byte(output))
}

// parseApprovals maps the GitHub approvals API JSON to []Approval. Split out
// from RunApprovals so the mapping is unit-testable without shelling out to gh.
func parseApprovals(data []byte) ([]Approval, error) {
	var raw []struct {
		State   string `json:"state"`
		Comment string `json:"comment"`
		User    struct {
			Login string `json:"login"`
		} `json:"user"`
		Environments []struct {
			Name string `json:"name"`
		} `json:"environments"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parsing approvals: %w", err)
	}
	approvals := make([]Approval, 0, len(raw))
	for _, a := range raw {
		envs := make([]string, 0, len(a.Environments))
		for _, e := range a.Environments {
			envs = append(envs, e.Name)
		}
		approvals = append(approvals, Approval{
			State:        a.State,
			User:         a.User.Login,
			Comment:      a.Comment,
			Environments: envs,
		})
	}
	return approvals, nil
}

func (r *LiveRunner) CreateRelease(ctx context.Context, repo, tag, target, title, body string) (string, error) {
	args := []string{"release", "create", tag,
		"--repo", repo,
		"--target", target,
		"--title", title,
		"--notes", body,
	}

	output, err := r.executeRepo(ctx, repo, args...)
	if err != nil {
		return "", fmt.Errorf("creating release %s in %s: %w", tag, repo, err)
	}
	return strings.TrimSpace(output), nil
}

// DeleteRelease removes a GitHub release and its associated tag. Used to
// compensate when an operator chooses rollback after the release was already
// cut at "Complete" time.
func (r *LiveRunner) DeleteRelease(ctx context.Context, repo, tag string) error {
	_, err := r.executeRepo(ctx, repo, "release", "delete", tag,
		"--repo", repo,
		"--yes",
		"--cleanup-tag",
	)
	if err != nil {
		return fmt.Errorf("deleting release %s in %s: %w", tag, repo, err)
	}
	return nil
}

func (r *LiveRunner) ResolveCommit(ctx context.Context, repo, ref string) (string, error) {
	output, err := r.executeRepo(ctx, repo, "api", fmt.Sprintf("repos/%s/commits/%s", repo, ref), "--jq", ".sha")
	if err != nil {
		return "", fmt.Errorf("resolving commit %s in %s: %w", ref, repo, err)
	}
	return strings.TrimSpace(output), nil
}

// execute runs gh with the process's ambient environment (no token override).
func execute(ctx context.Context, args ...string) (string, error) {
	return executeWithToken(ctx, "", args...)
}

// executeWithToken runs gh, optionally overriding GH_TOKEN for this one
// invocation. token=="" leaves the ambient environment untouched (identical to
// the previous behavior). The token is passed via the environment, never via
// argv, so it cannot leak into the args echoed in error messages or into `ps`.
func executeWithToken(ctx context.Context, token string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "gh", args...)
	cmd.Env = commandEnv(os.Environ(), token)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("gh %s: %w\n%s", strings.Join(args, " "), err, string(out))
	}
	return string(out), nil
}

// commandEnv returns base unchanged when token is empty, otherwise base with a
// GH_TOKEN=<token> entry appended (later entries win in exec, so this
// overrides any ambient GH_TOKEN). Pure + table-tested.
func commandEnv(base []string, token string) []string {
	if token == "" {
		return base
	}
	return append(append([]string(nil), base...), "GH_TOKEN="+token)
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
	fmt.Fprintf(&sb, "gh workflow run %s --repo %s", workflow, repo)
	if ref != "" {
		fmt.Fprintf(&sb, " --ref %s", ref)
	}
	for _, k := range keys {
		fmt.Fprintf(&sb, " -f %s=%s", k, inputs[k])
	}
	return sb.String()
}

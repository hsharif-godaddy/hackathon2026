package gh

import (
	"context"
	"fmt"
	"strings"
)

// DryRunner is a read-only Runner that never triggers workflows.
// It delegates read-only operations (status, logs, list, auth) to a real runner,
// but replaces trigger calls with formatted command output.
type DryRunner struct {
	Real Runner
}

func (d *DryRunner) Trigger(_ context.Context, repo, workflow, ref string, inputs map[string]string) (string, error) {
	return fmt.Sprintf("[DRY RUN] would trigger: %s", FormatCommand(repo, workflow, ref, inputs)), nil
}

func (d *DryRunner) Status(ctx context.Context, repo string, runID int64) (*RunStatus, error) {
	return d.Real.Status(ctx, repo, runID)
}

func (d *DryRunner) Logs(ctx context.Context, repo string, runID int64) (string, error) {
	return d.Real.Logs(ctx, repo, runID)
}

func (d *DryRunner) ListRuns(ctx context.Context, repo, workflow, status string, limit int) ([]RunListEntry, error) {
	return d.Real.ListRuns(ctx, repo, workflow, status, limit)
}

func (d *DryRunner) Compare(ctx context.Context, repo, base, head string) (*CompareResult, error) {
	return d.Real.Compare(ctx, repo, base, head)
}

func (d *DryRunner) Version(ctx context.Context) (string, error) {
	return d.Real.Version(ctx)
}

func (d *DryRunner) AuthStatus(ctx context.Context) error {
	return d.Real.AuthStatus(ctx)
}

func (d *DryRunner) CheckRepoAccess(ctx context.Context, repo string) error {
	return d.Real.CheckRepoAccess(ctx, repo)
}

func (d *DryRunner) ListReleases(ctx context.Context, repo string, limit int) ([]ReleaseEntry, error) {
	return d.Real.ListReleases(ctx, repo, limit)
}

func (d *DryRunner) ResolveCommit(ctx context.Context, repo, ref string) (string, error) {
	return d.Real.ResolveCommit(ctx, repo, ref)
}

// DeleteRelease delegates to Real so dry-run draft releases (created by
// DryRunner.CreateRelease) can actually be removed if the operator chooses
// rollback during a dry-run. Note: CreateRelease intentionally does *not*
// delegate to Real (it issues `--draft` directly), but cleanup is real.
func (d *DryRunner) DeleteRelease(ctx context.Context, repo, tag string) error {
	return d.Real.DeleteRelease(ctx, repo, tag)
}

// CreateRelease creates a real draft release so the output can be verified
// on GitHub. Draft releases are not visible publicly and can be deleted
// with: gh release delete <tag> --repo <repo> --yes
func (d *DryRunner) CreateRelease(ctx context.Context, repo, tag, target, title, body string) (string, error) {
	args := []string{"release", "create", tag,
		"--repo", repo,
		"--target", target,
		"--title", title,
		"--notes", body,
		"--draft",
	}

	output, err := execute(ctx, args...)
	if err != nil {
		return "", fmt.Errorf("creating draft release %s in %s: %w", tag, repo, err)
	}
	return strings.TrimSpace(output), nil
}

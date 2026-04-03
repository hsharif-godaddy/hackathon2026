package gh

import (
	"context"
	"fmt"
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

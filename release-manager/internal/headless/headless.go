// Package headless drives a release with no TUI, for use in GitHub Actions.
//
// The release is split across two GHA jobs with the prod-approval Environment
// gate between them, so the "approve in the browser, close the tab, release
// continues" property is served natively by GitHub (a single long-running
// process cannot do that). Because the two phases are separate processes, the
// test phase serializes its pipeline state to a file (uploaded as an artifact);
// the prod phase imports it so the single in-place Slack message stays
// byte-identical across the gap (TEST section + PROD section).
//
// It reuses the exact pipeline primitives the interactive TUI uses
// (BuildStages / StageGroups / RunStage / FetchReleaseNotes / CreateRelease /
// FetchRollbackSnapshot) and the shared internal/render Slack formatter, so the
// headless path and the TUI behave identically.
package headless

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/airo-ai-builder/release-manager/internal/config"
	"github.com/airo-ai-builder/release-manager/internal/gh"
	"github.com/airo-ai-builder/release-manager/internal/logger"
	"github.com/airo-ai-builder/release-manager/internal/pipeline"
	"github.com/airo-ai-builder/release-manager/internal/render"
	"github.com/airo-ai-builder/release-manager/internal/slack"
)

// Mode selects which slice of the release this invocation runs.
type Mode string

const (
	ModeTest     Mode = "test"      // preflight + release notes + run the test environment
	ModeProd     Mode = "prod"      // import test state + run prod + cut the GitHub release
	ModeProdDark Mode = "prod-dark" // import test state + dark-deploy + advisory dark tests, before the gate
	ModeRollback Mode = "rollback"  // discover previous-good + run the rollback group
	ModeAbort    Mode = "abort"     // import state + finalize a gate-declined release + tear down any dark RG
)

// prodBuilderHost is the prod Katana builder host the derived dark URL points at
// (the dark phase is prod-only). Deriving the URL from the pinned commit + this
// host avoids scraping the dispatched promote-artifact run. Mirrors
// playwright-e2e.yml's prod base_url.
const prodBuilderHost = "airo-builder.godaddy.com"

// Dark Release Group teardown target: the abort path dispatches pioneer-infra's
// release-group-simple.yml (Rollback) to clear a dark RG on a declined/cancelled
// release. There is no rg-rollback *stage* in release-manager.yml — teardownDarkRG
// replaces it (see its doc comment).
const (
	darkRGRepo     = "gdcorp-commerce/pioneer-infra"
	darkRGWorkflow = "release-group-simple.yml"
	darkRGMgmtEnv  = "mgmt-prod-us-west-2"
)

// darkURL builds the dark-release URL the dark e2e/regression pin to and the
// approver tests: the prod builder host + the build's commit SHA as the
// x-katana-version selector, with cookie=1 so the picker sets the persistent
// cookie. The format must stay parseable by tests/helpers/auth.ts
// seedDarkVersionCookie (hostname + the x-katana-version query param).
func darkURL(commit string) string {
	return fmt.Sprintf("https://%s?x-katana-version=%s&cookie=1", prodBuilderHost, commit)
}

// darkURLMessage builds the "dark build live" Slack call-to-action posted before
// the prod gate. When the Release Group image bind did not complete, rgBound is
// false: dark-create-rg is advisory, so a failed create no longer halts the
// phase, but it means only the builder UI is dark while agent/preview/publish
// stay on stable images. The warning keeps an approver from believing they
// validated the full dark stack.
func darkURLMessage(darkURL string, rgBound bool) string {
	msg := fmt.Sprintf(":mag: *Dark build live on prod (0%% traffic)* — test it before approving:\n%s", darkURL)
	if !rgBound {
		msg += "\n:warning: *Dark stack is PARTIAL* — the Release Group image bind did not complete, so only the builder UI is dark; agent/preview/publish are still on stable images. Read the dark E2E/regression results accordingly."
	}
	return msg
}

// Options configures a headless run. Populated from CLI flags + env in main.
type Options struct {
	Mode      Mode
	Branch    string
	DryRun    bool
	Operator  string
	StateFile string // ModeTest writes it; ModeProd/ModeAbort read it.

	// Reason (ModeAbort only) overrides the terminal status line. The supersede
	// janitor passes an explicit reason; when empty the message is derived from
	// the run's approval history (a gate reject vs. a cancel).
	Reason string

	// Rollback overrides (ModeRollback): any non-empty field wins over the
	// auto-discovered snapshot value.
	Overrides  pipeline.SnapshotOverrides
	BaseCommit string

	// AwaitApproval makes the phase end by posting the awaiting-approval CTA +
	// approver ping — set on the LAST pre-gate phase (test when run_dark is off,
	// dark when on), so the approvers are pinged exactly once, just before the gate.
	AwaitApproval bool

	SkipPreflight bool
}

// phaseState is the JSON payload that crosses the test→prod job boundary.
type phaseState struct {
	Pipeline        json.RawMessage        `json:"pipeline"` // pipeline.ExportState bytes
	ReleaseNotes    []pipeline.ReleaseNote `json:"release_notes"`
	ReleaseNotesURL string                 `json:"release_notes_url"`
	AuthorMentions  map[string]string      `json:"author_mentions,omitempty"`
	SlackTS         string                 `json:"slack_ts"`
	Operator        string                 `json:"operator"`
	Branch          string                 `json:"branch"`
	StartUnix       int64                  `json:"start_unix"` // so prod reports total elapsed
}

// run carries the per-invocation state needed to render the Slack message.
type run struct {
	p                *pipeline.Pipeline
	runner           gh.Runner       // for the optional gh.Approver capability (gate attribution)
	notifier         *slack.Notifier // nil ⇒ Slack disabled (e.g. dry-run)
	operator         string
	branch           string
	dryRun           bool
	runURL           string // this orchestrator run's URL (for the approval CTA)
	repo             string // GITHUB_REPOSITORY, for the approvals API
	runID            int64  // GITHUB_RUN_ID, for the approvals API
	releaseNotes     []pipeline.ReleaseNote
	releaseNotesURL  string
	start            time.Time
	releaseTag       string
	releaseURL       string
	approvedBy       string            // reviewer login who approved the prod gate ("" if unknown)
	approvalMentions []string          // approver handles from config; resolved to Slack mention tokens before the gate ping
	authorMentions   map[string]string // resolved Slack mention tokens for release-note authors (handle → "<@U...>")
}

// githubRunURL builds the current GHA run's URL from the standard runner env
// vars, or "" when not running under Actions.
func githubRunURL() string {
	server, repo, id := os.Getenv("GITHUB_SERVER_URL"), os.Getenv("GITHUB_REPOSITORY"), os.Getenv("GITHUB_RUN_ID")
	if server == "" || repo == "" || id == "" {
		return ""
	}
	return fmt.Sprintf("%s/%s/actions/runs/%s", server, repo, id)
}

// githubRunID parses GITHUB_RUN_ID; 0 when unset/non-numeric (not under Actions).
func githubRunID() int64 {
	id, _ := strconv.ParseInt(os.Getenv("GITHUB_RUN_ID"), 10, 64)
	return id
}

// Run executes one phase of a release. It returns a non-zero-worthy error when a
// stage fails; callers (main) translate that into a process exit code. A failed
// stage is terminal — the operator re-runs the phase from the Actions UI (no
// interactive retry, by design).
func Run(ctx context.Context, cfg *config.Config, runner gh.Runner, notifier *slack.Notifier, opts Options) error {
	r := &run{
		p:        pipeline.New(cfg, runner, opts.DryRun, opts.Branch, nil),
		runner:   runner,
		notifier: notifier,
		operator: opts.Operator,
		branch:   opts.Branch,
		dryRun:   opts.DryRun,
		runURL:   githubRunURL(),
		repo:     os.Getenv("GITHUB_REPOSITORY"),
		runID:    githubRunID(),
		start:    time.Now(),

		approvalMentions: cfg.Release.ApprovalMentions,
	}
	r.p.Overrides = opts.Overrides
	r.p.BaseCommitOverride = opts.BaseCommit

	if !opts.SkipPreflight {
		if err := preflight(ctx, runner); err != nil {
			return fmt.Errorf("preflight: %w", err)
		}
	}

	switch opts.Mode {
	case ModeTest:
		return r.runTest(ctx, opts)
	case ModeProdDark:
		return r.runProdDark(ctx, opts)
	case ModeProd:
		return r.runProd(ctx, opts)
	case ModeRollback:
		return r.runRollback(ctx, opts)
	case ModeAbort:
		return r.runAbort(ctx, opts)
	default:
		return fmt.Errorf("unknown mode %q (want test|prod|prod-dark|rollback|abort)", opts.Mode)
	}
}

// preflight fails fast on a missing/!authenticated gh before any dispatch.
func preflight(ctx context.Context, runner gh.Runner) error {
	if _, err := runner.Version(ctx); err != nil {
		return fmt.Errorf("gh CLI not available: %w", err)
	}
	if err := runner.AuthStatus(ctx); err != nil {
		return fmt.Errorf("gh not authenticated (set GH_TOKEN): %w", err)
	}
	return nil
}

func (r *run) runTest(ctx context.Context, opts Options) error {
	// Snapshot the previous prod deploy first: FetchReleaseNotes derives its
	// diff base (and pins values["commit"]) from the snapshot's image tag.
	if err := r.p.FetchRollbackSnapshot(ctx); err != nil {
		return fmt.Errorf("fetching rollback snapshot: %w", err)
	}
	notes, notesURL, err := r.p.FetchReleaseNotes(ctx)
	if err != nil {
		return fmt.Errorf("fetching release notes: %w", err)
	}
	r.releaseNotes, r.releaseNotesURL = notes, notesURL
	r.resolveAuthorMentions(ctx)

	if err := r.p.BuildStages("test"); err != nil {
		return err
	}

	r.postInitial(ctx)
	// Persist state early — with the Slack ts — so the job's `if: cancelled()`
	// cleanup step can finalize THIS message (via --mode abort) even if we're
	// killed mid-orchestrate. Best-effort: the authoritative write happens after
	// orchestrate succeeds, below.
	if err := r.writeState(opts.StateFile); err != nil {
		logger.Log("headless.warn: early state write failed (%v); a cancel may leave the Slack message un-finalized", err)
	}
	if err := r.orchestrate(ctx, r.p.StageGroups("test")); err != nil {
		r.fail(ctx, "test phase failed")
		return err
	}

	if err := r.writeState(opts.StateFile); err != nil {
		// Flip the thread to FAILED before exiting non-zero so it isn't left
		// stranded mid-flight.
		r.fail(ctx, "writing phase state failed")
		return fmt.Errorf("writing phase state: %w", err)
	}
	// TEST done. If this is the last pre-gate phase (run_dark off → --await-approval),
	// post the awaiting-approval CTA + approver ping; otherwise keep the message
	// in-progress and let the dark phase do it just before the gate.
	if opts.AwaitApproval {
		r.postApprovalGate(ctx)
	} else {
		r.update(ctx, false)
	}
	r.writeTestSummary()
	return nil
}

// postApprovalGate edits the single status message to the "awaiting prod
// approval" CTA, then pings the approvers in a SEPARATE fresh post — the
// in-place edit can't notify anyone (Slack only delivers @-mentions on a new
// message, never on a chat.update edit), so resolve the approver handles →
// mention tokens and post them as a broadcast threaded reply. Called by the LAST
// pre-gate phase only (Options.AwaitApproval). Best-effort: unresolved handles /
// a missing scope just yield no ping.
func (r *run) postApprovalGate(ctx context.Context) {
	r.updateAwaiting(ctx)
	if r.notifier != nil && len(r.approvalMentions) > 0 {
		if mentions := r.notifier.ResolveMentions(ctx, r.approvalMentions); len(mentions) > 0 {
			r.notifier.PostReply(ctx, approvalPing(r.runURL, mentions))
		}
	}
}

// approvalPing is the fresh message that actually notifies the approvers (the
// in-place status edit can't). Mentions go on their own line.
func approvalPing(runURL string, mentions []string) string {
	msg := ":hourglass_flowing_sand: **Prod approval needed**"
	if runURL != "" {
		msg += " — [Review & approve](" + runURL + ")"
	}
	return msg + "\n" + strings.Join(mentions, " ")
}

func (r *run) runProd(ctx context.Context, opts Options) error {
	st, err := readState(opts.StateFile)
	if err != nil {
		return fmt.Errorf("reading phase state: %w", err)
	}
	if err := r.p.ImportState(st.Pipeline); err != nil {
		return fmt.Errorf("importing pipeline state: %w", err)
	}
	r.releaseNotes, r.releaseNotesURL = st.ReleaseNotes, st.ReleaseNotesURL
	r.authorMentions = st.AuthorMentions
	r.operator, r.branch = st.Operator, st.Branch
	if st.StartUnix > 0 {
		r.start = time.Unix(st.StartUnix, 0) // total elapsed across both phases
	}
	if r.notifier != nil && st.SlackTS != "" {
		r.notifier.SeedTS(st.SlackTS) // edit the existing message in place
	}
	// Credit the reviewer who approved the gate, surfaced through the prod
	// deploy and on Complete. Best-effort: "" when the API can't be read.
	r.approvedBy = r.gateApprover(ctx)

	// Tear down the dark Release Group (if the dark phase created one) BEFORE the
	// fleet-wide promote — clears the SHA binding and reverts dark-enrolled apps.
	// No-op when run_dark was off: release_group_id is absent from the imported
	// state and teardownDarkRG guards on the empty id. Replaces a config
	// rg-rollback stage, which would dispatch Rollback with an unexpanded
	// {{prod-dark.dark-create-rg.release_group_id}} on every classic (dark-off) run.
	// Fire-and-forget (it dispatches the Rollback but does not wait), so it races
	// the fleet promote below — harmless because the dark RG is at rolloutPct=0;
	// revisit here if rollback-before-promote ordering ever matters.
	r.teardownDarkRG(ctx)

	if err := r.p.BuildStages("prod"); err != nil {
		return err
	}
	r.skipRedundantPromote() // dark phase already promoted ⇒ skip the prod re-promote
	r.update(ctx, false)     // PROD section now visible, stages pending
	if err := r.orchestrate(ctx, r.p.StageGroups("prod")); err != nil {
		r.fail(ctx, "prod phase failed")
		return err
	}

	if err := r.createRelease(ctx); err != nil {
		r.fail(ctx, "release creation failed")
		return err
	}
	r.update(ctx, true)  // Complete + release link
	r.writeProdSummary() // post-deploy manual checklist on the prod job summary
	return nil
}

// runProdDark dark-deploys the build (Katana dark_release @ 0% traffic), binds
// the agent/preview/publish images to it via a cohort-less Release Group, and
// runs the advisory dark e2e/regression — all BEFORE the prod approval gate, so
// the approver reviews a live, already-tested dark build. It imports the test
// state, runs the prod-dark environment, persists the augmented state (so the
// later prod phase can roll the Release Group back, and the gate-declined/cancel
// abort path can tear it down), posts the dark URL for manual testing, then
// edits the message to the awaiting-approval CTA and pings the approvers.
func (r *run) runProdDark(ctx context.Context, opts Options) error {
	st, err := readState(opts.StateFile)
	if err != nil {
		return fmt.Errorf("reading phase state: %w", err)
	}
	if err := r.p.ImportState(st.Pipeline); err != nil {
		return fmt.Errorf("importing pipeline state: %w", err)
	}
	r.releaseNotes, r.releaseNotesURL = st.ReleaseNotes, st.ReleaseNotesURL
	r.authorMentions = st.AuthorMentions
	r.operator, r.branch = st.Operator, st.Branch
	if st.StartUnix > 0 {
		r.start = time.Unix(st.StartUnix, 0)
	}
	if r.notifier != nil && st.SlackTS != "" {
		r.notifier.SeedTS(st.SlackTS) // edit the existing message in place
	}

	// Derive the dark URL the e2e/regression stages pin to, from the pinned
	// release commit + the prod builder host — rather than scraping it from the
	// dispatched promote-artifact run (brittle: depends on which branch's workflow
	// is dispatched; see the prod-dark note in release-manager.yml and Release
	// #95). The dark artifact's x-katana-version selector IS the build commit SHA,
	// so the katanaSelector stage input uses {{commit}} directly.
	if commit := r.p.Values()["commit"]; commit != "" {
		r.p.SetValue("dark_url", darkURL(commit))
	}

	if err := r.p.BuildStages("prod-dark"); err != nil {
		return err
	}
	r.update(ctx, false) // PROD-DARK section now visible, stages pending
	// Persist early (with the Slack ts) so a mid-orchestrate cancel can finalize
	// the message AND tear down the RG via --mode abort.
	if err := r.writeState(opts.StateFile); err != nil {
		logger.Log("headless.warn: early prod-dark state write failed (%v)", err)
	}
	if err := r.orchestrate(ctx, r.p.StageGroups("prod-dark")); err != nil {
		r.teardownDarkRG(ctx) // best-effort: don't leave the RG bound on a failed dark phase
		r.fail(ctx, "dark phase failed")
		return err
	}

	// Persist the dark outputs (release_group_id) so the prod phase can roll the
	// RG back and the abort path can tear it down on a declined gate.
	if err := r.writeState(opts.StateFile); err != nil {
		r.fail(ctx, "writing phase state failed")
		return fmt.Errorf("writing phase state: %w", err)
	}

	// Surface the dark URL for manual testing before the gate. If dark-create-rg
	// (advisory) didn't bind the images, release_group_id is unset — warn that the
	// dark stack is partial so the approver doesn't over-trust it.
	if r.notifier != nil {
		if darkURL := r.p.Values()["dark_url"]; darkURL != "" {
			rgBound := r.p.Values()["prod-dark.dark-create-rg.release_group_id"] != ""
			r.notifier.PostReply(ctx, darkURLMessage(darkURL, rgBound))
		}
	}

	// Gate is next and the dark build is live+tested, so the dark phase is the
	// last pre-gate phase: post the awaiting-approval CTA + approver ping (always
	// set via --await-approval when dark runs).
	if opts.AwaitApproval {
		r.postApprovalGate(ctx)
	}
	return nil
}

// runAbort finalizes a release that did NOT proceed past the prod gate, editing
// the SINGLE existing message in place to a terminal state — so the channel
// sees one updated message, not a stuck "Awaiting approval" plus a separate
// post. Two callers:
//   - the gate-declined job (reject): no Reason ⇒ message derived from the
//     approval history ("rejected by @user — comment").
//   - the supersede janitor: passes Reason ("Superseded …") for a release left
//     un-approved past the next scheduled run; it operates on the STUCK run's
//     state artifact, so the seeded ts edits THAT run's message.
//
// It returns nil on success: the job's own conclusion should be green (it did
// its job — annotating Slack); the run's overall outcome is decided elsewhere.
func (r *run) runAbort(ctx context.Context, opts Options) error {
	st, err := readState(opts.StateFile)
	if err != nil {
		return fmt.Errorf("reading phase state: %w", err)
	}
	if err := r.p.ImportState(st.Pipeline); err != nil {
		return fmt.Errorf("importing pipeline state: %w", err)
	}
	r.releaseNotes, r.releaseNotesURL = st.ReleaseNotes, st.ReleaseNotesURL
	r.authorMentions = st.AuthorMentions
	r.operator, r.branch = st.Operator, st.Branch
	if st.StartUnix > 0 {
		r.start = time.Unix(st.StartUnix, 0)
	}
	// Tear down the dark Release Group if the dark phase created one (best-effort,
	// guarded by the id in state). Runs regardless of Slack state — a declined or
	// cancelled release must not leave the dark RG bound.
	r.teardownDarkRG(ctx)
	if r.notifier == nil || st.SlackTS == "" {
		// Nothing to finalize (Slack disabled, or the run never posted a
		// message). Don't create a stray new message — just exit.
		logger.Log("headless: abort: no existing Slack message to finalize; skipping")
		return nil
	}
	r.notifier.SeedTS(st.SlackTS)                 // edit the existing message in place
	r.fail(ctx, r.abortMessage(ctx, opts.Reason)) // terminal aborted footer + notified=true
	return nil
}

// skipRedundantPromote marks the prod-phase promote-images stage skipped when
// the dark phase already promoted the agent/preview/publish images to the prod
// ECR (dark-promote-images, which runs before the bind). Guarded on the same
// release_group_id-in-state signal teardownDarkRG uses: present ⇒ a dark run
// reached the bind, so the images are already promoted. No-op on a classic
// (dark-off) run, or if dark-create-rg failed (no id) — there docker-promote's
// idempotency makes any redundant prod promote a harmless no-op anyway.
func (r *run) skipRedundantPromote() {
	if r.p.Values()["prod-dark.dark-create-rg.release_group_id"] == "" {
		return
	}
	for i, sr := range r.p.Stages() {
		if sr.Stage.ID == "promote-images" {
			r.p.SkipStage(i)
			return
		}
	}
}

// teardownDarkRG best-effort rolls back the dark Release Group the dark phase
// created, dispatching pioneer-infra's release-group-simple.yml (Rollback) with
// the release_group_id carried in state. Called from the abort path
// (gate-declined + cancel cleanup) so a release that does not proceed past the
// gate doesn't leave the dark RG bound. No-op when no RG was created (e.g. a
// cancel during the test phase). Fire-and-forget + non-fatal: the abort must
// finish fast (the cancel path has a ~10s grace window) and a failed dispatch is
// bounded by the RG's rolloutPct=0 + the dark artifact's 24h ttl.
func (r *run) teardownDarkRG(ctx context.Context) {
	rgID := r.p.Values()["prod-dark.dark-create-rg.release_group_id"]
	if rgID == "" {
		return
	}
	if r.dryRun {
		logger.Log("headless.abort: [DRY RUN] would roll back dark Release Group %s", rgID)
		return
	}
	logger.Log("headless.abort: rolling back dark Release Group %s", rgID)
	if _, err := r.runner.Trigger(ctx, darkRGRepo, darkRGWorkflow, "", map[string]string{
		"action":         "Rollback",
		"environment":    darkRGMgmtEnv,
		"releaseGroupId": rgID,
	}); err != nil {
		logger.Log("headless.abort.warn: dark Release Group teardown dispatch failed (%v); roll it back manually (bounded by rolloutPct=0 + 24h ttl)", err)
	}
}

// abortMessage is the terminal status line for an aborted release: an explicit
// reason when provided (the supersede janitor passes one), otherwise derived
// from the approval history.
func (r *run) abortMessage(ctx context.Context, reason string) string {
	if m := strings.TrimSpace(reason); m != "" {
		return m
	}
	return r.declineMessage(ctx)
}

// declineMessage describes why the release stopped at the gate, attributing the
// reviewer when the approvals API records a rejection (with their comment when
// present). A hard run-cancellation leaves no approval record — and cancels
// this job too — so the fallback is a plain "Release canceled".
func (r *run) declineMessage(ctx context.Context) string {
	if dec, ok := r.gateDecision(ctx, "rejected"); ok {
		msg := "Release rejected by @" + dec.User
		if c := strings.TrimSpace(dec.Comment); c != "" {
			msg += " — " + c
		}
		return msg
	}
	return "Release canceled"
}

// gateApprover returns the login of the reviewer who approved the prod gate,
// or "" when unknown (dry-run, no API access, or no approval recorded).
func (r *run) gateApprover(ctx context.Context) string {
	if dec, ok := r.gateDecision(ctx, "approved"); ok {
		return dec.User
	}
	return ""
}

// gateProdEnv is the GHA Environment whose required-reviewers gate prod.
const gateProdEnv = "release-prod-approval"

// gateDecision returns the most recent prod-gate review whose state matches
// want ("approved"|"rejected"), read via the optional gh.Approver capability.
// ok=false when: dry-run; the runner can't fetch approvals (a fake); the run
// env vars are absent; the API errors; or no matching review exists — every
// caller degrades gracefully (no attribution) rather than failing the release.
func (r *run) gateDecision(ctx context.Context, want string) (gh.Approval, bool) {
	if r.dryRun {
		return gh.Approval{}, false
	}
	approver, ok := r.runner.(gh.Approver)
	if !ok || r.repo == "" || r.runID == 0 {
		return gh.Approval{}, false
	}
	approvals, err := approver.RunApprovals(ctx, r.repo, r.runID)
	if err != nil {
		logger.Log("headless.warn: could not read gate approvals: %v", err)
		return gh.Approval{}, false
	}
	var match gh.Approval
	var found bool
	for _, a := range approvals { // chronological — the last matching review wins
		if a.State == want && envMatch(a.Environments, gateProdEnv) {
			match, found = a, true
		}
	}
	return match, found
}

// envMatch reports whether the review covers env. An empty list (older API
// payloads) is treated as a match — the gate has a single environment.
func envMatch(envs []string, env string) bool {
	if len(envs) == 0 {
		return true
	}
	for _, e := range envs {
		if e == env {
			return true
		}
	}
	return false
}

func (r *run) runRollback(ctx context.Context, opts Options) error {
	if err := r.p.FetchRollbackSnapshot(ctx); err != nil {
		return fmt.Errorf("fetching rollback snapshot: %w", err)
	}
	r.p.BuildRollbackStages()

	r.postInitial(ctx)
	if err := r.orchestrate(ctx, r.p.StageGroups("rollback")); err != nil {
		r.fail(ctx, "rollback failed")
		return err
	}
	r.update(ctx, true)
	return nil
}

// slackRefreshInterval controls how often the Slack message is refreshed while
// a group is running, so stage states (running/done) and per-stage [View Run]
// links appear live rather than only after the whole group finishes. The
// Notifier dedups identical content, so a tick with no change is a cheap no-op.
const slackRefreshInterval = 15 * time.Second

// orchestrate runs each group's stages in parallel and waits for the WHOLE
// group before advancing — every stage runs to completion (no fail-fast
// cancellation), so one stage's failure never cancels its siblings. After the
// group settles, the phase fails only if a BLOCKING (non-advisory) stage
// failed; advisory stages (the test-phase e2e / regression / sim-eval /
// health-check) are recorded and surfaced but do not block — a reviewer
// decides at the prod gate. This matches the GHA design where those validate
// jobs were advisory.
//
// While a group runs, a ticker refreshes Slack every slackRefreshInterval so
// the single message tracks progress live (each stage's RunURL is set within
// seconds of dispatch, well before it completes) — mirroring the TUI's
// tick-driven updates. Without this, a long-running group (e.g. e2e, ~20-40m)
// would leave the message stuck on "all pending, no run links" until it ended.
func (r *run) orchestrate(ctx context.Context, groups [][]int) error {
	for _, group := range groups {
		// Plain errgroup (no WithContext): Wait() still blocks for all
		// goroutines, but a non-nil return does NOT cancel the others — so
		// siblings always finish and we keep their real results. Advisory
		// stage failures are swallowed here (RunStage already records the
		// failed state for rendering); only blocking failures propagate.
		var eg errgroup.Group
		for _, idx := range group {
			idx := idx
			eg.Go(func() error {
				err := r.p.RunStage(ctx, idx)
				if err != nil && r.p.StageAdvisory(idx) {
					return nil // advisory: non-blocking
				}
				return err
			})
		}

		stop := make(chan struct{})
		var ticker sync.WaitGroup
		ticker.Add(1)
		go func() {
			defer ticker.Done()
			t := time.NewTicker(slackRefreshInterval)
			defer t.Stop()
			for {
				select {
				case <-stop:
					return
				case <-t.C:
					r.update(ctx, false)
				}
			}
		}()

		err := eg.Wait()
		close(stop)
		ticker.Wait() // ensure no refresh races the final update below
		r.update(ctx, false)
		if err != nil {
			return err
		}
	}
	return nil
}

func (r *run) createRelease(ctx context.Context) error {
	if r.dryRun {
		logger.Log("headless: dry-run, skipping GitHub release creation")
		return nil
	}
	tag, err := r.p.GenerateReleaseTag(ctx)
	if err != nil {
		return fmt.Errorf("generating tag: %w", err)
	}
	// Build the body from the finished message MINUS the not-yet-existent
	// release link, matching the TUI's createReleaseAtCompleteCmd.
	body := render.ReleaseBody(render.Message(r.state(true, false)), r.permalink())
	url, err := r.p.CreateRelease(ctx, tag, tag, body)
	if err != nil {
		return fmt.Errorf("creating release: %w", err)
	}
	r.releaseTag, r.releaseURL = tag, url
	logger.Log("headless: created release %s (%s)", tag, url)
	return nil
}

// state projects the current pipeline + run into a render.State.
func (r *run) state(finished, aborted bool) render.State {
	return render.State{
		Operator:        r.operator,
		Branch:          r.branch,
		Commit:          r.p.Values()["commit"],
		DryRun:          r.dryRun,
		Finished:        finished,
		Aborted:         aborted,
		ReleaseNotes:    r.releaseNotes,
		ReleaseNotesURL: r.releaseNotesURL,
		AuthorMentions:  r.authorMentions,
		Stages:          r.p.Stages(),
		EnvOrder:        r.envOrder(),
		Snapshot:        r.p.Snapshot,
		ReleaseTag:      r.releaseTag,
		ReleaseURL:      r.releaseURL,
		ApprovedBy:      r.approvedBy,
		Elapsed:         time.Since(r.start),
	}
}

// resolveAuthorMentions maps -godaddy release-note authors to Slack mention
// tokens so the initial post pings contributors. Best-effort: unresolvable
// handles fall back to plain "@handle" text in the rendered message.
func (r *run) resolveAuthorMentions(ctx context.Context) {
	r.authorMentions = r.notifier.ResolveMentionMap(ctx, render.AuthorHandles(r.releaseNotes))
}

// envOrder returns the environment names in config order, so the renderer's
// "first env produces deploy values" logic matches the TUI.
func (r *run) envOrder() []string {
	var order []string
	seen := map[string]bool{}
	for _, sr := range r.p.Stages() {
		if sr.Env == "rollback" || seen[sr.Env] {
			continue
		}
		seen[sr.Env] = true
		order = append(order, sr.Env)
	}
	return order
}

func (r *run) postInitial(ctx context.Context) {
	if r.notifier == nil {
		return
	}
	r.notifier.Post(ctx, render.Message(r.state(false, false)))
}

func (r *run) update(ctx context.Context, finished bool) {
	if r.notifier == nil {
		return
	}
	r.notifier.Update(ctx, render.Message(r.state(finished, false)))
}

// awaitingState projects the "test done, paused at the prod approval gate"
// moment: not finished, but flagged so the message renders a Review & approve
// call-to-action linking to this run.
func (r *run) awaitingState() render.State {
	s := r.state(false, false)
	s.AwaitingApproval = true
	s.RunURL = r.runURL
	return s
}

// updateAwaiting posts the approval call-to-action — the explicit Slack ping
// that a human needs to approve prod before the pipeline continues.
func (r *run) updateAwaiting(ctx context.Context) {
	if r.notifier == nil {
		return
	}
	r.notifier.Update(ctx, render.Message(r.awaitingState()))
}

func (r *run) fail(ctx context.Context, msg string) {
	if r.notifier == nil {
		return
	}
	s := r.state(true, true)
	s.StatusMessage = msg
	r.notifier.Update(ctx, render.Message(s))
	// Tell the GHA slack-failure backstop we already flipped the thread to
	// FAILED in place, so it doesn't post a SECOND, duplicate notification.
	// The backstop only fires when this output is absent (a hard failure —
	// build error, OOM, runner death — where the binary never got to post).
	r.emitOutput("notified", "true")
}

func (r *run) ts() string {
	if r.notifier == nil {
		return ""
	}
	return r.notifier.TS()
}

func (r *run) permalink() string {
	if r.notifier == nil {
		return ""
	}
	return r.notifier.Permalink()
}

func (r *run) writeState(path string) error {
	if path == "" {
		return fmt.Errorf("--state-file is required for the test phase")
	}
	pipeBytes, err := r.p.ExportState()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(phaseState{
		Pipeline:        pipeBytes,
		ReleaseNotes:    r.releaseNotes,
		ReleaseNotesURL: r.releaseNotesURL,
		AuthorMentions:  r.authorMentions,
		SlackTS:         r.ts(),
		Operator:        r.operator,
		Branch:          r.branch,
		StartUnix:       r.start.Unix(),
	}, "", "  ")
	if err != nil {
		return err
	}
	// 0o600: the file carries no secrets, but it does hold the operator name,
	// branch, slack ts, and the full values map — keep it owner-only on the
	// shared self-hosted runner pool.
	return os.WriteFile(path, data, 0o600)
}

func readState(path string) (*phaseState, error) {
	if path == "" {
		return nil, fmt.Errorf("--state-file is required for the prod phase")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var st phaseState
	if err := json.Unmarshal(data, &st); err != nil {
		return nil, err
	}
	return &st, nil
}

// emitOutput appends key=value to $GITHUB_OUTPUT when set, else stdout.
func emitOutput(w *os.File, key, value string) {
	fmt.Fprintf(w, "%s=%s\n", key, value)
}

func (r *run) emitOutput(key, value string) {
	if path := os.Getenv("GITHUB_OUTPUT"); path != "" {
		f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o644)
		if err == nil {
			defer f.Close()
			emitOutput(f, key, value)
			return
		}
		// Don't silently swallow it: a named output going to stdout instead is
		// a real (if rare) misconfiguration worth a log line.
		logger.Log("headless.warn: could not open GITHUB_OUTPUT %q (%v); writing %q to stdout", path, err, key)
	}
	emitOutput(os.Stdout, key, value)
}

// stepSummaryWriter returns the GHA job-summary file (markdown, appended) and a
// close func, or stdout + a no-op when not running under Actions / on error.
func stepSummaryWriter() (io.Writer, func()) {
	if path := os.Getenv("GITHUB_STEP_SUMMARY"); path != "" {
		if f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o644); err == nil {
			return f, func() { f.Close() }
		} else {
			logger.Log("headless.warn: could not open GITHUB_STEP_SUMMARY %q (%v); writing to stdout", path, err)
		}
	}
	return os.Stdout, func() {}
}

// writeTestSummary prints a human-readable result table to $GITHUB_STEP_SUMMARY
// (markdown) for the approve-prod reviewer, followed by the test-phase manual
// checklist so the reviewer can tick it off before approving; falls back to stdout.
func (r *run) writeTestSummary() {
	w, done := stepSummaryWriter()
	defer done()

	fmt.Fprintf(w, "## Test phase results\n\n- Branch: `%s`\n- Commit: `%s`\n\n", r.branch, short(r.p.Values()["commit"]))
	fmt.Fprintln(w, "| Stage | Result | Run |")
	fmt.Fprintln(w, "| --- | --- | --- |")
	for _, sr := range r.p.Stages() {
		if sr.Env == "rollback" {
			continue
		}
		link := "—"
		if sr.RunURL != "" {
			link = fmt.Sprintf("[run](%s)", sr.RunURL)
		}
		fmt.Fprintf(w, "| %s | %s | %s |\n", sr.Stage.Name, sr.State.String(), link)
	}
	writeChecklistSection(w, "test", r.p.Stages())
}

// writeProdSummary prints the prod-phase manual checklist to $GITHUB_STEP_SUMMARY
// after the release is cut, so the deployer doesn't forget the post-deploy
// verification on prod; falls back to stdout.
func (r *run) writeProdSummary() {
	w, done := stepSummaryWriter()
	defer done()

	fmt.Fprintf(w, "## Prod release\n\n- Branch: `%s`\n- Commit: `%s`\n", r.branch, short(r.p.Values()["commit"]))
	if r.releaseTag != "" {
		fmt.Fprintf(w, "- Release: [%s](%s)\n", r.releaseTag, r.releaseURL)
	}
	writeChecklistSection(w, "prod", r.p.Stages())
}

// writeChecklistSection appends the manual-checklist items for env (a stage of
// type "checklist") to w as a markdown task list, so they render on the GHA job
// summary page and the dev can't miss them. No-op when env has no checklist.
func writeChecklistSection(w io.Writer, env string, stages []*pipeline.StageRun) {
	for _, sr := range stages {
		if sr.Env != env || sr.Stage.Type != "checklist" || len(sr.Stage.Items) == 0 {
			continue
		}
		fmt.Fprintf(w, "\n### :ballot_box_with_check: %s — %s\n\n", sr.Stage.Name, env)
		for _, item := range sr.Stage.Items {
			fmt.Fprintf(w, "- [ ] %s\n", item)
		}
	}
}

func short(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}

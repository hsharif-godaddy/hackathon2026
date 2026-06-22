// Command backfill-legacy records metadata-only `legacy` sandbox rows for apps
// that already have a pre-stripe-v2 ("paste your secret key") Stripe
// integration.
//
// Run it once for the existing population of manual-key apps before flipping
// PLATFORM_MANAGED_FLAG on. Once a legacy row exists, stripe-service's
// POST /v1/sandboxes (in PR2 of the rollout) short-circuits and refuses to
// provision a sandbox over the merchant's pasted key — which would push
// sk_test_* over their sk_live_* and break checkout.
//
// New manual-key users that come through the skill after PR1 ships self-mark
// themselves automatically (the agent calls POST /v1/legacy when stripe__setup
// is about to return autoProvisioningUnavailable). This command is the safety
// net for dormant apps that haven't re-engaged the skill.
//
// Input is an explicit list of appIds, one per line (blank lines and lines
// beginning with '#' are ignored). Determining WHICH apps are legacy — i.e.
// which have a STRIPE_SECRET_KEY with systemManaged:false in hosting — is done
// separately by the operator (a query against hosting's secrets data, or the
// agents SQLite history of requestSecrets calls) and fed in as this list. The
// job is deliberately a dumb writer: it does not read hosting itself
// (stripe-service has no hosting GET path — the frontdoor only permits awsiam
// on POST), and a mis-supplied list is inspectable and reversible, unlike a
// runtime misdetection.
//
// The job writes DynamoDB directly via the store package using the default AWS
// credential chain (run it with credentials for the target env's account). It
// does NOT go through the awsiam-protected POST /v1/legacy HTTP endpoint —
// that endpoint serves the agent self-mark path; this is the batch path.
//
// CAUTION — a wrong appId is permanent until manually undone. The `legacy`
// claim_status is terminal: no webhook advances it. A mistyped or wrongly
// included appId blocks managed provisioning for that real app forever (its
// stripe__setup will short-circuit to {legacy:true}), recoverable only by
// manually deleting the legacy#<appId> row from DynamoDB. Always --dry-run
// first and eyeball the list.
//
// Usage:
//
//	ENVIRONMENT=prod backfill-legacy --apps-file=cohort.txt
//	ENVIRONMENT=prod backfill-legacy --apps-file=cohort.txt --dry-run
//	backfill-legacy --table=prod-airo-stripe-sandboxes --apps-file=cohort.txt
//
// Idempotent: re-running overwrites the same `legacy#<appId>` row (and resets
// its created_at — see store.PutLegacy). Safe to overlap with the agent
// self-mark path.
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/awsclients"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/store"
)

func main() {
	appsFile := flag.String("apps-file", "", "path to a file of appIds (one per line; '#' comments and blanks ignored). Use '-' for stdin.")
	table := flag.String("table", "", "DynamoDB sandboxes table name. Defaults to the ENVIRONMENT-derived name (e.g. prod-airo-stripe-sandboxes).")
	dryRun := flag.Bool("dry-run", false, "log what would be written without calling DynamoDB.")
	flag.Parse()

	if *appsFile == "" {
		fmt.Fprintln(os.Stderr, "error: --apps-file is required")
		flag.Usage()
		os.Exit(2)
	}

	// Derive the table name from ENVIRONMENT (local maps to dev's names, same
	// as config.ResourceNames). We avoid config.Load() here: it pulls in the
	// full service config (auth/SSO) that a batch writer has no need for.
	tableName := *table
	if tableName == "" {
		env := os.Getenv("ENVIRONMENT")
		if env == "" || env == "local" {
			env = "dev"
		}
		tableName = env + "-airo-stripe-sandboxes"
	}

	appIDs, err := readAppIDs(*appsFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: read apps file: %v\n", err)
		os.Exit(1)
	}
	if len(appIDs) == 0 {
		fmt.Fprintln(os.Stderr, "error: no appIds found in apps file")
		os.Exit(1)
	}

	ctx := context.Background()
	sandboxes, err := newStore(ctx, tableName, *dryRun)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("backfill-legacy: table=%s apps=%d dry_run=%t\n", tableName, len(appIDs), *dryRun)
	var ok, skipped int
	var failedIDs []string
	for _, appID := range appIDs {
		if *dryRun {
			fmt.Printf("  [dry-run] would record legacy: %s\n", appID)
			ok++
			continue
		}

		// Guard: skip apps that already have a managed (non-legacy) sandbox row.
		// Writing a legacy row for those would mask the existing sandbox — the
		// postSandboxes short-circuit scans for a legacy row first, so the
		// provisioned sandbox would be invisible to stripe__setup forever.
		checkCtx, checkCancel := context.WithTimeout(ctx, 10*time.Second)
		existing, checkErr := sandboxes.QueryByAppID(checkCtx, appID)
		checkCancel()
		if checkErr != nil {
			fmt.Fprintf(os.Stderr, "  FAILED %s (pre-check query): %v\n", appID, checkErr)
			failedIDs = append(failedIDs, appID)
			continue
		}
		hasManaged := false
		for _, sb := range existing {
			if sb.ClaimStatus != store.ClaimStatusLegacy {
				fmt.Printf("  SKIPPED %s: already has managed sandbox (sandbox_id=%s status=%s)\n", appID, sb.SandboxID, sb.ClaimStatus)
				hasManaged = true
				break
			}
		}
		if hasManaged {
			skipped++
			continue
		}

		putCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := sandboxes.PutLegacy(putCtx, appID)
		cancel()
		if err != nil {
			fmt.Fprintf(os.Stderr, "  FAILED %s: %v\n", appID, err)
			failedIDs = append(failedIDs, appID)
			continue
		}
		fmt.Printf("  recorded legacy: %s\n", appID)
		ok++
	}

	fmt.Printf("backfill-legacy: done ok=%d skipped=%d failed=%d\n", ok, skipped, len(failedIDs))
	if len(failedIDs) > 0 {
		fmt.Fprintln(os.Stderr, "failed appIds (re-runnable list):")
		for _, id := range failedIDs {
			fmt.Fprintln(os.Stderr, id)
		}
		os.Exit(1)
	}
}

// newStore builds a Sandboxes store, or a no-op-safe one for dry runs. On a
// dry run we don't construct AWS clients at all, so the job can be rehearsed
// without credentials.
func newStore(ctx context.Context, table string, dryRun bool) (*store.Sandboxes, error) {
	if dryRun {
		return nil, nil
	}
	clients, err := awsclients.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("build aws clients: %w", err)
	}
	return store.NewSandboxes(clients.DynamoDB(), table), nil
}

// readAppIDs parses one appId per line, skipping blanks and '#' comments.
// "-" reads from stdin.
func readAppIDs(path string) ([]string, error) {
	var r *os.File
	if path == "-" {
		r = os.Stdin
	} else {
		f, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		r = f
	}

	var ids []string
	seen := map[string]bool{}
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if seen[line] {
			continue
		}
		seen[line] = true
		ids = append(ids, line)
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return ids, nil
}

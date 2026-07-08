package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/agentsurl"
	"github.com/airo-ai-builder/local-control-plane/internal/auth"
	"github.com/airo-ai-builder/local-control-plane/internal/store"
)

const (
	// agentCleanupHTTPTimeout bounds each list/delete call to the agents service.
	agentCleanupHTTPTimeout = 15 * time.Second

	// agentListPageLimit is the page size used when enumerating agents-service
	// apps during the orphan sweep.
	agentListPageLimit = 200

	// agentBypassSiteID is one of the agents service's BYPASS_SITE_IDS
	// (src/services/features.ts). A JWT minted with this siteId is exempt from
	// per-site isolation, so `GET /apps` returns every app (not just one) — the
	// only way the control-plane can enumerate the agents DB to find orphans.
	agentBypassSiteID = "local-dev-site" //nolint:gosec // G101 false positive: a well-known non-secret bypass siteId, not a credential

	// agentReadyTimeout bounds how long the startup sweep waits for the agents
	// service to become reachable. The control-plane and agents boot
	// concurrently, so the first list calls typically fail — connection-refused
	// (agents not listening) or timeout (agents listening but slow to respond) —
	// until agents finishes starting. If it never comes up, the sweep gives up
	// and the next control-plane restart retries.
	agentReadyTimeout = 2 * time.Minute

	// agentReadyRetryInterval is the delay between reachability retries.
	agentReadyRetryInterval = 2 * time.Second
)

// agentCleanupHTTPClient is reused across all list/delete calls to the agents
// service (mirrors previewReadyHTTPClient in apps.go) rather than allocating a
// client per call in the sweep loop.
var agentCleanupHTTPClient = &http.Client{Timeout: agentCleanupHTTPTimeout}

// deleteAppFromAgent removes an app's record from the agents service SQLite DB
// via `DELETE /apps/{appID}`. It is the delete-side counterpart to
// registerWithAgent: the control-plane owns the app lifecycle and must tear the
// agents-side record down when it deletes an app, otherwise the agents DB
// accumulates orphaned rows forever.
//
// The minted JWT carries siteId == appID, which satisfies the agents ownership
// guard (validateAppOwnership: authenticatedSiteId === requestedAppId). A 404
// is treated as success — the record is already gone, which is the desired end
// state.
func deleteAppFromAgent(ctx context.Context, jwt *auth.JWTService, appID string) error {
	if !store.IsValidAppID(appID) {
		return fmt.Errorf("invalid app id %q", appID)
	}

	agentsURL := agentsurl.Default()

	//nolint:gosec // G704 false positive: host is fixed (agentsurl.Default()); appID is validated canonical above, not an attacker-controlled host.
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, agentsURL+"/apps/"+appID, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}

	if jwt != nil {
		token, mintErr := jwt.Mint(appID)
		if mintErr != nil {
			return fmt.Errorf("jwt mint: %w", mintErr)
		}
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := agentCleanupHTTPClient.Do(req) //nolint:gosec // G704 false positive: request targets the fixed agents host, see above.
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	if resp.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

// listAgentAppIDs enumerates every app registered in the agents service by
// paging through `GET /apps` with a bypass-site JWT (see agentBypassSiteID).
func listAgentAppIDs(ctx context.Context, jwt *auth.JWTService) ([]string, error) {
	agentsURL := agentsurl.Default()

	var ids []string
	for page := 1; ; page++ {
		url := fmt.Sprintf("%s/apps?page=%d&limit=%d", agentsURL, page, agentListPageLimit)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, fmt.Errorf("build request: %w", err)
		}

		if jwt != nil {
			token, mintErr := jwt.Mint(agentBypassSiteID)
			if mintErr != nil {
				return nil, fmt.Errorf("jwt mint: %w", mintErr)
			}
			req.Header.Set("Authorization", "Bearer "+token)
		}

		resp, err := agentCleanupHTTPClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("http request: %w", err)
		}

		var body struct {
			Apps []struct {
				ID string `json:"id"`
			} `json:"apps"`
			Pagination struct {
				TotalPages int `json:"totalPages"`
			} `json:"pagination"`
		}
		decErr := json.NewDecoder(resp.Body).Decode(&body)
		status := resp.StatusCode
		_ = resp.Body.Close()

		if status >= http.StatusMultipleChoices {
			return nil, fmt.Errorf("unexpected status %d", status)
		}
		if decErr != nil {
			return nil, fmt.Errorf("decode: %w", decErr)
		}

		for _, app := range body.Apps {
			ids = append(ids, app.ID)
		}

		if len(body.Apps) == 0 || page >= body.Pagination.TotalPages {
			break
		}
	}

	return ids, nil
}

// isAgentUnreachable reports whether err is a transport-level failure — the
// agents service isn't ready to serve yet. This covers both connection refused
// (net.OpError, agents not listening) and timeouts (the client-timeout
// *url.Error, agents listening but slow to respond during startup); both
// implement net.Error. Application-level failures (non-2xx status, JSON decode)
// are plain fmt.Errorf values and won't match, so they are not retried.
func isAgentUnreachable(err error) bool {
	var netErr net.Error
	return errors.As(err, &netErr)
}

// listAgentAppIDsAwaitReady lists agents apps, retrying while the agents
// service is still starting (not reachable — see isAgentUnreachable). It gives
// up on any other error (auth, decode, non-2xx) since those won't resolve by
// waiting, and on ctx cancellation or the overall agentReadyTimeout.
func listAgentAppIDsAwaitReady(ctx context.Context, jwt *auth.JWTService) ([]string, error) {
	deadline := time.Now().Add(agentReadyTimeout)
	waited := false

	for {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}

		ids, err := listAgentAppIDs(ctx, jwt)
		if err == nil {
			return ids, nil
		}
		if !isAgentUnreachable(err) || time.Now().After(deadline) {
			return nil, err
		}

		if !waited {
			slog.Info("agent.sweep.await_agents", "retry_in", agentReadyRetryInterval, "give_up_after", agentReadyTimeout)
			waited = true
		}

		select {
		case <-time.After(agentReadyRetryInterval):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

// SweepOrphanAgentApps deletes agents-service app records that have no
// corresponding control-plane app. It runs at startup, right after the Docker
// reconcile: reconcile first removes stale control-plane rows (and their
// containers), so any agents app whose ID is no longer in the control-plane DB
// is genuinely orphaned and safe to delete.
//
// Because the control-plane and agents boot concurrently, this waits for the
// agents service to become reachable (see listAgentAppIDsAwaitReady) before
// sweeping. Callers should run it in a goroutine so that wait never blocks the
// control-plane's own startup.
//
// This clears the backlog of records left behind before delete propagation
// existed, and backstops any delete path that bypasses DeleteApp. It is safe
// against in-flight creation because the control-plane inserts an app row
// (CreateApp) before it ever registers that app with the agents service
// (registerWithAgent), so a registered agents app always has a control-plane
// row.
//
// Assumption: the agents service at AGENTS_BASE_URL is this local control
// plane's dedicated instance. The bypass-site JWT enumerates every agents row,
// so pointing this at a shared/non-loopback agents instance would let the sweep
// delete rows for apps this control plane never provisioned. This holds for
// local dev (loopback default) and is defended in depth by the agents service
// rejecting BYPASS_SITE_IDS when NODE_ENV=production.
func SweepOrphanAgentApps(ctx context.Context, db *store.DB, jwt *auth.JWTService) {
	apps, err := db.ListAllApps()
	if err != nil {
		slog.Warn("agent.sweep.list_cp_apps.failed", "error", err)
		return
	}

	known := make(map[string]bool, len(apps))
	for _, app := range apps {
		known[app.ID] = true
	}

	agentAppIDs, err := listAgentAppIDsAwaitReady(ctx, jwt)
	if err != nil {
		slog.Warn("agent.sweep.list_agent_apps.failed", "error", err)
		return
	}

	var swept, failed int
	for _, appID := range agentAppIDs {
		if known[appID] {
			continue
		}

		if delErr := deleteAppFromAgent(ctx, jwt, appID); delErr != nil {
			slog.Warn("agent.sweep.delete.failed", "app_id", appID, "error", delErr)
			failed++
			continue
		}

		slog.Info("agent.sweep.orphan_deleted", "app_id", appID)
		swept++
	}

	// Elevate to Warn when any delete failed: a persistently-failing backstop is
	// the exact leak this sweep exists to prevent, so it shouldn't sit at Info.
	logComplete := slog.Info
	if failed > 0 {
		logComplete = slog.Warn
	}
	logComplete(
		"agent.sweep.complete",
		"agent_apps", len(agentAppIDs),
		"cp_apps", len(apps),
		"swept", swept,
		"failed", failed,
	)
}

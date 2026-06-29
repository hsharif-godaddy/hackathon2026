package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/agentsurl"
	"github.com/airo-ai-builder/local-control-plane/internal/docker"
	"github.com/airo-ai-builder/local-control-plane/internal/setup"
	"github.com/airo-ai-builder/local-control-plane/internal/store"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

const (
	previewReadyTimeout      = 45 * time.Second
	previewReadyPollInterval = 500 * time.Millisecond

	registerMaxAttempts    = 5
	registerBaseDelay      = 2 * time.Second
	registerMaxDelay       = 15 * time.Second
	registerHTTPTimeout    = 30 * time.Second
	registerOverallTimeout = 3 * time.Minute
)

// SSOContext mirrors the four Auth-at-Edge fields mhp-core's airo-go surfaces
// on the app GET response:
//
//	ssoRequired         — resolved bool (admin tier + per-app override collapsed)
//	ssoConfigId         — bound enterprise SSO config row id
//	ssoRequiredOverride — raw per-app override (true / false / null) — drives
//	                      the customer-facing toggle's checked state
//	ssoOverrideAllowed  — true iff admin tier is "optional" (customer can flip)
type SSOContext struct {
	Required         bool
	ConfigID         string
	RequiredOverride *bool
	OverrideAllowed  bool
}

// resolveSSOContext is LCP's shim for what mhp-core's airo-go computes from
// the three-tier admin lock (`'true' | 'false' | 'optional'` on the sub's
// enterprise SSO config) + per-app `airo_apps.sso_required` override.
//
// Local dev knobs (AAB_DEV_SUBSCRIPTION_POLICY env):
//   - "required"          → admin tier `'true'`: enforced, no toggle.
//   - "optional"          → admin tier `'optional'`: customer toggle. Defaults
//     to disabled; AAB_DEV_SSO_OVERRIDE=true|false can pre-set the override.
//   - "optional_default_on" → same admin tier, but per-app override defaults
//     to true. Useful for quickly testing the "customer enabled SSO" path.
//   - "false" / "off" / "" → no SSO surface at all (non-ent persona).
//
// `ssoConfigId` is synthesized as a single deterministic value matching the
// GD-internal `godaddy_shopper` config when SSO is in play.
func resolveSSOContext() SSOContext {
	const localConfigID = "local-sso-cfg-godaddy-shopper"

	policy := os.Getenv("AAB_DEV_SUBSCRIPTION_POLICY")
	switch policy {
	case "required":
		return SSOContext{Required: true, ConfigID: localConfigID, OverrideAllowed: false}
	case "optional", "optional_default_off":
		override := parseOptionalEnvBool(os.Getenv("AAB_DEV_SSO_OVERRIDE"))
		// Resolved bool when admin tier is 'optional': honor the per-app
		// override; NULL → false (the empty/cleared state). Matches
		// airo-go's `ResolveSSORequired`.
		required := override != nil && *override
		return SSOContext{
			Required:         required,
			ConfigID:         localConfigID,
			RequiredOverride: override,
			OverrideAllowed:  true,
		}
	case "optional_default_on":
		trueVal := true
		return SSOContext{
			Required:         true,
			ConfigID:         localConfigID,
			RequiredOverride: &trueVal,
			OverrideAllowed:  true,
		}
	default:
		return SSOContext{}
	}
}

// parseOptionalEnvBool returns nil for missing/empty env (deferred), &true
// for "true"/"1", &false for "false"/"0". Any other value returns nil so
// invalid inputs fail closed rather than silently defaulting.
func parseOptionalEnvBool(s string) *bool {
	switch s {
	case "true", "1":
		t := true
		return &t
	case "false", "0":
		f := false
		return &f
	default:
		return nil
	}
}

// resolveLocalOwnerProduct picks the `ownerProduct` value LCP emits on the
// fake mgmt-airo app GET response. Mirrors what mhp-core puts on the
// `system.ownerProduct` field — the AAB BFF lifts it to
// `SiteInfo.ownerProduct` and the `useEnterpriseManaged()` hook keys off
// the `'aab-ent-v1'` sentinel.
//
// Resolution order:
//
//  1. `AAB_DEV_OWNER_PRODUCT` env (explicit override; any string).
//  2. If `AAB_DEV_SUBSCRIPTION_POLICY` is set (Phase-1 ent-persona
//     simulator), default to `aab-ent-v1` — every ent surface that gates
//     on `ssoRequired` should also see the ent product, otherwise the
//     upgrade-button-hide logic stays dormant while SSO + share-gate +
//     publish-gate fire.
//  3. Otherwise: `AiroAppBuilder` (non-ent default, byte-identical to
//     pre-ent local-dev behavior).
func resolveLocalOwnerProduct() string {
	if override := os.Getenv("AAB_DEV_OWNER_PRODUCT"); override != "" {
		return override
	}
	if os.Getenv("AAB_DEV_SUBSCRIPTION_POLICY") != "" {
		return "aab-ent-v1"
	}
	return "AiroAppBuilder"
}

var previewReadyHTTPClient = &http.Client{
	Timeout: 2 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{
			// InsecureSkipVerify avoids requiring the host CA store to include the
			// Gasket cert chain (GoDaddy-signed, but not all dev environments trust it).
			InsecureSkipVerify: true, //nolint:gosec // nosemgrep: problem-based-packs.insecure-transport.go-stdlib.bypass-tls-verification.bypass-tls-verification
			MinVersion:         tls.VersionTLS12,
		},
	},
}

func appToResponse(app *store.App) map[string]any {
	// Archived apps are signaled solely by lifecycleState == "archived".
	// The app-level status stays at its actual value, and variant status
	// mirrors app.Status as well. Clients should key off lifecycle state,
	// not app/variant status or reason, to detect archival.
	lifecycleState := store.LifecycleStateRunning
	switch {
	case archiveStubIsArchived(app.ID):
		lifecycleState = store.LifecycleStateArchived
	case app.Status == "paused":
		lifecycleState = store.LifecycleStatePaused
	}

	variantsWithLifecycle := make([]map[string]any, 0, len(app.Variants))
	for _, v := range app.Variants {
		variantsWithLifecycle = append(variantsWithLifecycle, map[string]any{
			"variant": v,
			"status":  app.Status,
			"lifecycle": map[string]any{
				"lifecycleState": lifecycleState,
				"stateChangedAt": app.UpdatedAt,
			},
		})
	}

	if app.Variables == nil {
		app.Variables = map[string]any{}
	}

	// topLifecycleState resolves the API's top-level lifecycleState from two
	// sources: the persisted app.LifecycleState column (set by the upgrade
	// orchestrator in Phase 4 to values like "upgrade_pending"), and a locally
	// computed fallback derived from the archive stub + paused status.
	//
	// Precedence: when persisted value is not "running", use it (it's a
	// specific signal). When persisted value is "running" (the post-provision
	// steady state OR the migration default for legacy rows), defer to the
	// local computation — which will return "archived" or "paused" if those
	// apply, else "running".
	topLifecycleState := app.LifecycleState
	if topLifecycleState == "" || topLifecycleState == store.LifecycleStateRunning {
		topLifecycleState = lifecycleState // local computation
	}

	// Auth-at-Edge SSO context. The four fields mirror mhp-core's
	// airo-go-enriched app GET response. AAB UI gates Settings → SSO panel +
	// publish/share UX off `ssoRequired`; the customer-facing override
	// toggle is gated on `ssoOverrideAllowed`.
	ssoCtx := resolveSSOContext()

	resp := map[string]any{
		"id":                    app.ID,
		"subscriptionId":        app.SubscriptionID,
		"systemId":              app.SystemID,
		"customerId":            store.DefaultCustomerID,
		"status":                app.Status,
		"variables":             app.Variables,
		"variants":              app.Variants,
		"variantsWithLifecycle": variantsWithLifecycle,
		"appTemplateName":       "default",
		"createdAt":             app.CreatedAt,
		"updatedAt":             app.UpdatedAt,
		"cellId":                "local-dev",
		"compositionId":         "ai-builder",
		// lifecycleState is always emitted (with fallback) — imageDigest is conditional below.
		// The asymmetry mirrors the model: lifecycle has a meaningful default, digest doesn't.
		"lifecycleState": topLifecycleState,
		"system": map[string]any{
			// Local-dev ent simulator. `AAB_DEV_OWNER_PRODUCT` is the explicit
			// override; absent that, ent-persona testing (any value in
			// `AAB_DEV_SUBSCRIPTION_POLICY`, which is how Phase-1 ent is
			// simulated locally) flips the product to `aab-ent-v1` so the BFF's
			// `useEnterpriseManaged()` hook and the agent-side
			// `isEnterpriseManagedApp()` helper both see the ent sentinel.
			// Without this shim, the upgrade-button-hide logic stays dormant
			// in local dev even when the rest of the ent UI surfaces (SSO
			// panel, share-link gate, publish-button SSO gate) are active.
			"ownerProduct": resolveLocalOwnerProduct(),
			"productId":    store.DefaultProductID,
		},
		"ssoRequired":        ssoCtx.Required,
		"ssoConfigId":        ssoCtx.ConfigID,
		"ssoOverrideAllowed": ssoCtx.OverrideAllowed,
		// ssoRequiredOverride is tri-state — emit even when null so the BFF
		// can distinguish "field present, no override" from "field absent."
		"ssoRequiredOverride": ssoCtx.RequiredOverride,
	}
	if app.ImageDigest != "" {
		resp["imageDigest"] = app.ImageDigest
	}

	agentsURL := agentsurl.Default()
	urls := map[string]string{
		"agent":   agentsURL,
		"backend": agentsURL,
	}
	if app.PreviewPort > 0 {
		urls["preview"] = fmt.Sprintf("https://local.gasket.dev-godaddy.com:%d", app.PreviewPort)
	}
	if app.PublishPort > 0 {
		urls["publish"] = fmt.Sprintf("https://local.gasket.dev-godaddy.com:%d", app.PublishPort)
	}
	resp["urls"] = urls

	if app.SupervisorPort > 0 {
		resp["socketPath"] = fmt.Sprintf("tcp://localhost:%d", app.SupervisorPort)
	}
	if app.PublishSupervisorPort > 0 {
		resp["publishSupervisorPath"] = fmt.Sprintf("tcp://localhost:%d", app.PublishSupervisorPort)
	}

	// Include custom domains if any have been attached via ModifyDomains.
	if domains := GetAppDomains(app.ID); len(domains) > 0 {
		resp["domains"] = domains
	}

	return resp
}

func ensureAabTeamVentureID(variables map[string]any) bool {
	if variables == nil {
		return false
	}
	if _, ok := variables["aabTeamVentureId"]; ok {
		return false
	}
	if _, ok := variables["aab_team_venture_id"]; ok {
		return false
	}
	if _, ok := variables["teamVentureId"]; ok {
		return false
	}
	variables["aabTeamVentureId"] = uuid.New().String()
	return true
}

func (s *Server) ListApps(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)

	apps, err := s.DB.ListApps(vars["subId"], vars["sysId"])
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	result := make([]map[string]any, 0, len(apps))
	for _, app := range apps {
		s.backfillVentureID(app)
		result = append(result, appToResponse(app))
	}

	writeJSON(w, http.StatusOK, map[string]any{"apps": result})
}

func (s *Server) GetAllApps(w http.ResponseWriter, r *http.Request) {
	custID := customerIDFromRequest(r)
	apps, err := s.DB.ListAppsByCustomer(custID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	result := make([]map[string]any, 0, len(apps))
	for _, app := range apps {
		s.backfillVentureID(app)
		result = append(result, appToResponse(app))
	}

	writeJSON(w, http.StatusOK, map[string]any{"apps": result})
}

func (s *Server) backfillVentureID(app *store.App) {
	if app.Variables == nil {
		app.Variables = map[string]any{}
	}
	if ensureAabTeamVentureID(app.Variables) {
		if _, err := s.DB.UpdateApp(app.ID, nil, map[string]any{"aabTeamVentureId": app.Variables["aabTeamVentureId"]}, nil); err != nil {
			slog.Warn("app.backfill_venture_id.failed", "app_id", app.ID, "error", err)
		}
	}
}

func (s *Server) GetApp(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)

	app, err := s.DB.GetApp(vars["appId"])
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if app == nil {
		writeError(w, http.StatusNotFound, "app not found")
		return
	}

	s.backfillVentureID(app)
	writeJSON(w, http.StatusOK, appToResponse(app))
}

func (s *Server) CreateApp(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)

	var body struct {
		AppTemplateName string         `json:"appTemplateName"`
		Variants        []string       `json:"variants"`
		Variables       map[string]any `json:"variables"`
		Datacenter      string         `json:"datacenter"`
	}

	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	variables := body.Variables
	if variables == nil {
		variables = map[string]any{}
	}
	ensureAabTeamVentureID(variables)

	app, err := s.DB.CreateApp(vars["subId"], vars["sysId"], variables, body.Variants)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	job, err := s.DB.CreateJob(app.ID, "airo-app-create")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	slog.Info("app.created", "app_id", app.ID, "job_id", job.ID)

	// Provision asynchronously so the HTTP response returns immediately.
	// The client polls the job endpoint to check readiness.
	go func() {
		if err := s.DB.UpdateJobStatus(job.ID, "running", ""); err != nil {
			slog.Error("job.status_update.failed", "job_id", job.ID, "error", err)
		}
		if err := s.provisionApp(app); err != nil {
			slog.Error("app.provision.failed", "app_id", app.ID, "error", err)
			if err := s.DB.UpdateJobStatus(job.ID, "failed", err.Error()); err != nil {
				slog.Error("job.status_update.failed", "job_id", job.ID, "error", err)
			}
			return
		}
		if err := s.DB.UpdateJobStatus(job.ID, "completed", ""); err != nil {
			slog.Error("job.status_update.failed", "job_id", job.ID, "error", err)
		}
	}()

	writeJSON(w, http.StatusCreated, map[string]any{
		"statusJobId": job.ID,
	})
}

func (s *Server) Signup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Datacenter    string `json:"datacenter"`
		IsTrial       bool   `json:"isTrial"`
		ProductID     string `json:"productId"`
		InitialPrompt string `json:"initialPrompt"`
		AppConfigs    []struct {
			TemplateName string         `json:"templateName"`
			Variants     []string       `json:"variants"`
			Variables    map[string]any `json:"variables"`
		} `json:"appConfigs"`
	}

	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Use first app config or default
	var variables map[string]any
	var variants []string
	if len(body.AppConfigs) > 0 {
		variables = body.AppConfigs[0].Variables
		variants = body.AppConfigs[0].Variants
	}
	if variables == nil {
		variables = map[string]any{}
	}
	if body.InitialPrompt != "" {
		variables["initialPrompt"] = body.InitialPrompt
	}

	custID := customerIDFromRequest(r)
	subID := store.SubscriptionIDForCustomer(custID)
	sysID := store.SystemIDForCustomer(custID)

	if _, err := s.DB.EnsureSubscription(subID, custID); err != nil {
		writeStoreError(w, err)
		return
	}

	ensureAabTeamVentureID(variables)

	app, err := s.DB.CreateApp(subID, sysID, variables, variants)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	job, err := s.DB.CreateJob(app.ID, "airo-app-provision")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	slog.Info("signup.complete", "app_id", app.ID, "job_id", job.ID)

	go func() {
		if err := s.DB.UpdateJobStatus(job.ID, "running", ""); err != nil {
			slog.Error("job.status_update.failed", "job_id", job.ID, "error", err)
		}
		if err := s.provisionApp(app); err != nil {
			slog.Error("app.provision.failed", "app_id", app.ID, "error", err)
			if err := s.DB.UpdateJobStatus(job.ID, "failed", err.Error()); err != nil {
				slog.Error("job.status_update.failed", "job_id", job.ID, "error", err)
			}
			return
		}
		if err := s.DB.UpdateJobStatus(job.ID, "completed", ""); err != nil {
			slog.Error("job.status_update.failed", "job_id", job.ID, "error", err)
		}
	}()

	writeJSON(w, http.StatusCreated, map[string]any{
		"statusJobId": job.ID,
	})
}

func (s *Server) UpdateApp(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)

	var body struct {
		Status    string         `json:"status"`
		Variables map[string]any `json:"variables"`
	}

	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var statusPtr *string
	if body.Status != "" {
		statusPtr = &body.Status
	}

	app, err := s.DB.UpdateApp(vars["appId"], statusPtr, body.Variables, nil)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, err.Error())
		} else {
			writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	writeJSON(w, http.StatusOK, appToResponse(app))
}

func (s *Server) DeleteApp(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]

	app, err := s.DB.GetApp(appID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if app == nil {
		writeError(w, http.StatusNotFound, "app not found")
		return
	}

	// Tear down Docker containers
	if err := s.DockerManager.Down(appID); err != nil {
		slog.Warn("docker.down.failed", "app_id", appID, "error", err)
	}

	// Drop MySQL database and user
	if err := docker.DropDatabase(appID); err != nil {
		slog.Warn("mysql.drop.failed", "app_id", appID, "error", err)
	}

	// Clean up app filesystem
	baseDir := s.TemplateSetup.GetBasePath(appID)
	if err := os.RemoveAll(baseDir); err != nil {
		slog.Warn("app.delete.cleanup_failed", "app_id", appID, "error", err)
	}

	// Drop in-memory domain entries
	appDomainsMu.Lock()
	delete(appDomains, appID)
	appDomainsMu.Unlock()

	if err := s.DB.DeleteApp(appID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	slog.Info("app.deleted", "app_id", appID)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "deleted",
	})
}

func (s *Server) DeployApp(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]

	app, err := s.DB.GetApp(appID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if app == nil {
		writeError(w, http.StatusNotFound, "app not found")
		return
	}

	// Restart Docker containers
	if err := s.DockerManager.Restart(appID); err != nil {
		slog.Warn("docker.restart.failed", "app_id", appID, "error", err)
	}

	slog.Info("app.deployed", "app_id", appID)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "deployment triggered",
		"appId":   appID,
	})
}

// ResetApp hard-resets an app's git working tree to a known commit (or HEAD)
// and removes untracked files, then — unless restart=false — restarts the
// containers so the existing dependency re-sync path runs. Used by eval
// stateful-injection to reuse one pre-built app across trials: each trial
// starts from the same mid-build state instead of a fresh from-scratch app,
// removing the dominant per-trial build variance.
func (s *Server) ResetApp(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]

	// restart defaults to true; only an explicit false skips the container
	// restart (e.g. when the caller batches its own restart).
	body := struct {
		Commit  string `json:"commit"`
		Restart *bool  `json:"restart"`
	}{}
	// Body is optional: an empty body keeps the zero-value defaults. A present
	// but malformed body is a client error — fail loudly rather than silently
	// reset-to-HEAD (a commit typo must not pass as "no commit given").
	if r.ContentLength != 0 {
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
			return
		}
	}

	app, err := s.DB.GetApp(appID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if app == nil {
		writeError(w, http.StatusNotFound, "app not found")
		return
	}

	if err := s.TemplateSetup.ResetWorkspace(appID, body.Commit); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Report the actual restart outcome, not the intent: a failed restart
	// leaves stale node_modules relative to the reset package.json, so the
	// caller must be able to tell the reset is degraded.
	restartRequested := body.Restart == nil || *body.Restart
	restarted := false
	restartError := ""
	// ready tracks whether the preview is actually serving again after a
	// restart. `docker compose restart` returns as soon as the process
	// relaunches — before the dev server recompiles and rebinds its port — so
	// a restart that "succeeds" can still leave the app un-served. A trial that
	// runs against a not-yet-ready preview no-ops (the exact failure stateful
	// injection caused at n=7), so we gate on readiness the same way
	// provisioning does and report it. `ready` is only meaningful when a
	// restart was requested; it stays false otherwise.
	ready := false
	readyError := ""
	if restartRequested {
		if err := s.restartContainers(appID); err != nil {
			slog.Warn("docker.restart.failed", "app_id", appID, "error", err)
			restartError = err.Error()
		} else {
			restarted = true
			if err := s.awaitPreviewReady(app.PreviewPort); err != nil {
				slog.Warn("app.reset.preview_not_ready", "app_id", appID, "error", err)
				readyError = err.Error()
			} else {
				ready = true
			}
		}
	}

	slog.Info("app.reset", "app_id", appID, "commit", body.Commit, "restarted", restarted, "ready", ready)
	resp := map[string]any{
		"success":   true,
		"message":   "workspace reset",
		"appId":     appID,
		"restarted": restarted,
		"ready":     ready,
	}
	if restartError != "" {
		resp["restartError"] = restartError
	}
	if readyError != "" {
		resp["readyError"] = readyError
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) PublishApp(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]

	var body struct {
		GitHash string `json:"gitHash"`
	}
	if err := readJSON(r, &body); err != nil || body.GitHash == "" {
		body.GitHash = "local"
	}

	app, err := s.DB.GetApp(appID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if app == nil {
		writeError(w, http.StatusNotFound, "app not found")
		return
	}

	slog.Info("app.published", "app_id", appID, "git_hash", body.GitHash)

	job, err := s.DB.CreateJob(appID, "airo-app-publish")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.DB.UpdateJobStatus(job.ID, "running", ""); err != nil {
		slog.Error("job.status_update.failed", "job_id", job.ID, "error", err)
	}

	dep, err := s.DB.CreateDeployment(appID, job.ID, body.GitHash)
	deploymentID := fmt.Sprintf("deploy-%s", appID)
	if err != nil {
		slog.Error("deployment.create.failed", "app_id", appID, "error", err)
	} else if dep != nil {
		deploymentID = dep.ID
	}

	if err := s.copyPreviewConfigToPublish(appID); err != nil {
		slog.Error("app.publish.config_copy.failed", "app_id", appID, "error", err)
	}

	go s.completePublish(app, job.ID, dep)

	writeJSON(w, http.StatusOK, map[string]any{
		"statusJobId":    job.ID,
		"deploymentId":   deploymentID,
		"status":         "PENDING",
		"message":        "publish triggered",
		"subscriptionId": vars["subId"],
		"systemId":       vars["sysId"],
		"appId":          appID,
		"gitHash":        body.GitHash,
	})
}

// copyPreviewConfigToPublish copies preview config.json files to publish,
// ensuring the publish container has the same secrets as preview.
func (s *Server) copyPreviewConfigToPublish(appID string) error {
	if s.TemplateSetup == nil {
		return nil
	}

	base := s.TemplateSetup.GetBasePath(appID)
	src := filepath.Join(base, "local", "preview", "config.json")
	dst := filepath.Join(base, "local", "publish", "config.json")

	data, err := os.ReadFile(src)
	if err != nil {
		return fmt.Errorf("read %s: %w", src, err)
	}
	if err := os.WriteFile(dst, data, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", dst, err)
	}

	slog.Info("app.publish.config_copy.complete", "app_id", appID)
	return nil
}

func (s *Server) completePublish(app *store.App, jobID string, dep *store.Deployment) {
	if err := waitForPublishReady(app.PublishPort); err != nil {
		slog.Error("app.publish.wait_failed", "app_id", app.ID, "job_id", jobID, "error", err)
		if dep != nil {
			if updateErr := s.DB.UpdateDeploymentStatus(dep.ID, "failed"); updateErr != nil {
				slog.Error("deployment.status_update.failed", "deployment_id", dep.ID, "error", updateErr)
			}
		}
		if updateErr := s.DB.UpdateJobStatus(jobID, "failed", err.Error()); updateErr != nil {
			slog.Error("job.status_update.failed", "job_id", jobID, "error", updateErr)
		}
		return
	}

	updatedApp, err := s.DB.GetApp(app.ID)
	if err != nil {
		slog.Error("app.publish.reload_failed", "app_id", app.ID, "error", err)
		if dep != nil {
			if updateErr := s.DB.UpdateDeploymentStatus(dep.ID, "failed"); updateErr != nil {
				slog.Error("deployment.status_update.failed", "deployment_id", dep.ID, "error", updateErr)
			}
		}
		if updateErr := s.DB.UpdateJobStatus(jobID, "failed", err.Error()); updateErr != nil {
			slog.Error("job.status_update.failed", "job_id", jobID, "error", updateErr)
		}
		return
	}

	if updatedApp == nil {
		err = fmt.Errorf("app not found during publish completion")
		slog.Error("app.publish.reload_failed", "app_id", app.ID, "error", err)
		if dep != nil {
			if updateErr := s.DB.UpdateDeploymentStatus(dep.ID, "failed"); updateErr != nil {
				slog.Error("deployment.status_update.failed", "deployment_id", dep.ID, "error", updateErr)
			}
		}
		if updateErr := s.DB.UpdateJobStatus(jobID, "failed", err.Error()); updateErr != nil {
			slog.Error("job.status_update.failed", "job_id", jobID, "error", updateErr)
		}
		return
	}

	hasPublish := false
	for _, variant := range updatedApp.Variants {
		if variant == "publish" {
			hasPublish = true
			break
		}
	}

	if !hasPublish {
		newVariants := make([]string, 0, len(updatedApp.Variants)+1)
		newVariants = append(newVariants, updatedApp.Variants...)
		newVariants = append(newVariants, "publish")
		if _, err := s.DB.UpdateApp(app.ID, nil, nil, newVariants); err != nil {
			slog.Error("app.update_variants.failed", "app_id", app.ID, "error", err)
			if dep != nil {
				if updateErr := s.DB.UpdateDeploymentStatus(dep.ID, "failed"); updateErr != nil {
					slog.Error("deployment.status_update.failed", "deployment_id", dep.ID, "error", updateErr)
				}
			}
			if updateErr := s.DB.UpdateJobStatus(jobID, "failed", err.Error()); updateErr != nil {
				slog.Error("job.status_update.failed", "job_id", jobID, "error", updateErr)
			}
			return
		}
	}

	if dep != nil {
		if err := s.DB.UpdateDeploymentStatus(dep.ID, "deployed"); err != nil {
			slog.Error("deployment.status_update.failed", "deployment_id", dep.ID, "error", err)
		}
	}

	if err := s.DB.UpdateJobStatus(jobID, "completed", ""); err != nil {
		slog.Error("job.status_update.failed", "job_id", jobID, "error", err)
	}
}

func (s *Server) UnpublishApp(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]

	app, err := s.DB.GetApp(appID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if app == nil {
		writeError(w, http.StatusNotFound, "app not found")
		return
	}

	// Remove "publish" from variants
	filtered := make([]string, 0, len(app.Variants))
	found := false
	for _, v := range app.Variants {
		if v == "publish" {
			found = true
			continue
		}
		filtered = append(filtered, v)
	}

	if !found {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":   "no_publish_variant",
			"message": "App does not have an active publish variant",
		})
		return
	}

	if _, err := s.DB.UpdateApp(appID, nil, nil, filtered); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	slog.Info("app.unpublished", "app_id", appID)
	writeJSON(w, http.StatusOK, map[string]any{
		"message":        "App unpublished",
		"appId":          appID,
		"subscriptionId": vars["subId"],
		"systemId":       vars["sysId"],
	})
}

// provisionApp sets up the workspace, ports, and Docker containers for a new app.
func (s *Server) provisionApp(app *store.App) error {
	previewPort, publishPort, supervisorPort, publishSupervisorPort, err := s.DockerManager.AllocatePorts()
	if err != nil {
		return fmt.Errorf("allocate ports: %w", err)
	}

	if err := s.DB.UpdateAppPorts(app.ID, previewPort, publishPort, supervisorPort, publishSupervisorPort); err != nil {
		return fmt.Errorf("update ports: %w", err)
	}

	app.PreviewPort = previewPort
	app.PublishPort = publishPort
	app.SupervisorPort = supervisorPort
	app.PublishSupervisorPort = publishSupervisorPort

	dbName, dbUser, dbPassword, err := docker.ProvisionDatabase(app.ID)
	if err != nil {
		slog.Warn("mysql.provision.failed", "app_id", app.ID, "error", err)
	}

	dbCreds := &setup.DBCredentials{
		Name:     dbName,
		Username: dbUser,
		Password: dbPassword,
	}
	if err := s.TemplateSetup.Provision(app.ID, previewPort, publishPort, supervisorPort, dbCreds); err != nil {
		return fmt.Errorf("template setup: %w", err)
	}

	if err == nil {
		s.seedSystemSecrets(app.ID, dbCreds)
	}
	if err := s.registerWithAgent(app); err != nil {
		return fmt.Errorf("register with agent: %w", err)
	}

	if err := s.DockerManager.Up(app); err != nil {
		return fmt.Errorf("docker up: %w", err)
	}

	if err := waitForPreviewReady(app.PreviewPort); err != nil {
		return fmt.Errorf("wait for preview ready: %w", err)
	}

	activeStatus := "active"
	if _, err := s.DB.UpdateApp(app.ID, &activeStatus, nil, nil); err != nil {
		return fmt.Errorf("set app active: %w", err)
	}

	// Lifecycle transitions (provisioning → running) are deferred to Phase 4
	// when the upgrade orchestrator becomes the consumer of lifecycle_state.
	// Phase 1 leaves new apps at the SQL default 'running' since there's no
	// caller that distinguishes states yet. The UpdateAppLifecycleState setter
	// exists for Phase 4 to use.
	// TODO(phase-4): replace with real digest from build pipeline / docker inspect
	if err := s.DB.UpdateAppImageDigest(app.ID, "aab-template-v8:latest"); err != nil {
		slog.Warn("provision.image_digest.update_failed", "app_id", app.ID, "error", err)
	}

	return nil
}

func waitForPreviewReady(previewPort int) error {
	return waitForHTTPSReady(previewPort, "preview")
}

func waitForPublishReady(publishPort int) error {
	return waitForHTTPSReady(publishPort, "publish")
}

func waitForHTTPSReady(port int, variant string) error {
	if port <= 0 {
		return fmt.Errorf("%s port not allocated", variant)
	}

	healthURL := fmt.Sprintf("https://local.gasket.dev-godaddy.com:%d/airo/health", port)
	deadline := time.Now().Add(previewReadyTimeout)
	var lastErr error

	for time.Now().Before(deadline) {
		resp, err := previewReadyHTTPClient.Get(healthURL)
		if err == nil {
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices {
				return nil
			}
			lastErr = fmt.Errorf("unexpected status %d", resp.StatusCode)
		} else {
			lastErr = err
		}

		time.Sleep(previewReadyPollInterval)
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("%s health check timed out", variant)
	}

	return fmt.Errorf("%s at %s not ready: %w", variant, healthURL, lastErr)
}

func (s *Server) registerWithAgent(app *store.App) error {
	ctx, cancel := context.WithTimeout(context.Background(), registerOverallTimeout)
	defer cancel()

	agentsURL := agentsurl.Default()

	// EVAL_CUSTOMER_ID overrides the customer identity sent to the agents service
	// during registration. This may differ from the customer ID stored in the
	// control-plane's own SQLite (resolved via customerIDFromRequest). The divergence
	// is intentional: the agents-side record is what external APIs (e.g. logo generation)
	// use for entitlement checks, while the control-plane record is only used locally.
	customerID := strings.TrimSpace(os.Getenv("EVAL_CUSTOMER_ID"))
	if customerID == "" {
		customerID = store.DefaultCustomerID
	}

	payload := map[string]any{
		"siteId":     app.ID,
		"name":       fmt.Sprintf("App %s", app.ID),
		"appPath":    s.TemplateSetup.GetBasePath(app.ID) + "/preview",
		"port":       app.PreviewPort,
		"previewUrl": fmt.Sprintf("https://local.gasket.dev-godaddy.com:%d", app.PreviewPort),
		"customerId": customerID,
	}

	if app.SupervisorPort > 0 {
		payload["socketPath"] = fmt.Sprintf("tcp://localhost:%d", app.SupervisorPort)
	}
	if app.PublishSupervisorPort > 0 {
		payload["publishSupervisorPath"] = fmt.Sprintf("tcp://localhost:%d", app.PublishSupervisorPort)
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	client := &http.Client{Timeout: registerHTTPTimeout}
	var lastErr error

	for attempt := 1; attempt <= registerMaxAttempts; attempt++ {
		lastErr = s.attemptRegister(ctx, client, agentsURL+"/apps/register", body, app.ID)
		if lastErr == nil {
			slog.Info("agent.register.success", "app_id", app.ID, "attempt", attempt)
			return nil
		}

		if ctx.Err() != nil {
			return fmt.Errorf("agent registration canceled after %d attempts: %w", attempt, ctx.Err())
		}

		var connErr *connectionError
		if errors.As(lastErr, &connErr) {
			return lastErr
		}

		if attempt < registerMaxAttempts {
			delay := s.backoffRetryDelay(attempt)
			slog.Warn("agent.register.retrying", "app_id", app.ID, "attempt", attempt,
				"error", lastErr, "retry_in", delay)

			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return fmt.Errorf("agent registration canceled during backoff: %w", ctx.Err())
			}
		}
	}

	return fmt.Errorf("agent registration failed after %d attempts: %w", registerMaxAttempts, lastErr)
}

func (s *Server) backoffRetryDelay(attempt int) time.Duration {
	if s.retryDelay != nil {
		return s.retryDelay(attempt)
	}
	delay := registerBaseDelay * time.Duration(1<<(attempt-1))
	if delay > registerMaxDelay {
		delay = registerMaxDelay
	}
	return delay
}

type connectionError struct {
	err error
}

func (e *connectionError) Error() string { return e.err.Error() }
func (e *connectionError) Unwrap() error { return e.err }

func (s *Server) attemptRegister(ctx context.Context, client *http.Client, url string, body []byte, appID string) error {
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	if s.JWT != nil {
		token, err := s.JWT.Mint(appID)
		if err != nil {
			return fmt.Errorf("jwt mint: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := client.Do(req)
	if err != nil {
		var opErr *net.OpError
		if errors.As(err, &opErr) {
			return &connectionError{err: fmt.Errorf("connection failed (VPN? agents running?): %w", err)}
		}
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode == 401 {
		return fmt.Errorf("auth failed (HTTP 401) — verify JWKS_URL in agents/.env serves the matching public key")
	}

	if resp.StatusCode >= 300 {
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	return nil
}

// PutAppSSORequired handles the Phase-2 customer-facing per-app SSO toggle.
//
// `PUT /api/airo/v1/subscriptions/:subId/apps/:appId/sso-required`
//
// Mirrors airo-go's `PutSSORequiredCustomer` (`backends/airo-go/internal/
// presentation/http/handlers/app_handler_sso.go`):
//
//   - body: { ssoRequired: true | false | null } — tri-state. Missing key → 400.
//   - admin tier must be `'optional'` for the override to apply. If LCP's
//     `AAB_DEV_SUBSCRIPTION_POLICY` env is NOT `optional`/`optional_default_on`,
//     return 409 OVERRIDE_LOCKED with `configSsoRequired` describing the lock.
//   - on success, persist the new override into LCP env so subsequent app
//     GETs reflect it without a process restart.
//
// LCP's persistence is process-memory only (no SQLite column for per-app
// override). The override is propagated into a process-scoped env override
// keyed by appID so subsequent calls to `resolveSSOContext` see the new
// value. Restart → reverts to the env default.
func (s *Server) PutAppSSORequired(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	subID := vars["subId"]
	appID := vars["appId"]

	var body struct {
		// Encoded as `*bool`: nil for explicit JSON null, true/false otherwise.
		// We use a raw json.RawMessage to distinguish missing key from null
		// (Go's *bool decoder cannot tell those apart from an empty body).
		SSORequired json.RawMessage `json:"ssoRequired"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(body.SSORequired) == 0 {
		writeError(w, http.StatusBadRequest, "ssoRequired field is required")
		return
	}
	var requested *bool
	switch string(body.SSORequired) {
	case "true":
		t := true
		requested = &t
	case "false":
		f := false
		requested = &f
	case "null":
		requested = nil
	default:
		writeError(w, http.StatusBadRequest, "ssoRequired must be true, false, or null")
		return
	}

	// Admin-tier lock check. Mirrors airo-go's 409 OVERRIDE_LOCKED response
	// when admin has hard-locked SSO on/off and the customer tries to flip.
	currentCtx := resolveSSOContext()
	if !currentCtx.OverrideAllowed {
		slog.Warn("sso-required.toggle-rejected.locked",
			"app_id", appID, "sub_id", subID)
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":             "OVERRIDE_LOCKED",
			"configSsoRequired": adminTierForResponse(currentCtx),
		})
		return
	}

	// Persist override. LCP stores it as a process-env override keyed by
	// the AAB_DEV_SSO_OVERRIDE env so a follow-on resolveSSOContext sees
	// the new value. This is process-scoped — restart clears it. For
	// per-app overrides on multiple apps we'd need a real store column;
	// Phase 1 only exercises one ent app at a time.
	switch {
	case requested == nil:
		_ = os.Unsetenv("AAB_DEV_SSO_OVERRIDE")
	case *requested:
		_ = os.Setenv("AAB_DEV_SSO_OVERRIDE", "true")
	default:
		_ = os.Setenv("AAB_DEV_SSO_OVERRIDE", "false")
	}

	newCtx := resolveSSOContext()
	slog.Info("sso-required.toggle.success",
		"app_id", appID,
		"sub_id", subID,
		"sso_config_id", newCtx.ConfigID,
		"resolved", newCtx.Required,
	)
	writeJSON(w, http.StatusOK, map[string]any{
		"appId":               appID,
		"ssoConfigId":         newCtx.ConfigID,
		"ssoRequired":         newCtx.Required,
		"ssoRequiredOverride": newCtx.RequiredOverride,
		"ssoOverrideAllowed":  newCtx.OverrideAllowed,
	})
}

// adminTierForResponse describes the admin lock in the 409 OVERRIDE_LOCKED
// payload. AAB doesn't branch on this, but the airo-go contract surfaces it
// for admin debugging.
func adminTierForResponse(ctx SSOContext) string {
	switch {
	case ctx.OverrideAllowed:
		return "optional"
	case ctx.Required:
		return "true"
	default:
		return "false"
	}
}

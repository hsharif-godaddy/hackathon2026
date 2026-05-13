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

	"github.com/airo-ai-builder/local-control-plane/internal/docker"
	"github.com/airo-ai-builder/local-control-plane/internal/setup"
	"github.com/airo-ai-builder/local-control-plane/internal/store"
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

	resp := map[string]any{
		"id":                    app.ID,
		"subscriptionId":        app.SubscriptionID,
		"systemId":              app.SystemID,
		"status":                app.Status,
		"variables":             app.Variables,
		"variants":              app.Variants,
		"variantsWithLifecycle": variantsWithLifecycle,
		"appTemplateName":       "default",
		"createdAt":             app.CreatedAt,
		"updatedAt":             app.UpdatedAt,
		"cellId":                "local-dev",
		"compositionId":         "ai-builder",
		"system": map[string]any{
			"ownerProduct": "AiroAppBuilder",
			"productId":    store.DefaultProductID,
		},
	}

	urls := map[string]string{
		"agent":   "http://localhost:4000",
		"backend": "http://localhost:4000",
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

	return resp
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
		result = append(result, appToResponse(app))
	}

	writeJSON(w, http.StatusOK, map[string]any{"apps": result})
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

	app, err := s.DB.CreateApp(vars["subId"], vars["sysId"], body.Variables, body.Variants)
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

	agentsURL := os.Getenv("AGENTS_BASE_URL")
	if agentsURL == "" {
		agentsURL = "http://localhost:4000"
	}

	payload := map[string]any{
		"siteId":     app.ID,
		"name":       fmt.Sprintf("App %s", app.ID),
		"appPath":    s.TemplateSetup.GetBasePath(app.ID) + "/preview",
		"port":       app.PreviewPort,
		"previewUrl": fmt.Sprintf("https://local.gasket.dev-godaddy.com:%d", app.PreviewPort),
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

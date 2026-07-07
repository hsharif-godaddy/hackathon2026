package api

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/airo-ai-builder/local-control-plane/internal/agentsurl"
)

// automationResponse is the wire shape returned to callers, matching airo-go.
type automationResponse struct {
	ID           string `json:"id"`
	AppID        string `json:"appId"`
	Name         string `json:"name"`
	DefnType     string `json:"defnType"`
	DefnLocation string `json:"defnLocation"`
	DefnRef      string `json:"defnRef"`
	TriggerType  string `json:"triggerType"`
	CronExpr     string `json:"cronExpr"`
	Enabled      bool   `json:"enabled"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

// ListAutomations handles GET .../apps/{appId}/automations
func (s *Server) ListAutomations(w http.ResponseWriter, r *http.Request) {
	appID := mux.Vars(r)["appId"]

	automations, err := s.DB.ListAutomations(appID)
	if err != nil {
		slog.Error("automations.list", "app_id", appID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list automations")
		return
	}

	resp := make([]automationResponse, 0, len(automations))
	for _, a := range automations {
		resp = append(resp, automationResponse{
			ID: a.ID, AppID: a.AppID, Name: a.Name,
			DefnType: a.DefnType, DefnLocation: a.DefnLocation, DefnRef: a.DefnRef,
			TriggerType: a.TriggerType, CronExpr: a.CronExpr, Enabled: a.Enabled,
			CreatedAt: a.CreatedAt.Format("2006-01-02T15:04:05Z"),
			UpdatedAt: a.UpdatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"automations": resp})
}

// CreateAutomation handles POST .../apps/{appId}/automations
func (s *Server) CreateAutomation(w http.ResponseWriter, r *http.Request) {
	appID := mux.Vars(r)["appId"]

	var body struct {
		Name         string `json:"name"`
		DefnType     string `json:"defnType"`
		DefnLocation string `json:"defnLocation"`
		DefnRef      string `json:"defnRef"`
		TriggerType  string `json:"triggerType"`
		CronExpr     string `json:"cronExpr"`
		Enabled      *bool  `json:"enabled"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" || body.DefnRef == "" {
		writeError(w, http.StatusBadRequest, "name and defnRef are required")
		return
	}
	if body.TriggerType != "manual" && body.CronExpr == "" {
		writeError(w, http.StatusBadRequest, "cronExpr is required for cron automations")
		return
	}

	defnType := body.DefnType
	if defnType == "" {
		defnType = "file"
	}
	defnLocation := body.DefnLocation
	if defnLocation == "" {
		defnLocation = ".airo/jobs"
	}
	triggerType := body.TriggerType
	if triggerType == "" {
		triggerType = "cron"
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}

	a, err := s.DB.CreateAutomation(appID, body.Name, defnType, defnLocation, body.DefnRef, triggerType, body.CronExpr, enabled)
	if err != nil {
		slog.Error("automations.create", "app_id", appID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create automation")
		return
	}

	slog.Info("automations.created", "id", a.ID, "app_id", appID, "defn_ref", a.DefnRef, "cron_expr", a.CronExpr)
	writeJSON(w, http.StatusCreated, automationResponse{
		ID: a.ID, AppID: a.AppID, Name: a.Name,
		DefnType: a.DefnType, DefnLocation: a.DefnLocation, DefnRef: a.DefnRef,
		TriggerType: a.TriggerType, CronExpr: a.CronExpr, Enabled: a.Enabled,
		CreatedAt: a.CreatedAt.Format("2006-01-02T15:04:05Z"),
		UpdatedAt: a.UpdatedAt.Format("2006-01-02T15:04:05Z"),
	})
}

// UpdateAutomation handles PATCH .../apps/{appId}/automations/{automationId}
func (s *Server) UpdateAutomation(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]
	automationID := vars["automationId"]

	var body struct {
		TriggerType *string `json:"triggerType"`
		CronExpr    *string `json:"cronExpr"`
		Enabled     *bool   `json:"enabled"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	a, err := s.DB.UpdateAutomation(automationID, appID, body.TriggerType, body.CronExpr, body.Enabled)
	if err != nil {
		slog.Error("automations.update", "id", automationID, "app_id", appID, "error", err)
		writeError(w, http.StatusNotFound, "automation not found or update failed")
		return
	}

	slog.Info("automations.updated", "id", a.ID, "app_id", appID, "cron_expr", a.CronExpr, "enabled", a.Enabled)
	writeJSON(w, http.StatusOK, automationResponse{
		ID: a.ID, AppID: a.AppID, Name: a.Name,
		DefnType: a.DefnType, DefnLocation: a.DefnLocation, DefnRef: a.DefnRef,
		TriggerType: a.TriggerType, CronExpr: a.CronExpr, Enabled: a.Enabled,
		CreatedAt: a.CreatedAt.Format("2006-01-02T15:04:05Z"),
		UpdatedAt: a.UpdatedAt.Format("2006-01-02T15:04:05Z"),
	})
}

// ListAutomationRuns handles GET .../apps/{appId}/automations/{automationId}/runs
func (s *Server) ListAutomationRuns(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]
	automationID := vars["automationId"]

	limit := 50
	offset := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := fmt.Sscanf(v, "%d", &limit); n == 0 || err != nil {
			limit = 50
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := fmt.Sscanf(v, "%d", &offset); n == 0 || err != nil {
			offset = 0
		}
	}

	runs, total, err := s.DB.ListAutomationRuns(automationID, appID, limit, offset)
	if err != nil {
		slog.Error("automations.runs.list", "app_id", appID, "automation_id", automationID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list runs")
		return
	}

	type runResponse struct {
		ID              string  `json:"id"`
		Status          string  `json:"status"`
		TriggerType     string  `json:"triggerType"`
		SummaryRef      string  `json:"summaryRef,omitempty"`
		ErrorMessage    string  `json:"errorMessage,omitempty"`
		StartedAt       string  `json:"startedAt"`
		FinishedAt      *string `json:"finishedAt,omitempty"`
		DurationSeconds *int    `json:"durationSeconds,omitempty"`
	}

	resp := make([]runResponse, 0, len(runs))
	for _, r := range runs {
		rr := runResponse{
			ID:          r.ID,
			Status:      r.Status,
			TriggerType: r.TriggerType,
			SummaryRef:  r.SummaryRef,
			StartedAt:   r.StartedAt.Format(time.RFC3339),
		}
		if r.ErrorMessage != "" {
			rr.ErrorMessage = r.ErrorMessage
		}
		if r.FinishedAt != nil {
			s := r.FinishedAt.Format(time.RFC3339)
			rr.FinishedAt = &s
			dur := int(r.FinishedAt.Sub(r.StartedAt).Seconds())
			rr.DurationSeconds = &dur
		}
		resp = append(resp, rr)
	}

	writeJSON(w, http.StatusOK, map[string]any{"runs": resp, "total": total})
}

// TriggerAutomationRun handles POST .../apps/{appId}/automations/{automationId}/run
// Looks up the automation's defnRef from the local DB, generates a runId, then
// dispatches to the agent's POST /api/automations/run — same flow as production airo-go.
// The agent runs in AuthType.MOCK locally so no real JWT is needed; a dummy Bearer token is sufficient.
func (s *Server) TriggerAutomationRun(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]
	automationID := vars["automationId"]

	automation, err := s.DB.GetAutomation(automationID, appID)
	if err != nil {
		slog.Error("automations.trigger.not_found", "app_id", appID, "automation_id", automationID, "error", err)
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	runID := uuid.New().String()
	slog.Info("automations.trigger.dispatching", "app_id", appID, "automation_id", automationID, "run_id", runID, "defn_ref", automation.DefnRef)

	// Insert a run record immediately so the UI can show it as in-progress.
	if _, err := s.DB.CreateAutomationRun(runID, automationID, appID, "manual"); err != nil {
		slog.Warn("automations.trigger.run_record_failed", "run_id", runID, "error", err)
		// Non-fatal — continue with dispatch even if DB write fails.
	}

	// Mint a real JWT so the agent's JWT middleware can validate it.
	// Falls back to a dummy token if the JWT service is unavailable (e.g. no AWS creds).
	token := "local-dev-dispatch" //nolint:gosec // G101: not a credential, placeholder fallback token for local dev
	if s.JWT != nil {
		if t, err := s.JWT.Mint(appID); err == nil {
			token = t
		} else {
			slog.Warn("automations.trigger.jwt_mint_failed", "app_id", appID, "error", err)
		}
	}

	if err := dispatchAutomationRun(appID, runID, automation.DefnRef, token); err != nil {
		slog.Error("automations.trigger.dispatch_failed", "app_id", appID, "run_id", runID, "error", err)
		if updateErr := s.DB.UpdateAutomationRun(runID, "failed", "", err.Error()); updateErr != nil {
			slog.Warn("automations.trigger.run_record_cleanup_failed", "run_id", runID, "error", updateErr)
		}
		writeError(w, http.StatusBadGateway, fmt.Sprintf("failed to dispatch run to agent: %s", err))
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]any{"runId": runID})
}

// dispatchAutomationRun POSTs to the agent's /api/automations/run endpoint.
// token should be a JWT minted by JWTService.Mint — the agent validates it via JWKS.
func dispatchAutomationRun(appID, runID, defnRef, token string) error {
	payload, err := json.Marshal(map[string]any{
		"runId":          runID,
		"defnRef":        defnRef,
		"tokenBudget":    0,
		"timeoutSeconds": 300,
	})
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	agentURL := agentsurl.Default()
	url := agentURL + "/api/automations/run"

	// InsecureSkipVerify is intentional: the local agent uses a self-signed
	// dev cert (_.gasket.dev-godaddy.com) that cannot be verified by the
	// standard CA pool. This client is only reachable in local development.
	client := &http.Client{ //nolint:gosec
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{ //nolint:gosec
				InsecureSkipVerify: true, //nolint:gosec // nosemgrep: bypass-tls-verification,missing-ssl-minversion
				MinVersion:         tls.VersionTLS12,
			},
		},
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("agent returned %d: %s", resp.StatusCode, string(body))
	}

	slog.Info("automations.trigger.agent_accepted", "run_id", runID, "status", resp.StatusCode)
	return nil
}

// AgentCallback handles POST /api/hosting/v1/apps/{appId}/agent/callback —
// the agent posts run outcomes here after each automation execution.
func (s *Server) AgentCallback(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]

	var body struct {
		RunID      string `json:"runId"`
		Status     string `json:"status"`
		SummaryRef string `json:"summaryRef"`
		Error      string `json:"error"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}

	slog.Info("automations.agent_callback", "app_id", appID, "run_id", body.RunID, "status", body.Status)

	if body.RunID != "" {
		// Map agent callback status to airo-go wire shape
		status := body.Status
		switch status {
		case "succeeded":
			// keep
		case "failed", "cancelled":
			// keep
		default:
			status = "failed"
		}
		if err := s.DB.UpdateAutomationRun(body.RunID, status, body.SummaryRef, body.Error); err != nil {
			slog.Warn("automations.agent_callback.update_failed", "run_id", body.RunID, "error", err)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// DeleteAutomation handles DELETE .../apps/{appId}/automations/{automationId}
func (s *Server) DeleteAutomation(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]
	automationID := vars["automationId"]

	if err := s.DB.DeleteAutomation(automationID, appID); err != nil {
		slog.Error("automations.delete", "id", automationID, "app_id", appID, "error", err)
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	slog.Info("automations.deleted", "id", automationID, "app_id", appID)
	w.WriteHeader(http.StatusNoContent)
}

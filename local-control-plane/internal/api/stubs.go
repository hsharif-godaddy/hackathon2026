package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
	"github.com/gorilla/mux"
)

// injectedError holds a one-shot error for testing
var (
	injectedError   *int
	injectedErrorMu sync.Mutex
)

func jsonMarshal(v any) ([]byte, error) {
	return json.Marshal(v)
}

// checkInjectedError fires a one-shot injected error if set. Returns true if it wrote a response.
func checkInjectedError(w http.ResponseWriter) bool {
	injectedErrorMu.Lock()
	defer injectedErrorMu.Unlock()

	if injectedError == nil {
		return false
	}

	status := *injectedError
	injectedError = nil
	slog.Info("debug.error_fired", "status", status)
	writeError(w, status, fmt.Sprintf("injected error %d", status))
	return true
}

// InjectError sets up a one-shot error response for testing.
// POST /api/_debug/inject-error with {"status": 500}
func (s *Server) InjectError(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Status int `json:"status"`
	}
	if err := readJSON(r, &body); err != nil || body.Status == 0 {
		writeError(w, http.StatusBadRequest, "provide {\"status\": <http_status_code>}")
		return
	}

	injectedErrorMu.Lock()
	injectedError = &body.Status
	injectedErrorMu.Unlock()

	slog.Info("debug.error_injected", "status", body.Status)
	writeJSON(w, http.StatusOK, map[string]string{"message": "error injected"})
}

// ClearError removes any injected error.
func (s *Server) ClearError(w http.ResponseWriter, r *http.Request) {
	injectedErrorMu.Lock()
	injectedError = nil
	injectedErrorMu.Unlock()

	writeJSON(w, http.StatusOK, map[string]string{"message": "error cleared"})
}

// Domain stubs

func (s *Server) UpdateProjectDomain(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)

	var body struct {
		ProjectPrefix *string `json:"projectPrefix"`
	}
	readJSON(r, &body)

	writeJSON(w, http.StatusOK, map[string]any{
		"statusJobId":   fmt.Sprintf("domain-job-%s", vars["appId"]),
		"status":        "completed",
		"message":       "project domain updated (stub)",
		"projectPrefix": body.ProjectPrefix,
	})
}

func (s *Server) CheckDomainAvailability(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "project"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"available":     true,
		"mode":          mode,
		"projectPrefix": r.URL.Query().Get("projectPrefix"),
		"fqdn":          r.URL.Query().Get("fqdn"),
	})
}

func (s *Server) ModifyDomains(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"statusJobId": fmt.Sprintf("domain-job-%s", vars["appId"]),
		"status":      "completed",
		"message":     "domains modified (stub)",
	})
}

func (s *Server) GetDomainError(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, "no domain error found")
}

// Image status stubs

func (s *Server) GetImageStatus(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"appId":              vars["appId"],
		"compositionId":      "ai-builder",
		"compositionVersion": "v8",
		"unifiedVariantJob":  true,
		"status":             "current",
		"images":             []any{},
	})
}

func (s *Server) ReloadImages(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"appId":   vars["appId"],
		"status":  "current",
		"message": "images are current (local dev)",
	})
}

// Entitlement stubs

func (s *Server) UpdateEntitlement(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, subscriptionResponse())
}

func (s *Server) CreateBuilderPlan(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"subscriptionId":     vars["subId"],
		"plan":               "free",
		"builderEntitlementId": "local-entitlement-001",
		"message":            "builder plan created (stub)",
	})
}

// Credit/budget stubs

func (s *Server) GetCreditGrants(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"grants": []any{},
	})
}

func (s *Server) GetTokenBudget(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"userId": store.DefaultCustomerID,
		"spend":  0,
		"budget": map[string]any{
			"budgetId":       "local-budget-001",
			"budgetDuration": "monthly",
			"maxBudget":      999999,
		},
	})
}

// Export stubs

func (s *Server) GetExportsStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"eligibleForRefund": true,
		"lastExportedAt":    nil,
		"totalExports":      0,
	})
}

func (s *Server) RecordExport(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"id":             fmt.Sprintf("export-%s", vars["appId"]),
		"subscriptionId": vars["subId"],
		"appId":          vars["appId"],
		"exportedAt":     time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) GetAppExports(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"exports": []any{},
		"total":   0,
	})
}

// Deployment stubs

func (s *Server) GetDeployments(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]

	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}

	deps, err := s.DB.GetDeployments(appID, limit)
	if err != nil {
		deps = []store.Deployment{}
	}

	results := make([]map[string]any, len(deps))
	for i, dep := range deps {
		results[i] = map[string]any{
			"id":          dep.ID,
			"appId":       dep.AppID,
			"gitHash":     dep.GitHash,
			"variant":     dep.Variant,
			"status":      dep.Status,
			"statusJobId": dep.StatusJobID,
			"attempts":    dep.Attempts,
			"metadata":    map[string]any{},
			"createdAt":   dep.CreatedAt,
			"updatedAt":   dep.UpdatedAt,
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"appId":       appID,
		"deployments": results,
		"total":       len(results),
	})
}

// Transfer stubs

func (s *Server) InitiateTransfer(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	now := time.Now().UTC()
	writeJSON(w, http.StatusOK, map[string]any{
		"transferToken": "local-transfer-token",
		"appId":         vars["appId"],
		"status":        "pending",
		"createdAt":     now.Format(time.RFC3339),
		"expiresAt":     now.Add(72 * time.Hour).Format(time.RFC3339),
	})
}

func (s *Server) GetTransferMetadata(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, "no transfer found (stub)")
}

func (s *Server) GetTransferMetadataByToken(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, "no transfer found (stub)")
}

func (s *Server) CancelTransfer(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "cancelled",
		"appId":   vars["appId"],
		"message": "transfer cancelled (stub)",
	})
}

func (s *Server) AcceptTransfer(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"requestId":         "local-request-001",
		"status":            "completed",
		"hostingTransferId": nil,
		"message":           "transfer accepted (stub)",
		"appId":             "local-app",
	})
}

func (s *Server) ListTransfers(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"transfers": []any{},
		"total":     0,
		"limit":     20,
		"offset":    0,
	})
}

// CDN purge cache stubs

// Tracks when each purge job was created so GetJob can simulate a delay
var (
	purgeJobStartTimes   = map[string]time.Time{}
	purgeJobStartTimesMu sync.Mutex
)

const purgeSimulatedDuration = 6 * time.Second

func (s *Server) PurgeCache(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	jobID := fmt.Sprintf("purge-job-%s", vars["appId"])

	purgeJobStartTimesMu.Lock()
	purgeJobStartTimes[jobID] = time.Now().UTC()
	purgeJobStartTimesMu.Unlock()

	writeJSON(w, http.StatusAccepted, map[string]any{
		"statusJobId": jobID,
		"message":     "Cache purge started (stub)",
	})
}

func (s *Server) GetJob(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	jobID := vars["jobId"]
	now := time.Now().UTC()

	purgeJobStartTimesMu.Lock()
	startTime, tracked := purgeJobStartTimes[jobID]
	purgeJobStartTimesMu.Unlock()

	if !tracked {
		writeError(w, http.StatusNotFound, "job not found (stub)")
		return
	}

	status := "success"
	var completedAt *string
	if now.Sub(startTime) < purgeSimulatedDuration {
		status = "in_progress"
	} else {
		ts := now.Format(time.RFC3339)
		completedAt = &ts

		purgeJobStartTimesMu.Lock()
		delete(purgeJobStartTimes, jobID)
		purgeJobStartTimesMu.Unlock()
	}

	result := map[string]any{
		"id":        jobID,
		"jobType":   "airo-cdn-purge",
		"status":    status,
		"ownerType": "app",
		"createdAt": startTime.Format(time.RFC3339),
		"updatedAt": now.Format(time.RFC3339),
	}
	if completedAt != nil {
		result["completedAt"] = *completedAt
	}

	writeJSON(w, http.StatusOK, result)
}

// Attribute stubs

func (s *Server) GetAttribute(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, "attribute not found (stub)")
}

func (s *Server) CreateAttribute(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)

	var body struct {
		Key   string         `json:"key"`
		Value map[string]any `json:"value"`
	}
	readJSON(r, &body)

	now := time.Now().UTC().Format(time.RFC3339)
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":        "local-attr-001",
		"ownerType": vars["ownerType"],
		"ownerId":   vars["ownerId"],
		"key":       body.Key,
		"value":     body.Value,
		"createdAt": now,
		"updatedAt": now,
	})
}

func (s *Server) UpdateAttribute(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)

	var body struct {
		Value map[string]any `json:"value"`
	}
	readJSON(r, &body)

	now := time.Now().UTC().Format(time.RFC3339)
	writeJSON(w, http.StatusOK, map[string]any{
		"id":        vars["attributeId"],
		"ownerType": "user",
		"ownerId":   store.DefaultCustomerID,
		"key":       "unknown",
		"value":     body.Value,
		"createdAt": now,
		"updatedAt": now,
	})
}

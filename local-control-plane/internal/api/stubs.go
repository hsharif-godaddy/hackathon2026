package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
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
	_ = readJSON(r, &body)

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

// In-memory domain storage for local dev simulation.
var (
	appDomains   = map[string][]map[string]any{} // appId → []domain
	appDomainsMu sync.Mutex
)

// GetAppDomains returns the stored domains for an app (thread-safe).
func GetAppDomains(appID string) []map[string]any {
	appDomainsMu.Lock()
	defer appDomainsMu.Unlock()
	return appDomains[appID]
}

func (s *Server) ModifyDomains(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]

	var body struct {
		DomainsToCreate []struct {
			FQDN    string `json:"fqdn"`
			Primary bool   `json:"primary"`
		} `json:"domainsToCreate"`
		DomainsToDelete []struct {
			FQDN string `json:"fqdn"`
		} `json:"domainsToDelete"`
	}
	_ = readJSON(r, &body)

	appDomainsMu.Lock()
	now := time.Now().UTC().Format(time.RFC3339)
	for _, d := range body.DomainsToCreate {
		appDomains[appID] = append(appDomains[appID], map[string]any{
			"fqdn":                       d.FQDN,
			"isPrimary":                  d.Primary,
			"domainType":                 "fqdn",
			"prefix":                     "",
			"status":                     "pending",
			"anycastIp":                  "76.76.21.21",
			"certificateValidationCname": fmt.Sprintf("_acme-challenge.%s.dcv.airoapp.ai", d.FQDN),
			"createdAt":                  now,
			"updatedAt":                  now,
		})
		slog.Info("domain.created", "app_id", appID, "fqdn", d.FQDN)
	}
	for _, d := range body.DomainsToDelete {
		remaining := make([]map[string]any, 0)
		for _, existing := range appDomains[appID] {
			if existing["fqdn"] != d.FQDN {
				remaining = append(remaining, existing)
			}
		}
		appDomains[appID] = remaining
		slog.Info("domain.deleted", "app_id", appID, "fqdn", d.FQDN)
	}
	appDomainsMu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"statusJobId": fmt.Sprintf("domain-job-%s", appID),
		"status":      "completed",
		"message":     "domains modified (stub)",
	})
}

func (s *Server) GetDomainError(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, "no domain error found")
}

// Local dev simulation of GET .../domain-job (mgmt-airo). Cycles step labels then completes ~30s.
var (
	domainJobFirstSeen   = map[string]time.Time{}
	domainJobFirstSeenMu sync.Mutex
)

const (
	domainJobStubPhaseWindow = 7500 * time.Millisecond
	domainJobStubComplete    = 30 * time.Second
)

var domainJobStubPhases = []map[string]any{
	{"id": "mock-start", "label": "builder_domain_job_starting_connection", "status": "RUNNING"},
	{"id": "mock-dns", "label": "builder_domain_job_configuring_dns", "status": "RUNNING"},
	{"id": "mock-verify", "label": "builder_domain_job_verifying_domain", "status": "RUNNING"},
	{"id": "mock-connect", "label": "builder_domain_job_connecting_domain", "status": "RUNNING"},
}

func domainJobStubCacheKey(vars map[string]string, fqdn string) string {
	return fmt.Sprintf(
		"%s:%s:%s:%s",
		vars["subId"], vars["sysId"], vars["appId"],
		strings.ToLower(strings.TrimSpace(fqdn)),
	)
}

func (s *Server) GetDomainJob(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	fqdn := r.URL.Query().Get("fqdn")
	if strings.TrimSpace(fqdn) == "" {
		writeError(w, http.StatusBadRequest, "fqdn query parameter required")
		return
	}

	key := domainJobStubCacheKey(vars, fqdn)
	now := time.Now()

	domainJobFirstSeenMu.Lock()
	if _, ok := domainJobFirstSeen[key]; !ok {
		domainJobFirstSeen[key] = now
	}
	started := domainJobFirstSeen[key]
	domainJobFirstSeenMu.Unlock()

	elapsed := now.Sub(started)
	appID := vars["appId"]

	if elapsed >= domainJobStubComplete {
		writeJSON(w, http.StatusOK, map[string]any{
			"id":            fmt.Sprintf("mock-domain-job-%s", appID),
			"type":          "airo-modify-domains",
			"overallStatus": "SUCCESS",
			"dynamic": map[string]any{
				"current":         nil,
				"steps":           []any{},
				"stepDefinitions": []any{},
			},
		})
		return
	}

	idx := int(elapsed/domainJobStubPhaseWindow) % len(domainJobStubPhases)
	current := domainJobStubPhases[idx]

	writeJSON(w, http.StatusOK, map[string]any{
		"id":            fmt.Sprintf("mock-domain-job-%s", appID),
		"type":          "airo-modify-domains",
		"overallStatus": "RUNNING",
		"dynamic": map[string]any{
			"current":         current,
			"steps":           []any{},
			"stepDefinitions": []any{},
		},
	})
}

func (s *Server) GetDomainDnsOwnership(w http.ResponseWriter, r *http.Request) {
	fqdns := r.URL.Query().Get("fqdns")
	if strings.TrimSpace(fqdns) == "" {
		writeError(w, http.StatusBadRequest, "fqdns query parameter required")
		return
	}
	if strings.TrimSpace(r.URL.Query().Get("customerId")) == "" || strings.TrimSpace(r.URL.Query().Get("shopperId")) == "" {
		writeError(w, http.StatusBadRequest, "customerId and shopperId query parameters required")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"isGdDomain":             false,
		"isGDDomainOwner":        false,
		"isGoDaddyDns":           false,
		"pendingNsPropagation":   false,
		"domainCreatedAt":        nil,
		"zoneMatchedAt":          nil,
		"nameserverType":         "EXTERNAL",
		"nameservers":            []string{},
		"dnsApiResponseCode":     nil,
		"domainsApiResponseCode": nil,
	})
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
	vars := mux.Vars(r)
	subID := vars["subId"]
	custID := customerIDFromRequest(r)

	existing, err := s.DB.EnsureSubscription(subID, custID)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	var fields map[string]any
	if err := readJSON(r, &fields); err != nil {
		if errors.Is(err, io.EOF) {
			// No body - return current state
			writeJSON(w, http.StatusOK, subscriptionToResponse(existing))
			return
		}
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	sub, err := s.DB.UpdateSubscription(subID, fields)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, subscriptionToResponse(sub))
}

func (s *Server) CreateBuilderPlan(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	subID := vars["subId"]
	custID := customerIDFromRequest(r)

	sub, err := s.DB.EnsureSubscription(subID, custID)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"subscriptionId":       sub.ID,
		"plan":                 sub.Plan,
		"builderEntitlementId": "local-entitlement-001",
		"message":              "builder plan created (stub)",
	})
}

// Credit/budget stubs

func (s *Server) GetCreditGrants(w http.ResponseWriter, r *http.Request) {
	custID := customerIDFromRequest(r)
	vars := mux.Vars(r)
	now := time.Now().UTC()
	writeJSON(w, http.StatusOK, map[string]any{
		"grants": []map[string]any{
			{
				"id":              fmt.Sprintf("local-grant-%s", custID),
				"subscriptionId":  vars["subId"],
				"type":            "plan-monthly",
				"llmBudgetUserId": fmt.Sprintf("local-budget-user-%s", custID),
				"llmBudgetId":     fmt.Sprintf("local-budget-%s", custID),
				"creditsMax":      999999,
				"creditsSpent":    0,
				"isAvailable":     true,
				"useBefore":       now.AddDate(0, 1, 0).Format(time.RFC3339),
				"createdAt":       now.Format(time.RFC3339),
				"updatedAt":       now.Format(time.RFC3339),
			},
		},
	})
}

func (s *Server) GetTokenBudget(w http.ResponseWriter, r *http.Request) {
	custID := customerIDFromRequest(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"userId": custID,
		"spend":  0,
		"budget": map[string]any{
			"budgetId":       fmt.Sprintf("local-budget-%s", custID),
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

func mapDBJobStatusToAiro(status string) string {
	switch status {
	case "pending":
		return "queued"
	case "running":
		return "in_progress"
	case "completed":
		return "success"
	case "failed":
		return "failure"
	default:
		return "in_progress"
	}
}

func (s *Server) GetJob(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	jobID := vars["jobId"]
	now := time.Now().UTC()

	if s.DB != nil {
		job, err := s.DB.GetJob(jobID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if job != nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"id":        job.ID,
				"jobType":   job.JobType,
				"status":    mapDBJobStatusToAiro(job.Status),
				"ownerType": "app",
				"createdAt": job.CreatedAt.Format(time.RFC3339),
				"updatedAt": now.Format(time.RFC3339),
			})
			return
		}
	}

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
	_ = readJSON(r, &body)

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
	_ = readJSON(r, &body)

	now := time.Now().UTC().Format(time.RFC3339)
	writeJSON(w, http.StatusOK, map[string]any{
		"id":        vars["attributeId"],
		"ownerType": "user",
		"ownerId":   customerIDFromRequest(r),
		"key":       "unknown",
		"value":     body.Value,
		"createdAt": now,
		"updatedAt": now,
	})
}

// GetPIECustomer stubs the GoDaddy PIE customer proxy endpoint called by
// stripe-service to resolve prefill email for Stripe's claimable-sandbox
// create. Returns a static local-dev address for any customer ID — the
// email itself only appears in Stripe's sandbox prefill form and in the
// 7-day expiry reminder Stripe sends before deleting an unclaimed sandbox.
func (s *Server) GetPIECustomer(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	customerID := vars["customerId"]
	writeJSON(w, http.StatusOK, map[string]string{
		"customerId": customerID,
		"email":      "local-dev@airo.test",
	})
}

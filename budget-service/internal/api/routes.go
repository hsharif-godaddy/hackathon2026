// Package api: mux routes, JSON handlers, auth. Contract: docs/budget-service-spec.md.
package api

import (
	"net/http"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/auth"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/openapi"
	"github.com/gorilla/mux"
)

// NewRouter: /health open; /api/v1 uses authMW (IAM / Cert / Cert2S when auth enabled).
func NewRouter(s *Server, authMW *auth.Middleware) http.Handler {
	r := mux.NewRouter()
	r.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "resource not found")
	})
	r.MethodNotAllowedHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "method not allowed")
	})
	openapi.Mount(r)
	r.HandleFunc("/health", s.getHealth).Methods(http.MethodGet, http.MethodHead)

	v1 := r.PathPrefix("/api/v1").Subrouter()
	v1.Use(authMW.AuthenticateAWSIAMService)

	v1.HandleFunc("/auth-check", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"message": "IAM or Cert-class service JWT accepted",
		})
	}).Methods(http.MethodGet)

	v1.HandleFunc("/products", s.getProducts).Methods(http.MethodGet)
	v1.HandleFunc("/products", s.postProduct).Methods(http.MethodPost)
	v1.HandleFunc("/products/{productKey}", s.deleteProduct).Methods(http.MethodDelete)

	v1.HandleFunc("/webhooks/{webhookId}", s.getWebhook).Methods(http.MethodGet)
	v1.HandleFunc("/webhooks/{webhookId}", s.deleteWebhook).Methods(http.MethodDelete)
	v1.HandleFunc("/webhooks", s.getWebhooks).Methods(http.MethodGet)
	v1.HandleFunc("/webhooks", s.postWebhook).Methods(http.MethodPost)

	v1.HandleFunc("/sessions/{sessionId}/reports/{reportId}", s.getBudgetSessionReport).Methods(http.MethodGet)
	v1.HandleFunc("/sessions/{sessionId}/reports", s.postBudgetSessionReport).Methods(http.MethodPost)
	v1.HandleFunc("/sessions/{sessionId}", s.getBudgetSession).Methods(http.MethodGet)
	v1.HandleFunc("/sessions/{sessionId}", s.patchBudgetSession).Methods(http.MethodPatch)
	v1.HandleFunc("/sessions", s.postBudgetSession).Methods(http.MethodPost)
	// Future credit reimbursements (not implemented): POST /api/v1/budgets/{budgetId}/budget-items/{budgetItemId}/credit-reimbursements
	// Body: { "credits": "<decimal>", "reason": "..." } → inserts budget_item_credit_ledger entry_kind=reimbursement (negative credits_delta).

	v1.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.getBudgetItem).Methods(http.MethodGet)
	v1.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.patchBudgetItem).Methods(http.MethodPatch)
	v1.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.deleteBudgetItem).Methods(http.MethodDelete)
	v1.HandleFunc("/budgets/{budgetId}/budget-items", s.postBudgetItem).Methods(http.MethodPost)
	v1.HandleFunc("/budgets/{budgetId}", s.getBudget).Methods(http.MethodGet)
	v1.HandleFunc("/budgets/{budgetId}", s.patchBudget).Methods(http.MethodPatch)
	v1.HandleFunc("/budgets/{budgetId}", s.deleteBudget).Methods(http.MethodDelete)
	v1.HandleFunc("/budgets", s.postBudget).Methods(http.MethodPost)

	return LoggingMiddleware(r, s.LogRequestBodies)
}

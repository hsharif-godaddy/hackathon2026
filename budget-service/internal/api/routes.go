// Package api: mux routes, JSON handlers, auth. Contract: docs/budget-service-spec.md.
package api

import (
	"net/http"

	gdauth "github.com/gdcorp-identity/gd-auth-lib/go/gd_auth_lib"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/auth"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/openapi"
	"github.com/gorilla/mux"
)

// NewRouter wires routes: /health is open; /api/v1 uses authMW (IAM / Cert / Cert2S when auth enabled).
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
	v1.Use(RequireJSONContentType)

	// All v1 routes must be explicitly wrapped with serviceAuth or shopperOrServiceAuth.
	// We do not use v1.Use(authMW.AuthenticateAWSIAMService) because gorilla/mux applies
	// parent middleware to every subrouter handler, which would prevent per-route
	// auth differentiation (e.g. shopper-or-service on GET /budgets/{budgetId}).
	serviceAuth := mux.MiddlewareFunc(authMW.AuthenticateAWSIAMService)
	shopperOrServiceAuth := mux.MiddlewareFunc(authMW.AuthenticateShopperOrService)

	v1.Handle("/auth-check", shopperOrServiceAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := auth.GetClaims(r)
		if claims == nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"message": "none (auth disabled)",
			})
			return
		}
		tokenType := claims.GetType()
		body := map[string]any{
			"message":     tokenType + " token accepted",
			"tokenType":   tokenType,
			"tokenSource": auth.GetTokenSource(r),
		}
		// For shopper tokens, surface the `auth` claim (basic / e2s / s2s)
		// so callers can confirm which delegation path matched. Service
		// tokens (awsiam / cert) don't carry a meaningful `auth` value here.
		if tokenType == string(gdauth.AuthTypeIDP) {
			body["authType"] = claims.GetAuth()
		}
		writeJSON(w, http.StatusOK, body)
	}))).Methods(http.MethodGet)

	v1.Handle("/products", serviceAuth(http.HandlerFunc(s.getProducts))).Methods(http.MethodGet)
	v1.Handle("/products", serviceAuth(http.HandlerFunc(s.postProduct))).Methods(http.MethodPost)
	v1.Handle("/products/{productKey}", serviceAuth(http.HandlerFunc(s.deleteProduct))).Methods(http.MethodDelete)

	v1.Handle("/webhooks/{webhookId}", serviceAuth(http.HandlerFunc(s.getWebhook))).Methods(http.MethodGet)
	v1.Handle("/webhooks/{webhookId}", serviceAuth(http.HandlerFunc(s.deleteWebhook))).Methods(http.MethodDelete)
	v1.Handle("/webhooks", serviceAuth(http.HandlerFunc(s.getWebhooks))).Methods(http.MethodGet)
	v1.Handle("/webhooks", serviceAuth(http.HandlerFunc(s.postWebhook))).Methods(http.MethodPost)

	v1.Handle("/reports/aggregate", serviceAuth(http.HandlerFunc(s.getReportsAggregate))).Methods(http.MethodGet)
	v1.Handle("/reports", serviceAuth(http.HandlerFunc(s.getReports))).Methods(http.MethodGet)
	v1.Handle("/sessions/{sessionId}/reports/{reportId}", serviceAuth(http.HandlerFunc(s.getBudgetSessionReport))).Methods(http.MethodGet)
	v1.Handle("/sessions/{sessionId}/reports", serviceAuth(http.HandlerFunc(s.postBudgetSessionReport))).Methods(http.MethodPost)
	v1.Handle("/sessions/{sessionId}", serviceAuth(http.HandlerFunc(s.getBudgetSession))).Methods(http.MethodGet)
	v1.Handle("/sessions/{sessionId}", serviceAuth(http.HandlerFunc(s.patchBudgetSession))).Methods(http.MethodPatch)
	v1.Handle("/sessions", serviceAuth(http.HandlerFunc(s.postBudgetSession))).Methods(http.MethodPost)

	v1.Handle("/budgets/{budgetId}/budget-items/{budgetItemId}", serviceAuth(http.HandlerFunc(s.getBudgetItem))).Methods(http.MethodGet)
	v1.Handle("/budgets/{budgetId}/budget-items/{budgetItemId}", serviceAuth(http.HandlerFunc(s.patchBudgetItem))).Methods(http.MethodPatch)
	v1.Handle("/budgets/{budgetId}/budget-items/{budgetItemId}", serviceAuth(http.HandlerFunc(s.deleteBudgetItem))).Methods(http.MethodDelete)
	v1.Handle("/budgets/{budgetId}/budget-items", serviceAuth(http.HandlerFunc(s.postBudgetItem))).Methods(http.MethodPost)
	// GET /budgets/{budgetId} accepts a Shopper JWT in addition to service tokens.
	// PATCH and DELETE on the same path remain service-only.
	v1.Handle("/budgets/{budgetId}", shopperOrServiceAuth(http.HandlerFunc(s.getBudget))).Methods(http.MethodGet)
	v1.Handle("/budgets/{budgetId}", serviceAuth(http.HandlerFunc(s.patchBudget))).Methods(http.MethodPatch)
	v1.Handle("/budgets/{budgetId}", serviceAuth(http.HandlerFunc(s.deleteBudget))).Methods(http.MethodDelete)
	v1.Handle("/budgets", serviceAuth(http.HandlerFunc(s.postBudget))).Methods(http.MethodPost)

	return LoggingMiddleware(r, s.LogRequestBodies)
}

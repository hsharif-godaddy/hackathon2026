package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/auth"
	"github.com/airo-ai-builder/local-control-plane/internal/docker"
	"github.com/airo-ai-builder/local-control-plane/internal/setup"
	"github.com/airo-ai-builder/local-control-plane/internal/store"
	"github.com/gdcorp-golang/auth/gdtoken"
	"github.com/gorilla/mux"
)

type Server struct {
	DB            *store.DB
	DockerManager *docker.Manager
	TemplateSetup *setup.TemplateSetup
	JWT           *auth.JWTService

	// retryDelay returns how long to wait before the given attempt (1-indexed).
	// Defaults to exponential backoff (registerBaseDelay..registerMaxDelay).
	// Override in tests to eliminate real delays.
	retryDelay func(attempt int) time.Duration
}

func NewRouter(db *store.DB, jwtService *auth.JWTService, ssoMW *auth.SSOMiddleware) *mux.Router {
	srv := &Server{
		DB:            db,
		DockerManager: docker.NewManager(),
		TemplateSetup: setup.NewTemplateSetup(),
		JWT:           jwtService,
	}

	r := mux.NewRouter()

	// Error injection middleware (for debug testing)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if checkInjectedError(w) {
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	// Logging middleware
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			slog.Debug("request", "method", r.Method, "path", r.URL.Path)
			next.ServeHTTP(w, r)
		})
	})

	// Public endpoints registered before the authenticated subrouter so
	// gorilla/mux doesn't match the PathPrefix first. Signup uses optional
	// auth: an unauthenticated POST still works (and lands under
	// DefaultCustomerID), but if an SSO cookie is present the resulting app
	// is owned by the real shopper — matching production mgmt-airo, where
	// DPP redirects always carry a session.
	r.Handle("/api/airo/v1/signup", ssoMW.AuthenticateOptional(http.HandlerFunc(srv.Signup))).Methods("POST")
	r.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}).Methods("GET")

	v1 := r.PathPrefix("/api/airo/v1").Subrouter()
	v1.Use(ssoMW.Authenticate)

	// Customer
	v1.HandleFunc("/customers/me", srv.GetCustomer).Methods("GET")
	v1.HandleFunc("/customers/me/apps", srv.GetAllApps).Methods("GET")
	v1.HandleFunc("/customers/me/tree", srv.GetCustomerTree).Methods("GET")

	// Subscriptions
	v1.HandleFunc("/subscriptions", srv.ListSubscriptions).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}", srv.GetSubscription).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/entitlement", srv.GetEntitlement).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}", srv.UpdateSubscriptionHandler).Methods("PATCH")
	v1.HandleFunc("/subscriptions/{subId}/entitlement", srv.UpdateEntitlement).Methods("PUT")
	v1.HandleFunc("/subscriptions/{subId}/builder-plan", srv.CreateBuilderPlan).Methods("POST")
	v1.HandleFunc("/subscriptions/{subId}/credits/grants", srv.GetCreditGrants).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/token-budget", srv.GetTokenBudget).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/exports/status", srv.GetExportsStatus).Methods("GET")

	// Systems
	v1.HandleFunc("/subscriptions/{subId}/systems", srv.ListSystems).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/apps", srv.GetAppsForSubscription).Methods("GET")

	// Apps CRUD
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps", srv.ListApps).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps", srv.CreateApp).Methods("POST")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}", srv.GetApp).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}", srv.UpdateApp).Methods("PATCH")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}", srv.DeleteApp).Methods("DELETE")

	// App operations
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/deploy", srv.DeployApp).Methods("PUT")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/publish", srv.PublishApp).Methods("PUT")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/unpublish", srv.UnpublishApp).Methods("POST")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/secrets", srv.GetSecrets).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/secrets", srv.UpdateSecrets).Methods("POST")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/image-status", srv.GetImageStatus).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/archive-status", srv.GetArchiveStatus).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/restore", srv.ArchiveRestore).Methods("POST")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/reload", srv.ReloadImages).Methods("POST")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/exports", srv.RecordExport).Methods("POST")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/exports", srv.GetAppExports).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/deployments", srv.GetDeployments).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/project-domain", srv.UpdateProjectDomain).Methods("PUT")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/domain/check", srv.CheckDomainAvailability).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/domains", srv.ModifyDomains).Methods("PUT")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/domain-error", srv.GetDomainError).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/domain-job", srv.GetDomainJob).Methods("GET")
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/domain-dns-ownership", srv.GetDomainDnsOwnership).Methods("GET")

	// Jobs
	v1.HandleFunc("/jobs/{jobId}/apps", srv.GetJobApps).Methods("GET")
	v1.HandleFunc("/jobs/{jobId}", srv.GetJob).Methods("GET")

	// CDN purge cache
	v1.HandleFunc("/subscriptions/{subId}/systems/{sysId}/apps/{appId}/purge-cache", srv.PurgeCache).Methods("POST")

	// Transfers (stubs)
	v1.HandleFunc("/apps/{appId}/transfer/initiate", srv.InitiateTransfer).Methods("POST")
	v1.HandleFunc("/apps/{appId}/transfer/metadata", srv.GetTransferMetadata).Methods("GET")
	v1.HandleFunc("/apps/{appId}/transfer", srv.CancelTransfer).Methods("DELETE")
	v1.HandleFunc("/transfer/accept", srv.AcceptTransfer).Methods("POST")
	v1.HandleFunc("/transfer/metadata", srv.GetTransferMetadataByToken).Methods("GET")
	v1.HandleFunc("/transfer", srv.ListTransfers).Methods("GET")

	// Attributes (stubs)
	v1.HandleFunc("/attributes/{ownerType}/{ownerId}/{key}", srv.GetAttribute).Methods("GET")
	v1.HandleFunc("/attributes/{ownerType}/{ownerId}", srv.CreateAttribute).Methods("POST")
	v1.HandleFunc("/attributes/{attributeId}", srv.UpdateAttribute).Methods("PUT")

	// Debug endpoints for error injection
	r.HandleFunc("/api/_debug/inject-error", srv.InjectError).Methods("POST")
	r.HandleFunc("/api/_debug/clear-error", srv.ClearError).Methods("POST")

	return r
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	// Encode failures here only happen if the connection is broken; nothing useful to do.
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrSubscriptionNotOwned) {
		writeError(w, http.StatusForbidden, "Access denied: not subscription owner")
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

func readJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}

func customerIDFromRequest(r *http.Request) string {
	token, err := gdtoken.TokenFromContext(r.Context())
	if err == nil && token != nil {
		if id := token.GetShopperID(); id != "" {
			return id
		}
	}
	return store.DefaultCustomerID
}

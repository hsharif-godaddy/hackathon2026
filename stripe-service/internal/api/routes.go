// Package api wires HTTP routes and handlers for stripe-service.
package api

import (
	"net/http"

	"github.com/gorilla/mux"

	goauth "github.com/gdcorp-partners/airo-app-builder/packages/go-auth"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/awsclients"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/config"
	stripeclient "github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripe"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/webhook"
)

// Server holds handler dependencies.
type Server struct {
	Environment     string
	Version         string
	Prober          awsclients.Prober
	ResourceNames   config.ResourceNames
	Auth            *goauth.Middleware
	Stripe          stripeclient.Client
	Sandboxes       sandboxStore
	Events          eventStore
	WebhookVerifier *webhook.Verifier
}

// NewRouter returns the top-level http.Handler. /health and /v1/_probe are
// open diagnostic routes; /v1/* (non-probe) is agent-facing and requires an
// AWS IAM SSO token of kind awsiam.
func NewRouter(s *Server) http.Handler {
	r := mux.NewRouter()
	r.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "resource not found")
	})
	r.MethodNotAllowedHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "method not allowed")
	})
	r.HandleFunc("/health", s.getHealth).Methods(http.MethodGet, http.MethodHead)
	r.HandleFunc("/v1/_probe", s.getProbe).Methods(http.MethodGet)
	// Stripe webhook is intentionally public — Stripe authenticates via the
	// Stripe-Signature header, not gd-auth. Verification happens inside the
	// handler against the secret loaded from Secrets Manager at startup.
	r.HandleFunc("/webhooks/stripe", s.postStripeWebhook).Methods(http.MethodPost)

	awsiam := s.Auth.AuthenticateWithKind("awsiam")
	r.Handle("/v1/sandboxes", awsiam(http.HandlerFunc(s.postSandboxes))).Methods(http.MethodPost)
	r.Handle("/v1/status", awsiam(http.HandlerFunc(s.getStatus))).Methods(http.MethodGet)
	return r
}

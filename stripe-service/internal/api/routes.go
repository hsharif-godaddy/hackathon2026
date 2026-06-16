// Package api wires HTTP routes and handlers for stripe-service.
package api

import (
	"net/http"
	"sync"

	"github.com/gorilla/mux"

	goauth "github.com/gdcorp-partners/airo-app-builder/packages/go-auth"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/awsclients"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/config"
	stripeclient "github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripe"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/webhook"
)

// Server holds handler dependencies.
type Server struct {
	Environment   string
	Version       string
	Prober        awsclients.Prober
	ResourceNames config.ResourceNames
	Auth          *goauth.Middleware
	Stripe        stripeclient.Client
	Sandboxes     sandboxStore
	// Secrets is the outbound client to mhp-core's hosting service for
	// pushing Stripe-issued credentials into a customer app's alloc env
	// (POST /hosting/v1/apps/:appId/secrets). Always non-nil in production;
	// wired from buildHostingClient.
	Secrets secretsPusher
	// HostingProber exposes side-effect-free probes against the hosting
	// client so /v1/_probe can verify mhp-core auth + reachability. May be
	// nil in tests that don't exercise the probe; getProbe skips its steps
	// when nil.
	HostingProber   hostingProber
	Events          eventStore
	WebhookVerifier *webhook.Verifier
	// EventFetcher expands thin v2 event IDs into full payloads via GET
	// /v2/core/events/{id}. Nil when STRIPE_CLIENT=fake — dispatch handlers
	// log a warning and return early when it is nil.
	EventFetcher eventFetcher
	// CustomerEmailLookup resolves a GoDaddy customerId to the account email
	// via the PIE proxy endpoint on the mgmt-airo host. Used by postSandboxes
	// to populate Stripe's SandboxPrefill.Email server-side so no caller can
	// supply an arbitrary address. If nil or the lookup fails, postSandboxes
	// returns 400 MISSING_CUSTOMER_EMAIL — there is no fallback address.
	CustomerEmailLookup customerEmailLookup
	// LiveKeysInFlight tracks goroutines launched to mint+push live keys after
	// the webhook handler ACKs Stripe. Tests Wait() on it to deterministically
	// observe the side effects without racing; production can Wait() during
	// graceful shutdown so an in-flight mint isn't truncated mid-call.
	LiveKeysInFlight sync.WaitGroup
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

package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/hosting"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/store"
	stripeclient "github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripe"
)

// maxSandboxBody bounds how many bytes we'll read from a POST /v1/sandboxes
// request. The expected body is three small JSON fields (~100 bytes); 1 MiB
// is generous and rejects pathological inputs that would otherwise let an
// authenticated caller (or buggy client) exhaust process memory. Enforced
// via http.MaxBytesReader so an oversized payload surfaces as 413 instead
// of an OOM.
const maxSandboxBody = 1 << 20 // 1 MiB

// sandboxStore is the subset of store.Sandboxes the handlers depend on.
// Lets tests plug a fake without constructing a real *dynamodb.Client.
type sandboxStore interface {
	Put(ctx context.Context, s store.Sandbox) error
	QueryByAppID(ctx context.Context, appID string) ([]store.Sandbox, error)
	UpdateClaimStatus(ctx context.Context, sandboxID string, status store.ClaimStatus, liveAccountID string) error
	// GetBySandboxID is used by the owner-account-updated webhook handler to
	// resolve appID from sandboxID. The webhook envelope only carries the
	// sandbox ID; live-key provisioning needs appID to know which app's
	// alloc env to push the keys to via hosting.
	GetBySandboxID(ctx context.Context, sandboxID string) (store.Sandbox, error)
}

// secretsPusher is the subset of hosting.Client used by postSandboxes.
// Keeping it as an interface lets tests inject a fake without standing up a
// real HTTP server.
type secretsPusher interface {
	UpdateSecrets(ctx context.Context, appID string, ops []hosting.SecretOp) error
}

// customerEmailLookup resolves a GoDaddy customerId to the account email via
// the PIE proxy endpoint. Implemented by *hosting.Client; tests can provide a
// fake. A nil receiver or an error result causes postSandboxes to return 400
// MISSING_CUSTOMER_EMAIL — there is no fallback address.
type customerEmailLookup interface {
	GetCustomerEmail(ctx context.Context, customerID string) (string, error)
}

// prefillEmailFromPIE resolves the Stripe SandboxPrefill email for a given
// customerId by calling the GoDaddy PIE customer proxy on the mgmt-airo host.
// Returns an error (no fallback) if:
//   - customerId is empty — the caller must supply it; failing loud here
//     prevents a silent wrong-email rather than clobbering a real address.
//   - CustomerEmailLookup is nil — service misconfiguration.
//   - PIE returns a non-200, a network error, or an empty email field.
//
// The resolved email is intentionally NOT logged at INFO to avoid persisting
// PII in structured logs. Outcome and error context are logged without the
// email value itself.
func (s *Server) prefillEmailFromPIE(ctx context.Context, customerID string) (string, error) {
	customerID = strings.TrimSpace(customerID)

	slog.Info("stripe_service.sandboxes.prefill_email.start",
		"hasCustomerId", customerID != "",
		"hasLookupClient", s.CustomerEmailLookup != nil,
	)

	if customerID == "" {
		slog.Error("stripe_service.sandboxes.prefill_email.missing_customer_id")
		return "", fmt.Errorf("customerId is required to look up prefill email")
	}
	if s.CustomerEmailLookup == nil {
		slog.Error("stripe_service.sandboxes.prefill_email.lookup_not_configured",
			"customerId", customerID)
		return "", fmt.Errorf("customer email lookup is not configured (CustomerEmailLookup is nil)")
	}

	slog.Info("stripe_service.sandboxes.prefill_email.pie_lookup_start", "customerId", customerID)
	email, err := s.CustomerEmailLookup.GetCustomerEmail(ctx, customerID)
	if err != nil {
		slog.Error("stripe_service.sandboxes.prefill_email.pie_lookup_failed",
			"customerId", customerID, "error", err)
		return "", fmt.Errorf("PIE lookup failed for customer %s: %w", customerID, err)
	}

	email = strings.TrimSpace(email)
	if email == "" {
		slog.Error("stripe_service.sandboxes.prefill_email.pie_returned_empty",
			"customerId", customerID)
		return "", fmt.Errorf("PIE returned empty email for customer %s", customerID)
	}

	// Log success without the email value — email is PII.
	slog.Info("stripe_service.sandboxes.prefill_email.pie_lookup_success",
		"customerId", customerID, "hasEmail", true)
	return email, nil
}

// hostingProber is the subset of hosting.Client used by /v1/_probe. Kept
// separate from secretsPusher so the existing fakeSecretsPusher in
// sandboxes_test.go doesn't need to grow probe stubs.
type hostingProber interface {
	ProbeAuth(ctx context.Context) (string, error)
	ProbeReach(ctx context.Context) (int, string, error)
}

// boolPtr returns a *bool for the given value. Used to set Protected on
// payloads where the field uses *bool to distinguish "explicitly set" from
// "omitted" (the hosting schema treats omitted as false; we want explicit
// for the MCP-key op so the wire body is unambiguous).
func boolPtr(b bool) *bool { return &b }

// isValidCountryCode returns true for lowercase ISO-3166-1 alpha-2 codes
// (exactly 2 ASCII lowercase letters). Stripe requires lowercase alpha-2.
func isValidCountryCode(s string) bool {
	if len(s) != 2 {
		return false
	}
	return s[0] >= 'a' && s[0] <= 'z' && s[1] >= 'a' && s[1] <= 'z'
}

// buildSecretsOps constructs the bulk-secrets payload that hosting expects.
// Five ops:
//   - STRIPE_MCP_KEY: protected:true (delivered to agent task target only,
//     via the composition's protectedSecretsTargets — see ai-builder/v4
//     composition.json's "agent" entry → /local/config.json).
//   - STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY split into preview-variant
//     and publish-variant ops so go-live can later flip the publish ops to
//     *_live_* without ever putting live keys into the preview alloc.
//
// At sandbox-create time both variant ops carry the *_test_* values; the
// preview-never-sees-live invariant is enforced trivially here. The go-live
// webhook handler will use the same builder shape with publish-variant ops
// upgraded to *_live_*.
func buildSecretsOps(secretKey, publishableKey, mcpKey string) []hosting.SecretOp {
	return []hosting.SecretOp{
		{Type: hosting.SecretOpUpsert, Secret: hosting.SecretPayload{
			Name:          "STRIPE_MCP_KEY",
			Value:         mcpKey,
			Protected:     boolPtr(true),
			SystemManaged: false,
		}},
		{Type: hosting.SecretOpUpsert, Secret: hosting.SecretPayload{
			Name:          "STRIPE_SECRET_KEY",
			Value:         secretKey,
			Variants:      []string{"preview"},
			SystemManaged: false,
		}},
		{Type: hosting.SecretOpUpsert, Secret: hosting.SecretPayload{
			Name:          "STRIPE_SECRET_KEY",
			Value:         secretKey,
			Variants:      []string{"publish"},
			SystemManaged: false,
		}},
		{Type: hosting.SecretOpUpsert, Secret: hosting.SecretPayload{
			Name:          "STRIPE_PUBLISHABLE_KEY",
			Value:         publishableKey,
			Variants:      []string{"preview"},
			SystemManaged: false,
		}},
		{Type: hosting.SecretOpUpsert, Secret: hosting.SecretPayload{
			Name:          "STRIPE_PUBLISHABLE_KEY",
			Value:         publishableKey,
			Variants:      []string{"publish"},
			SystemManaged: false,
		}},
	}
}

// buildLiveSecretsOps constructs the bulk-secrets payload pushed at go-live.
// 5 ops:
//   - STRIPE_MCP_KEY delete: removes the sandbox ek_test_* key so the agent
//     loses MCP tool access in live mode. MCP is sandbox-only; live product
//     management goes through the Stripe dashboard directly.
//   - STRIPE_SECRET_KEY × {preview, publish}: sk_live_*
//   - STRIPE_PUBLISHABLE_KEY × {preview, publish}: pk_live_*
//
// Both preview and publish get the same live values. Reason: the BFF
// preview→publish secrets sync (fires on every "Publish app" click) only
// filters SystemManaged:true entries. Stripe keys are SystemManaged:false
// (required for the customer-app's #airo/secrets resolver), so any
// preview/publish drift would be auto-synced — clobbering publish's
// sk_live_* with preview's value on the next publish.
func buildLiveSecretsOps(liveSecretKey, livePublishableKey string) []hosting.SecretOp {
	ops := make([]hosting.SecretOp, 0, 5)
	// Remove the sandbox MCP key — MCP tools are sandbox-only. The agent
	// skill.md guides live-mode users to the Stripe dashboard for product
	// management instead.
	ops = append(ops, hosting.SecretOp{
		Type:   hosting.SecretOpDelete,
		Secret: hosting.SecretPayload{Name: "STRIPE_MCP_KEY", Protected: boolPtr(true)},
	})
	ops = append(ops,
		hosting.SecretOp{Type: hosting.SecretOpUpsert, Secret: hosting.SecretPayload{
			Name:          "STRIPE_SECRET_KEY",
			Value:         liveSecretKey,
			Variants:      []string{"preview"},
			SystemManaged: false,
		}},
		hosting.SecretOp{Type: hosting.SecretOpUpsert, Secret: hosting.SecretPayload{
			Name:          "STRIPE_SECRET_KEY",
			Value:         liveSecretKey,
			Variants:      []string{"publish"},
			SystemManaged: false,
		}},
		hosting.SecretOp{Type: hosting.SecretOpUpsert, Secret: hosting.SecretPayload{
			Name:          "STRIPE_PUBLISHABLE_KEY",
			Value:         livePublishableKey,
			Variants:      []string{"preview"},
			SystemManaged: false,
		}},
		hosting.SecretOp{Type: hosting.SecretOpUpsert, Secret: hosting.SecretPayload{
			Name:          "STRIPE_PUBLISHABLE_KEY",
			Value:         livePublishableKey,
			Variants:      []string{"publish"},
			SystemManaged: false,
		}},
	)
	return ops
}

type createSandboxRequest struct {
	AppID string `json:"appId"`
	// CustomerID is the GoDaddy customer ID of the authenticated caller,
	// forwarded from the agent's context.metadata.customerId. Used server-side
	// to look up the user's email from the GoDaddy PIE API for Stripe's
	// SandboxPrefill — never echoed to the caller or persisted.
	CustomerID string `json:"customerId,omitempty"`
	// Country is the ISO-3166-1 alpha-2 country code collected from the user
	// in chat (e.g. "US"). Safe to accept from the caller: it's harmless form
	// prefill for the Stripe-hosted claim flow with no notification vector.
	Country string `json:"country,omitempty"`
}

type sandboxResponse struct {
	SandboxID string `json:"sandboxId"`
	AccountID string `json:"accountId"`
	ClaimURL  string `json:"claimUrl"`
}

type statusResponse struct {
	SandboxID     string            `json:"sandboxId"`
	ClaimStatus   store.ClaimStatus `json:"claimStatus"`
	LiveAccountID string            `json:"liveAccountId,omitempty"`
}

// postSandboxes is idempotent on appId: if the app already has a sandbox it
// returns 200 with the existing one. Otherwise it calls the Stripe client to
// create one, pushes the Stripe-issued keys to hosting (the mhp-core control
// plane) so they reach the customer-app and agent task targets, persists
// metadata with ClaimStatus=provisioned, and returns 201.
//
// Push happens BEFORE the DDB Put: none of the Stripe-issued keys are copied
// into store.Sandbox — they're ephemeral in stripe-service and hosting is
// their only durable home. If we persisted the DDB row before the alloc
// secrets were live, the agent would see "sandbox ready" but have no
// STRIPE_MCP_KEY (and preview/publish would have no sk/pk). On push failure
// we return 502 without writing DDB and abandon the Stripe sandbox (cheap,
// pre-claim); the agent can retry stripe__setup.
func (s *Server) postSandboxes(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	r.Body = http.MaxBytesReader(w, r.Body, maxSandboxBody)
	var req createSandboxRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields() // catches e.g. "appID" (wrong case) vs "appId" at the boundary
	if err := dec.Decode(&req); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "request body exceeds size limit")
			return
		}
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	appID := strings.TrimSpace(req.AppID)
	if appID == "" {
		writeError(w, http.StatusBadRequest, "MISSING_APP_ID", "appId is required")
		return
	}

	// Validate country format server-side (the agent schema checks this but a
	// direct API caller bypasses it). Stripe requires lowercase ISO-3166-1 alpha-2.
	country := strings.ToLower(strings.TrimSpace(req.Country))
	if req.Country != "" && !isValidCountryCode(country) {
		writeError(w, http.StatusBadRequest, "INVALID_COUNTRY",
			"country must be an ISO-3166-1 alpha-2 code (e.g. 'US')")
		return
	}

	existing, err := s.Sandboxes.QueryByAppID(ctx, appID)
	if err != nil {
		slog.Error("stripe_service.sandboxes.query_failed", "appId", appID, "error", err)
		writeError(w, http.StatusInternalServerError, "STORE_QUERY_FAILED", "sandbox lookup failed")
		return
	}
	if len(existing) > 0 {
		// Idempotent: app already has a sandbox, return it. The incoming
		// customerId / country are not used to update the existing sandbox's
		// prefill — that would require a Stripe API we don't have yet.
		// A deliberate re-provision flow can land as a PATCH later.
		writeJSON(w, http.StatusOK, sandboxResponse{
			SandboxID: existing[0].SandboxID,
			AccountID: existing[0].AccountID,
			ClaimURL:  existing[0].ClaimURL,
		})
		return
	}

	// TODO(idempotency): this QueryByAppID → create → Put path is a
	// read-then-write over an eventually-consistent GSI. Two concurrent
	// POSTs for the same appId (agent retry + human-triggered retry) can
	// both see "no existing" and both reach Stripe, leaving one sandbox
	// orphaned and a nondeterministic winner in DDB. The right fix is
	// write-time uniqueness, not rate limiting: either (a) make sandbox_id
	// deterministic from appId + transaction, (b) add a separate
	// app_id-keyed item with a ConditionExpression("attribute_not_exists"),
	// or (c) use a TransactWriteItems that claims an app lock. Same code
	// path as the secrets push below.

	// Resolve the user's email from the PIE customer API using their customerId.
	// This is always server-side (never caller-supplied) — see prefillEmailFromPIE.
	slog.Info("stripe_service.sandboxes.resolving_prefill",
		"appId", appID,
		"hasCustomerId", strings.TrimSpace(req.CustomerID) != "",
		"hasCountry", strings.TrimSpace(req.Country) != "",
	)
	prefillEmail, prefillErr := s.prefillEmailFromPIE(ctx, req.CustomerID)
	if prefillErr != nil {
		if strings.TrimSpace(req.CustomerID) == "" {
			// Missing customerId is a caller error → 400.
			slog.Error("stripe_service.sandboxes.prefill_email_missing_customer_id",
				"appId", appID, "error", prefillErr)
			writeError(w, http.StatusBadRequest, "MISSING_CUSTOMER_EMAIL",
				"customerId is required")
		} else {
			// PIE unavailable / returned error → 502 (upstream dependency, not caller fault).
			slog.Error("stripe_service.sandboxes.prefill_email_lookup_failed",
				"appId", appID, "customerId", req.CustomerID, "error", prefillErr)
			writeError(w, http.StatusBadGateway, "CUSTOMER_EMAIL_LOOKUP_FAILED",
				"could not resolve customer email from identity service")
		}
		return
	}

	slog.Info("stripe_service.sandboxes.creating_stripe_sandbox",
		"appId", appID,
		"country", country,
	)
	sb, err := s.Stripe.CreateClaimableSandbox(ctx, stripeclient.CreateSandboxInput{
		AppID:          appID,
		PrefillEmail:   prefillEmail,
		PrefillCountry: country,
	})
	if err != nil {
		slog.Error("stripe_service.sandboxes.stripe_create_failed", "appId", appID, "error", err)
		writeError(w, http.StatusBadGateway, "STRIPE_CREATE_FAILED", "failed to create Stripe sandbox")
		return
	}

	// Push the Stripe-issued keys into the customer-app alloc env via the
	// mhp-core hosting service before writing the DDB row. The keys are
	// never stored in stripe-service — hosting is their only durable home.
	// If the push fails we return 502 and abandon the Stripe sandbox
	// (cheap, pre-claim); the agent can retry stripe__setup.
	//
	// s.Secrets is required: main.go always wires it via buildHostingClient
	// (which exits the process on construction failure), and tests that
	// reach this branch inject a fake. The previous silent-skip branch
	// when Secrets was nil was a foot-gun — a misconfigured Server would
	// have written a 201+DDB row with no keys, exactly the failure this
	// push is meant to prevent.
	ops := buildSecretsOps(sb.SecretKey, sb.PublishableKey, sb.MCPKey)
	if err := s.Secrets.UpdateSecrets(ctx, appID, ops); err != nil {
		slog.Error("stripe_service.sandboxes.secrets_push_failed",
			"appId", appID,
			"sandboxId", sb.SandboxID,
			"accountId", sb.AccountID,
			"error", err,
		)
		writeError(w, http.StatusBadGateway, "SECRETS_PUSH_FAILED", "failed to deliver keys to control plane")
		return
	}

	// sb.PublishableKey / sb.SecretKey / sb.MCPKey fall out of scope here —
	// they were never persisted in stripe-service.
	now := time.Now().UTC()
	persisted := store.Sandbox{
		SandboxID:   sb.SandboxID,
		AppID:       appID,
		AccountID:   sb.AccountID,
		ClaimURL:    sb.ClaimURL,
		ClaimStatus: store.ClaimStatusProvisioned,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.Sandboxes.Put(ctx, persisted); err != nil {
		slog.Error("stripe_service.sandboxes.put_failed", "appId", appID, "sandboxId", sb.SandboxID, "error", err)
		writeError(w, http.StatusInternalServerError, "STORE_PUT_FAILED", "failed to persist sandbox")
		return
	}

	writeJSON(w, http.StatusCreated, sandboxResponse{
		SandboxID: persisted.SandboxID,
		AccountID: persisted.AccountID,
		ClaimURL:  persisted.ClaimURL,
	})
}

// getStatus returns the claim state of the sandbox belonging to the app named
// by the appId query parameter. 404 when no sandbox exists for that app.
func (s *Server) getStatus(w http.ResponseWriter, r *http.Request) {
	appID := strings.TrimSpace(r.URL.Query().Get("appId"))
	if appID == "" {
		writeError(w, http.StatusBadRequest, "MISSING_APP_ID", "appId query parameter is required")
		return
	}
	sandboxes, err := s.Sandboxes.QueryByAppID(r.Context(), appID)
	if err != nil {
		slog.Error("stripe_service.status.query_failed", "appId", appID, "error", err)
		writeError(w, http.StatusInternalServerError, "STORE_QUERY_FAILED", "sandbox lookup failed")
		return
	}
	if len(sandboxes) == 0 {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "no sandbox for this appId")
		return
	}
	sb := sandboxes[0]
	writeJSON(w, http.StatusOK, statusResponse{
		SandboxID:     sb.SandboxID,
		ClaimStatus:   sb.ClaimStatus,
		LiveAccountID: sb.LiveAccountID,
	})
}

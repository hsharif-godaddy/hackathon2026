package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

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
}

type createSandboxRequest struct {
	AppID   string `json:"appId"`
	Email   string `json:"email"`
	Country string `json:"country"`
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
// returns 200 with the existing one, otherwise calls the Stripe client to
// create one, persists metadata with ClaimStatus=provisioned, and returns 201.
//
// TODO(mhp-airo): between Stripe create and the DDB PutItem below, push
// sb.SecretKey + sb.PublishableKey + sb.MCPKey to mhp-airo
// (PUT /apps/:appId/secrets + /reload) with retry+backoff on 5xx/network.
// Must succeed before the DDB write: none of the Stripe-issued keys are
// copied into store.Sandbox — they're ephemeral in stripe-service and
// mhp-airo is their only durable home. If we persist the DDB row before
// the alloc env is set up, the agent thinks the sandbox is ready but has
// no STRIPE_MCP_KEY (and preview/publish have no sk/pk). On exhaust,
// return error without writing DDB; abandon the Stripe sandbox (cheap,
// pre-claim) and let the agent retry stripe__setup.
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

	existing, err := s.Sandboxes.QueryByAppID(ctx, appID)
	if err != nil {
		slog.Error("stripe_service.sandboxes.query_failed", "appId", appID, "error", err)
		writeError(w, http.StatusInternalServerError, "STORE_QUERY_FAILED", "sandbox lookup failed")
		return
	}
	if len(existing) > 0 {
		// Idempotent: app already has a sandbox, return it. Note: the new
		// request's email / country are intentionally ignored here — the
		// existing sandbox's prefill is the source of truth, and updating
		// it mid-flight would require a Stripe API we don't have yet.
		// Once live, a deliberate "re-provision" flow can land as a PATCH.
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
	// or (c) use a TransactWriteItems that claims an app lock. Deferred
	// until the mhp-airo push lands — any of those fixes will touch the
	// same code path.

	sb, err := s.Stripe.CreateClaimableSandbox(ctx, stripeclient.CreateSandboxInput{
		AppID:   appID,
		Email:   req.Email,
		Country: req.Country,
	})
	if err != nil {
		slog.Error("stripe_service.sandboxes.stripe_create_failed", "appId", appID, "error", err)
		writeError(w, http.StatusBadGateway, "STRIPE_CREATE_FAILED", "failed to create Stripe sandbox")
		return
	}

	// sb.PublishableKey / sb.SecretKey / sb.MCPKey are intentionally NOT
	// copied into the persisted row — see TODO above. They fall out of
	// scope when this function returns.
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

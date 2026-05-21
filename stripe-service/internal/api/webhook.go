package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/store"
)

// eventStore is the narrow surface postStripeWebhook needs from store.Events.
// Tests inject a fakeEventStore that records calls and can be configured to
// return store.ErrEventExists or a generic error.
type eventStore interface {
	PutNew(ctx context.Context, eventID, eventType string, receivedAt time.Time) error
}

// eventFetcher expands a thin v2 event ID into its full JSON payload by calling
// GET /v2/core/events/{id}. Tests inject fakeEventFetcher; production wires
// *stripeapi.Client. When Server.EventFetcher is nil (STRIPE_CLIENT=fake) the
// dispatch handlers log a warning and return early.
type eventFetcher interface {
	FetchEvent(ctx context.Context, eventID string) ([]byte, error)
}

// maxWebhookBody bounds how many bytes we'll read from a webhook request.
// Stripe events are typically a few KB; 1 MB is a generous ceiling that
// still rejects pathological inputs (uploaders trying to OOM us). Enforced
// via http.MaxBytesReader, which fails the read with *http.MaxBytesError
// rather than silently truncating — so an oversized payload surfaces as
// 413 instead of a confusing 401 INVALID_SIGNATURE.
const maxWebhookBody = 1 << 20 // 1 MiB

// stripeWebhookEvent is the minimum we need to decode out of the Stripe
// envelope to dedupe. Per-event-type handlers parse the inner `data.object`
// themselves into the shape they need (see claimableSandboxEventEnvelope below).
type stripeWebhookEvent struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

// Event types we dispatch on. The full `v2.core.claimable_sandbox.*` event
// catalog is larger; we only handle what advances `claim_status` today.
const (
	eventTypeClaimableSandboxClaimed = "v2.core.claimable_sandbox.claimed"
	// eventTypeClaimableSandboxUpdated fires on state changes after claiming:
	// app_install_status transitions and the final "live" status when the user
	// installs the Stripe App and owner_details.account is populated.
	// Documented at https://docs.stripe.com/sandboxes/claimable-sandboxes
	eventTypeClaimableSandboxUpdated = "v2.core.claimable_sandbox.updated"
)

// claimableSandboxEventEnvelope decodes the full event payload returned by
// GET /v2/core/events/{id}. Stripe v2 fetched events use:
//   - related_object.id   → sandbox ID
//   - data.owner_details  → merchant's live acct_* (updated event)
//   - data.sandbox_details → fallback for owner acct_* (schema variant)
//
// data.object.* is retained as a fallback for stripe trigger test payloads
// which may use a different shape than live Stripe deliveries.
type claimableSandboxEventEnvelope struct {
	// RelatedObject carries the resource id for v2 full events fetched via
	// GET /v2/core/events/{id}. This is the primary sandbox ID source.
	RelatedObject *struct {
		ID string `json:"id"`
	} `json:"related_object"`
	Data struct {
		// OwnerDetails and SandboxDetails live directly under data in v2
		// fetched events (not nested under data.object as in v1 webhooks).
		OwnerDetails *struct {
			Account string `json:"account"`
		} `json:"owner_details"`
		SandboxDetails *struct {
			Account string `json:"account"`
		} `json:"sandbox_details"`
		// Object is the v1-style nesting; kept as fallback for stripe
		// trigger test payloads.
		Object struct {
			ID           string `json:"id"`
			OwnerDetails *struct {
				Account string `json:"account"`
			} `json:"owner_details"`
			SandboxDetails *struct {
				Account string `json:"account"`
			} `json:"sandbox_details"`
		} `json:"object"`
	} `json:"data"`
}

// resolveSandboxID returns the first non-empty sandbox id from the envelope,
// trying related_object.id (v2 full events) then data.object.id (fallback).
// The second return value names the field path used, for logging.
func (e *claimableSandboxEventEnvelope) resolveSandboxID() (id, source string) {
	if e.RelatedObject != nil && e.RelatedObject.ID != "" {
		return e.RelatedObject.ID, "related_object.id"
	}
	if e.Data.Object.ID != "" {
		return e.Data.Object.ID, "data.object.id"
	}
	return "", ""
}

// resolveOwnerAccount returns the first non-empty owner acct_* from the
// envelope, trying the four known field paths in preference order.
// The second return value names the field path used, for logging.
func (e *claimableSandboxEventEnvelope) resolveOwnerAccount() (account, source string) {
	if e.Data.OwnerDetails != nil && e.Data.OwnerDetails.Account != "" {
		return e.Data.OwnerDetails.Account, "data.owner_details.account"
	}
	if e.Data.SandboxDetails != nil && e.Data.SandboxDetails.Account != "" {
		return e.Data.SandboxDetails.Account, "data.sandbox_details.account"
	}
	if e.Data.Object.OwnerDetails != nil && e.Data.Object.OwnerDetails.Account != "" {
		return e.Data.Object.OwnerDetails.Account, "data.object.owner_details.account"
	}
	if e.Data.Object.SandboxDetails != nil && e.Data.Object.SandboxDetails.Account != "" {
		return e.Data.Object.SandboxDetails.Account, "data.object.sandbox_details.account"
	}
	return "", ""
}

// postStripeWebhook receives Stripe webhook deliveries. The route is public
// (no awsiam middleware): Stripe authenticates via the Stripe-Signature
// header, validated against the secret stored in AWS Secrets Manager and
// loaded at service startup.
//
// For event types that require the full payload (claimable_sandbox.*), the
// handler calls EventFetcher.FetchEvent BEFORE writing the dedup row. This
// ordering is deliberate: if FetchEvent fails transiently we return non-2xx
// so Stripe retries the delivery; the dedup row hasn't been written yet so
// the retry is processed normally. Fetching after the dedup row would
// permanently drop events on transient Stripe API failures.
func (s *Server) postStripeWebhook(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxWebhookBody)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "request body exceeds size limit")
			return
		}
		writeError(w, http.StatusBadRequest, "READ_FAILED", "failed to read request body")
		return
	}

	if err := s.WebhookVerifier.Verify(r.Header.Get("Stripe-Signature"), body); err != nil {
		// Warn (not error) — invalid-signature traffic is expected on the
		// public webhook URL (probes, replays, misconfigured senders).
		slog.Warn("stripe_service.webhook.bad_signature", "error", err)
		writeError(w, http.StatusUnauthorized, "INVALID_SIGNATURE", "signature verification failed")
		return
	}

	var event stripeWebhookEvent
	if err := json.Unmarshal(body, &event); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	if event.ID == "" || event.Type == "" {
		writeError(w, http.StatusBadRequest, "MISSING_EVENT_FIELDS", "event id and type are required")
		return
	}

	// For event types that need the full payload, fetch before the dedup row
	// so a transient FetchEvent failure doesn't permanently consume the event.
	var rawEvent []byte
	switch event.Type {
	case eventTypeClaimableSandboxClaimed, eventTypeClaimableSandboxUpdated:
		if s.EventFetcher != nil {
			rawEvent, err = s.EventFetcher.FetchEvent(r.Context(), event.ID)
			if err != nil {
				slog.Error("stripe_service.webhook.fetch_failed",
					"eventId", event.ID, "type", event.Type, "error", err)
				writeError(w, http.StatusBadGateway, "FETCH_FAILED", "failed to expand thin event")
				return
			}
		}
	}

	err = s.Events.PutNew(r.Context(), event.ID, event.Type, time.Now().UTC())
	switch {
	case errors.Is(err, store.ErrEventExists):
		// Idempotent path: Stripe retries on non-2xx, so the same event_id
		// arriving twice means we already handled it. ACK with 200.
		slog.Info("stripe_service.webhook.duplicate", "eventId", event.ID, "type", event.Type)
		writeJSON(w, http.StatusOK, map[string]string{"status": "duplicate"})
		return
	case err != nil:
		slog.Error("stripe_service.webhook.put_failed", "eventId", event.ID, "type", event.Type, "error", err)
		writeError(w, http.StatusInternalServerError, "STORE_PUT_FAILED", "failed to record event")
		return
	}

	slog.Info("stripe_service.webhook.received", "eventId", event.ID, "type", event.Type)

	// Type-dispatch. Errors inside handlers are logged but don't bubble up to
	// non-2xx — the dedup row is already committed, so a retry would skip
	// dispatch and leave us inconsistent. ACK and rely on alerting /
	// manual reconciliation when dispatch fails.
	switch event.Type {
	case eventTypeClaimableSandboxClaimed:
		s.handleClaimableSandboxClaimed(r.Context(), event.ID, rawEvent)
	case eventTypeClaimableSandboxUpdated:
		s.handleClaimableSandboxOwnerAccountUpdated(r.Context(), event.ID, rawEvent)
	default:
		// Unknown event type: nothing to do. Log at info so we can grep for
		// surprising types arriving on the public webhook URL.
		slog.Info("stripe_service.webhook.unhandled_type", "eventId", event.ID, "type", event.Type)
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "received"})
}

// handleClaimableSandboxClaimed advances claim_status from `provisioned` to
// `claimed` on the sandbox referenced by related_object.id. rawEvent is the
// full event payload already fetched by postStripeWebhook; nil means the
// fetcher was unavailable (STRIPE_CLIENT=fake). Logs and returns on any failure.
func (s *Server) handleClaimableSandboxClaimed(ctx context.Context, eventID string, rawEvent []byte) {
	if rawEvent == nil {
		slog.Warn("stripe_service.webhook.claimed.no_raw_event", "eventId", eventID)
		return
	}
	var env claimableSandboxEventEnvelope
	if err := json.Unmarshal(rawEvent, &env); err != nil {
		slog.Error("stripe_service.webhook.claimed.decode_failed",
			"eventId", eventID, "type", eventTypeClaimableSandboxClaimed, "error", err)
		return
	}
	sandboxID, sandboxIDSource := env.resolveSandboxID()
	slog.Debug("stripe_service.webhook.claimed.resolved",
		"eventId", eventID,
		"sandboxId", sandboxID,
		"sandboxIdSource", sandboxIDSource,
		"relatedObjectPresent", env.RelatedObject != nil,
		"dataObjectId", env.Data.Object.ID)
	if sandboxID == "" {
		slog.Error("stripe_service.webhook.claimed.missing_sandbox_id",
			"eventId", eventID, "type", eventTypeClaimableSandboxClaimed,
			"relatedObjectPresent", env.RelatedObject != nil,
			"dataObjectId", env.Data.Object.ID)
		return
	}
	if err := s.Sandboxes.UpdateClaimStatus(ctx, sandboxID, store.ClaimStatusClaimed, ""); err != nil {
		// ErrSandboxNotFound is expected for events that don't correspond to
		// any sandbox we provisioned (cross-account replay, test events from
		// the dashboard, race with a sandbox we abandoned). Log at warn —
		// not an error condition we can fix.
		if errors.Is(err, store.ErrSandboxNotFound) {
			slog.Warn("stripe_service.webhook.claimed.sandbox_not_found",
				"eventId", eventID, "sandboxId", sandboxID)
			return
		}
		slog.Error("stripe_service.webhook.claimed.update_failed",
			"eventId", eventID, "sandboxId", sandboxID, "error", err)
		return
	}
	slog.Info("stripe_service.webhook.claimed.dispatched",
		"eventId", eventID, "sandboxId", sandboxID, "sandboxIdSource", sandboxIDSource,
		"toStatus", store.ClaimStatusClaimed)
}

// handleClaimableSandboxOwnerAccountUpdated extracts the merchant's acct_*
// from rawEvent, advances claim_status to `live`, and records the live account
// on the sandbox row. rawEvent is the full payload already fetched by
// postStripeWebhook; nil means the fetcher was unavailable (STRIPE_CLIENT=fake).
func (s *Server) handleClaimableSandboxOwnerAccountUpdated(ctx context.Context, eventID string, rawEvent []byte) {
	if rawEvent == nil {
		slog.Warn("stripe_service.webhook.owner_account_updated.no_raw_event", "eventId", eventID)
		return
	}
	var env claimableSandboxEventEnvelope
	if err := json.Unmarshal(rawEvent, &env); err != nil {
		slog.Error("stripe_service.webhook.owner_account_updated.decode_failed",
			"eventId", eventID, "type", eventTypeClaimableSandboxUpdated, "error", err)
		return
	}
	sandboxID, sandboxIDSource := env.resolveSandboxID()
	ownerAccount, ownerAccountSource := env.resolveOwnerAccount()
	slog.Debug("stripe_service.webhook.owner_account_updated.resolved",
		"eventId", eventID,
		"sandboxId", sandboxID,
		"sandboxIdSource", sandboxIDSource,
		"ownerAccount", ownerAccount,
		"ownerAccountSource", ownerAccountSource,
		"relatedObjectPresent", env.RelatedObject != nil,
		"dataOwnerDetailsPresent", env.Data.OwnerDetails != nil,
		"dataSandboxDetailsPresent", env.Data.SandboxDetails != nil,
		"dataObjectId", env.Data.Object.ID)
	if sandboxID == "" {
		slog.Error("stripe_service.webhook.owner_account_updated.missing_sandbox_id",
			"eventId", eventID, "type", eventTypeClaimableSandboxUpdated,
			"relatedObjectPresent", env.RelatedObject != nil,
			"dataObjectId", env.Data.Object.ID)
		return
	}

	if ownerAccount == "" {
		// Neither field carried the account. Staying at `claimed` is safer
		// than advancing to `live` with an empty live_account_id: Stripe will
		// redeliver with a new event_id once the merchant progresses, so
		// staying put is recoverable. Advancing to `live` without an account
		// is not — the dedup row blocks any retry.
		slog.Warn("stripe_service.webhook.owner_account_updated.missing_owner_account",
			"eventId", eventID, "sandboxId", sandboxID,
			"dataOwnerDetailsPresent", env.Data.OwnerDetails != nil,
			"dataSandboxDetailsPresent", env.Data.SandboxDetails != nil,
			"dataObjectOwnerDetailsPresent", env.Data.Object.OwnerDetails != nil,
			"dataObjectSandboxDetailsPresent", env.Data.Object.SandboxDetails != nil)
		return
	}

	if err := s.Sandboxes.UpdateClaimStatus(ctx, sandboxID, store.ClaimStatusLive, ownerAccount); err != nil {
		if errors.Is(err, store.ErrSandboxNotFound) {
			slog.Warn("stripe_service.webhook.owner_account_updated.sandbox_not_found",
				"eventId", eventID, "sandboxId", sandboxID)
			return
		}
		slog.Error("stripe_service.webhook.owner_account_updated.update_failed",
			"eventId", eventID, "sandboxId", sandboxID, "error", err)
		return
	}
	slog.Info("stripe_service.webhook.owner_account_updated.dispatched",
		"eventId", eventID, "sandboxId", sandboxID, "sandboxIdSource", sandboxIDSource,
		"ownerAccount", ownerAccount, "ownerAccountSource", ownerAccountSource,
		"toStatus", store.ClaimStatusLive)
}

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

// maxWebhookBody bounds how many bytes we'll read from a webhook request.
// Stripe events are typically a few KB; 1 MB is a generous ceiling that
// still rejects pathological inputs (uploaders trying to OOM us). Enforced
// via http.MaxBytesReader, which fails the read with *http.MaxBytesError
// rather than silently truncating — so an oversized payload surfaces as
// 413 instead of a confusing 401 INVALID_SIGNATURE.
const maxWebhookBody = 1 << 20 // 1 MiB

// stripeWebhookEvent is the minimum we need to decode out of the Stripe
// envelope to dedupe. We deliberately don't decode the inner `data` here —
// per-event-type handlers (future PRs) parse what they need themselves.
type stripeWebhookEvent struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

// postStripeWebhook receives Stripe webhook deliveries. The route is public
// (no awsiam middleware): Stripe authenticates via the Stripe-Signature
// header, validated against the secret stored in AWS Secrets Manager and
// loaded at service startup.
//
// Today the handler does signature-verify + dedupe + 200/log only. Each
// event-type-specific business action (sandbox-claimed → DDB update;
// owner_account_updated → mint live keys + push to mhp-airo;
// api_key.rotated/expired → revoke) lands as its own follow-up PR.
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

	// Per-type handlers slot in here in follow-up PRs. For now we just log
	// and ACK — the dedupe row is already written.
	slog.Info("stripe_service.webhook.received", "eventId", event.ID, "type", event.Type)
	writeJSON(w, http.StatusOK, map[string]string{"status": "received"})
}

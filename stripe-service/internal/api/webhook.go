package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/store"
	stripeclient "github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripe"
)

// rawWebhookDiagnosticBytes bounds how many bytes of a webhook payload we'll
// dump in a single diagnostic log entry. Stripe v2 events are typically a
// few KB; 16 KiB leaves plenty of room for nested data while keeping a
// pathological response (or a future schema bloat) from blowing up logs.
const rawWebhookDiagnosticBytes = 16 * 1024

// logWebhookDiagnostic dumps the full raw event payload and an enumeration of
// top-level keys under `data`. Called from dispatch handlers when an expected
// field is missing (e.g. owner_account is empty on a `.updated` event after
// the merchant has installed the Stripe App). Useful for figuring out where
// Stripe is putting the data we expect — without this, we can only see the
// four field paths claimableSandboxEventEnvelope decodes, never the ones we
// haven't named yet. Bounded by rawWebhookDiagnosticBytes; never logged
// without a triggering condition.
func logWebhookDiagnostic(reason, eventID, eventType string, rawEvent []byte) {
	if rawEvent == nil {
		slog.Info("stripe_service.webhook.diagnostic.no_raw_event",
			"reason", reason, "eventId", eventID, "type", eventType)
		return
	}

	body := rawEvent
	truncated := false
	if len(body) > rawWebhookDiagnosticBytes {
		body = body[:rawWebhookDiagnosticBytes]
		truncated = true
	}
	slog.Info("stripe_service.webhook.diagnostic.raw_body",
		"reason", reason,
		"eventId", eventID,
		"type", eventType,
		"bytes", len(rawEvent),
		"truncated", truncated,
		"body", string(body),
	)

	// Enumerate top-level keys in `data` so a quick scan over multiple
	// events shows whether Stripe is shipping a field we haven't mapped
	// (e.g. data.live_account, data.account_id, data.sandbox.owner). The
	// envelope's typed decode silently drops anything outside its four
	// expected paths; this catches what the typed view misses.
	var generic struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rawEvent, &generic); err != nil {
		return
	}
	keys := make([]string, 0, len(generic.Data))
	for k := range generic.Data {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	slog.Info("stripe_service.webhook.diagnostic.data_keys",
		"reason", reason,
		"eventId", eventID,
		"type", eventType,
		"dataKeys", keys,
	)
}

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
// GET /v2/core/events/{id}. Stripe v2 .updated events ship state transitions
// under `changes.before` / `changes.after` with `data: {}` empty — observed
// against real test-mode deliveries with a merchant who completed the Airo
// Stripe App install (acct_* in changes.after.owner_details.account).
//
// Field-path preference (resolveOwnerAccount probes in this order):
//   - changes.after.owner_details.account  → primary, post-install
//   - data.owner_details.account            → legacy/alt schema
//   - data.sandbox_details.account          → legacy/alt schema
//   - data.object.{owner_details,sandbox_details}.account → trigger fixtures
type claimableSandboxEventEnvelope struct {
	// RelatedObject carries the resource id for v2 full events fetched via
	// GET /v2/core/events/{id}. This is the primary sandbox ID source.
	RelatedObject *struct {
		ID string `json:"id"`
	} `json:"related_object"`

	// Changes carries the v2 state-transition diff. We only read the
	// after-side: the relevant question is "what's the current state?",
	// not "what was it before?". changes.after.owner_details.account is
	// the merchant's live acct_* once they've installed the Airo Stripe
	// App; status transitions to "live" simultaneously.
	Changes *struct {
		After *struct {
			Status       string `json:"status"` // unclaimed|claimed|live
			OwnerDetails *struct {
				Account          string `json:"account"`            // merchant's live acct_*
				AppInstallStatus string `json:"app_install_status"` // pending_install|installed
			} `json:"owner_details"`
			SandboxDetails *struct {
				// Note: the sandbox's OWN acct_*, not the merchant's. Don't
				// pass this to apiKeys.create as stripeContext — it'd mint
				// keys against the sandbox account, not the merchant.
				Account string `json:"account"`
			} `json:"sandbox_details"`
		} `json:"after"`
	} `json:"changes"`

	Data struct {
		// OwnerDetails and SandboxDetails sat directly under data in earlier
		// drafts of the integration. Kept as fallbacks for schema variance
		// across API versions and for trigger-based test fixtures.
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

// resolveOwnerAccount returns the first non-empty merchant acct_* from the
// envelope, trying known field paths in preference order. The second return
// value names the field path used, for logging.
//
// Primary path is changes.after.owner_details.account — this is what real
// Stripe deliveries populate when the merchant completes the Airo App install
// in their live account (verified against test-mode webhook payloads). The
// data.* paths are fallbacks for trigger-based test fixtures and possible
// schema variance across API versions.
func (e *claimableSandboxEventEnvelope) resolveOwnerAccount() (account, source string) {
	if e.Changes != nil && e.Changes.After != nil {
		if od := e.Changes.After.OwnerDetails; od != nil && od.Account != "" {
			return od.Account, "changes.after.owner_details.account"
		}
	}
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

// afterStatus returns changes.after.status (unclaimed|claimed|live) from a v2
// .updated event envelope, or "" if the field isn't present. Used as a
// triage signal in logs — distinguishes "Stripe redelivered an early state
// transition we can't act on" from "this should have had owner_account".
func (e *claimableSandboxEventEnvelope) afterStatus() string {
	if e.Changes != nil && e.Changes.After != nil {
		return e.Changes.After.Status
	}
	return ""
}

// afterAppInstallStatus returns changes.after.owner_details.app_install_status
// (pending_install|installed) or "" if absent. Same triage purpose as
// afterStatus — pending_install events legitimately have a null
// owner_details.account; installed events should have it populated.
func (e *claimableSandboxEventEnvelope) afterAppInstallStatus() string {
	if e.Changes != nil && e.Changes.After != nil && e.Changes.After.OwnerDetails != nil {
		return e.Changes.After.OwnerDetails.AppInstallStatus
	}
	return ""
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
			// Breadcrumb: confirms the GET /v2/core/events/{id} round trip
			// succeeded and gives a size signal for triage. Helps distinguish
			// "Stripe returned an empty/sparse event" from "decode dropped
			// fields we expected" downstream.
			slog.Debug("stripe_service.webhook.fetched",
				"eventId", event.ID, "type", event.Type, "bytes", len(rawEvent))
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
	afterStatus := env.afterStatus()
	afterInstall := env.afterAppInstallStatus()
	slog.Debug("stripe_service.webhook.owner_account_updated.resolved",
		"eventId", eventID,
		"sandboxId", sandboxID,
		"sandboxIdSource", sandboxIDSource,
		"ownerAccount", ownerAccount,
		"ownerAccountSource", ownerAccountSource,
		"afterStatus", afterStatus,
		"afterAppInstallStatus", afterInstall,
		"relatedObjectPresent", env.RelatedObject != nil,
		"changesAfterPresent", env.Changes != nil && env.Changes.After != nil,
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
		// Empty owner_account is expected on intermediate state transitions:
		// the claim event itself (status: unclaimed → claimed,
		// app_install_status: pending_install) carries owner_details with
		// account=null. Stripe redelivers a fresh .updated event with a new
		// event_id once the merchant completes the App install (status →
		// live, app_install_status → installed, account populated). Staying
		// at `claimed` here is recoverable; advancing to `live` with an empty
		// live_account_id would not be — the dedup row blocks any retry.
		slog.Warn("stripe_service.webhook.owner_account_updated.missing_owner_account",
			"eventId", eventID, "sandboxId", sandboxID,
			"afterStatus", afterStatus,
			"afterAppInstallStatus", afterInstall,
			"changesAfterPresent", env.Changes != nil && env.Changes.After != nil,
			"dataOwnerDetailsPresent", env.Data.OwnerDetails != nil,
			"dataSandboxDetailsPresent", env.Data.SandboxDetails != nil,
			"dataObjectOwnerDetailsPresent", env.Data.Object.OwnerDetails != nil,
			"dataObjectSandboxDetailsPresent", env.Data.Object.SandboxDetails != nil)
		// Dump the raw payload + data keys ONLY when the state combination is
		// anomalous: afterStatus=live with no account is the case we can't
		// explain (schema variant we haven't mapped, or Stripe shipping
		// owner_account at a new path). Pre-install state transitions
		// (afterStatus=claimed, app_install_status=pending_install) are
		// expected normal flow per the comment above and don't warrant the
		// raw-body dump — at production scale that would be one 16 KiB INFO
		// log per sandbox claim.
		if afterStatus == string(store.ClaimStatusLive) {
			logWebhookDiagnostic("missing_owner_account_at_live", eventID, eventTypeClaimableSandboxUpdated, rawEvent)
		}
		return
	}

	// Defensive guard: ownerAccount populated alongside an explicit
	// afterStatus that is NOT "live" is an unexpected schema combination
	// today. Stripe ships ownerAccount on the post-install transition
	// (afterStatus=live, app_install_status=installed); any other explicit
	// status with a populated account is either a corrected re-install
	// transition or a future schema variant. Advancing claim_status=live on
	// those would burn the dedup row irrecoverably (see §6.4.1 of the
	// integration plan), so log + dump and return rather than commit.
	//
	// Empty afterStatus is the resolver-fallback case (account came from
	// data.owner_details or data.sandbox_details — older schema variants
	// that don't carry changes.after at all). We can't make a status-based
	// decision, so fall through to the original behavior. The matching
	// anomaly on the inverse side (afterStatus=live with empty account) is
	// covered by the diagnostic dump in the `ownerAccount == ""` branch above.
	if afterStatus != "" && afterStatus != string(store.ClaimStatusLive) {
		slog.Warn("stripe_service.webhook.owner_account_updated.unexpected_status_with_account",
			"eventId", eventID, "sandboxId", sandboxID,
			"ownerAccount", ownerAccount,
			"afterStatus", afterStatus,
			"afterAppInstallStatus", afterInstall)
		logWebhookDiagnostic("unexpected_status_with_account", eventID, eventTypeClaimableSandboxUpdated, rawEvent)
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
		"afterStatus", afterStatus, "afterAppInstallStatus", afterInstall,
		"toStatus", store.ClaimStatusLive)

	// Live-key provisioning runs asynchronously so the webhook handler can
	// ACK 200 to Stripe immediately. The chain — KMS GetPublicKey (cold
	// cache) + 3× apiKeys.create + 2× KMS Decrypt + hosting UpdateSecrets —
	// can collide with Stripe's ~30s webhook timeout under tail latency; a
	// timeout produces the same observable result as a 500 (Stripe retries,
	// dedup row at PutNew already blocks the redelivery, recovery falls to a
	// manual job). Detaching the work removes that failure mode entirely.
	//
	// We intentionally use context.Background() — the request ctx is canceled
	// when the handler returns, so reusing it would cancel the in-flight KMS
	// and Stripe calls. Failures inside the goroutine are logged loudly but
	// do NOT roll back the claim_status=live + liveAccountId update above:
	// the dedup row blocks any retry, so the right recovery is a separate
	// manual / scheduled-job operation that re-mints from the persisted
	// liveAccountId.
	s.LiveKeysInFlight.Add(1)
	go func() {
		defer s.LiveKeysInFlight.Done()
		s.provisionLiveKeys(context.Background(), eventID, sandboxID, ownerAccount)
	}()
}

// provisionLiveKeys mints live-mode credentials via apiKeys.create
// (×3: secret, publishable, mcp), JWE-decrypts the secret + MCP responses,
// and pushes the 3-op live payload to hosting (preview-variant ops are
// deliberately not touched — preview stays in test mode forever).
//
// All three pre-conditions for this path were validated upstream:
//   - sandboxID resolved from the webhook envelope's related_object.id
//   - ownerAccount resolved from changes.after.owner_details.account
//   - sandbox row was found in DDB and advanced to claim_status=live
//
// Errors are logged at error level. The caller has already returned 200
// to Stripe and accepted the event; redelivery won't re-trigger this path.
func (s *Server) provisionLiveKeys(ctx context.Context, eventID, sandboxID, ownerAccount string) {
	if s.Stripe == nil {
		slog.Error("stripe_service.webhook.live_keys.no_stripe_client",
			"eventId", eventID, "sandboxId", sandboxID)
		return
	}
	if s.Secrets == nil {
		slog.Error("stripe_service.webhook.live_keys.no_secrets_client",
			"eventId", eventID, "sandboxId", sandboxID)
		return
	}

	// Start breadcrumb. Failures inside MintLiveAPIKeys / UpdateSecrets
	// already log step-level detail; this anchors the trail at the
	// webhook side and gives a single grep target for "did live-key
	// provisioning kick off for this event".
	slog.Info("stripe_service.webhook.live_keys.start",
		"eventId", eventID,
		"sandboxId", sandboxID,
		"ownerAccount", ownerAccount,
	)

	// Look up appID from the sandbox row. The webhook envelope only
	// carries the sandbox ID; hosting's secrets endpoint is appId-keyed,
	// so we resolve the mapping from our own DDB.
	sandbox, err := s.Sandboxes.GetBySandboxID(ctx, sandboxID)
	if err != nil {
		slog.Error("stripe_service.webhook.live_keys.sandbox_lookup_failed",
			"eventId", eventID, "sandboxId", sandboxID, "error", err)
		return
	}
	if sandbox.AppID == "" {
		slog.Error("stripe_service.webhook.live_keys.empty_app_id",
			"eventId", eventID, "sandboxId", sandboxID)
		return
	}
	slog.Info("stripe_service.webhook.live_keys.sandbox_resolved",
		"eventId", eventID,
		"sandboxId", sandboxID,
		"appId", sandbox.AppID,
		"ownerAccount", ownerAccount,
	)

	// Mint live keys. The eventID becomes the Stripe idempotency key, so
	// a webhook redelivery (within Stripe's 24h window) collapses into the
	// same minted credentials. Outside that window, we'd get fresh keys —
	// which is actually what rotation looks like, so the behavior is
	// well-defined either way.
	keys, err := s.Stripe.MintLiveAPIKeys(ctx, stripeclient.MintLiveAPIKeysInput{
		OwnerAccount:   ownerAccount,
		IdempotencyKey: eventID,
	})
	if err != nil {
		slog.Error("stripe_service.webhook.live_keys.mint_failed",
			"eventId", eventID, "sandboxId", sandboxID, "appId", sandbox.AppID,
			"ownerAccount", ownerAccount, "error", err)
		return
	}

	// Breadcrumb between mint-success and push-start. Without this, a
	// hosting-side hang would leave the last log line as a mint-success
	// from inside real.go and the push step would be invisible. Logs
	// only key prefixes (length-bounded — "sk_live_") to confirm we
	// minted live (not test) values without leaking the full key.
	slog.Info("stripe_service.webhook.live_keys.minted",
		"eventId", eventID, "sandboxId", sandboxID, "appId", sandbox.AppID,
		"ownerAccount", ownerAccount,
		"secretPrefix", keyPrefix(keys.SecretKey),
		"publishablePrefix", keyPrefix(keys.PublishableKey),
		"mcpPrefix", keyPrefix(keys.MCPKey),
	)

	// Push the live keys via hosting. buildLiveSecretsOps always returns 5
	// ops: STRIPE_MCP_KEY is DELETED (MCP is sandbox-only — no agent MCP
	// access in live mode), and sk/pk are upserted to both preview and
	// publish variants. See buildLiveSecretsOps for the per-variant rationale.
	ops := buildLiveSecretsOps(keys.SecretKey, keys.PublishableKey)
	slog.Info("stripe_service.webhook.live_keys.push_started",
		"eventId", eventID, "appId", sandbox.AppID, "opsCount", len(ops))
	if err := s.Secrets.UpdateSecrets(ctx, sandbox.AppID, ops); err != nil {
		slog.Error("stripe_service.webhook.live_keys.push_failed",
			"eventId", eventID, "sandboxId", sandboxID, "appId", sandbox.AppID,
			"ownerAccount", ownerAccount, "error", err)
		return
	}

	slog.Info("stripe_service.webhook.live_keys.dispatched",
		"eventId", eventID, "sandboxId", sandboxID, "appId", sandbox.AppID,
		"ownerAccount", ownerAccount,
		"opsCount", len(ops),
		"secretPrefix", keyPrefix(keys.SecretKey),
		"publishablePrefix", keyPrefix(keys.PublishableKey),
		"mcpPrefix", keyPrefix(keys.MCPKey),
	)
}

// keyPrefix returns the leading sk_live_/pk_live_/ek_live_ slug of a
// minted key for log diagnostics — proves we minted live (not test)
// without ever leaking the full key. Truncates safely if the value is
// shorter than the expected prefix length. Returns "<empty>" rather
// than "" so an empty-key bug shows up in logs as a non-blank token.
func keyPrefix(key string) string {
	if key == "" {
		return "<empty>"
	}
	const n = 8 // length of sk_live_ / pk_live_ / ek_live_
	if len(key) <= n {
		return key
	}
	return key[:n]
}

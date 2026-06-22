// Package store wraps the DynamoDB access patterns stripe-service needs.
//
// The tables themselves are provisioned by AiroStripeServiceStack in
// cdk/lib/airo-stripe-service-stack.ts — this package assumes the CDK names
// and key schema. The sandboxes table is keyed on sandbox_id (PK) with a GSI
// on app_id (app_id-index, ALL projection).
package store

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// ErrSandboxNotFound is returned by Sandboxes.GetBySandboxID when the given
// sandbox_id is absent from DynamoDB.
var ErrSandboxNotFound = errors.New("store: sandbox not found")

// ClaimStatus tracks the lifecycle of a claimable sandbox as reported by
// Stripe webhooks. Values map 1:1 to the strings persisted in the
// claim_status DynamoDB attribute.
type ClaimStatus string

const (
	ClaimStatusProvisioned ClaimStatus = "provisioned"
	ClaimStatusClaimed     ClaimStatus = "claimed"
	ClaimStatusLive        ClaimStatus = "live"
	ClaimStatusRevoked     ClaimStatus = "revoked"
	// ClaimStatusLegacy marks an app that already had a Stripe integration via
	// the pre-stripe-v2 "paste your secret key" flow. These rows are written by
	// either the backfill job (cmd/backfill-legacy) for dormant apps or by the
	// agent skill itself when it processes a requestSecrets for STRIPE_SECRET_KEY
	// — never by a Stripe webhook, since Stripe doesn't know about these
	// accounts. The row is metadata-only and exists solely so postSandboxes can
	// refuse to provision over a working pasted key. Terminal: never advanced
	// by UpdateClaimStatus.
	ClaimStatusLegacy ClaimStatus = "legacy"
)

// LegacySandboxID builds the synthetic partition key for a legacy row. Legacy
// merchants never went through Stripe's claim flow, so there is no real
// sandbox_id — but sandbox_id is the table's partition key and cannot be
// empty. The `legacy#` prefix namespaces these synthetic keys so they can't
// collide with real Stripe sandbox IDs (cbsbx_*) and are trivially greppable.
// Exported so callers and test doubles share one source of truth for the
// namespace instead of hardcoding the prefix.
func LegacySandboxID(appID string) string {
	return "legacy#" + appID
}

// appIDIndex is the name of the GSI on app_id declared in the CDK stack.
const appIDIndex = "app_id-index"

// Sandbox is the persistence shape of a claimable sandbox. Distinct from
// stripe.Sandbox (protocol DTO) because this one carries lifecycle state
// (ClaimStatus, LiveAccountID, timestamps) that Stripe doesn't return, and
// intentionally omits Stripe-issued credentials — sk/pk/ek flow only
// through mhp-airo's alloc env, never this table.
//
// ExpiresAt is the sandbox's hard 60-day expiry. ClaimURLExpiresAt is the
// onboarding link's 7-day expiry, refreshed each time RenewOnboardingLink
// runs. Both are surfaced through GET /v1/status so the agent can warn
// the user proactively (and auto-renew the URL when it's near expiry).
type Sandbox struct {
	SandboxID         string
	AppID             string
	AccountID         string
	ClaimURL          string
	ClaimStatus       ClaimStatus
	LiveAccountID     string // empty until the merchant claims; omitted from the DynamoDB item while empty
	ExpiresAt         time.Time
	ClaimURLExpiresAt time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// DynamoDBAPI is the narrow slice of *dynamodb.Client that Sandboxes needs.
// Tests provide a fake implementation; production code passes the real client.
type DynamoDBAPI interface {
	PutItem(ctx context.Context, in *dynamodb.PutItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	Query(ctx context.Context, in *dynamodb.QueryInput, opts ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	UpdateItem(ctx context.Context, in *dynamodb.UpdateItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

// Sandboxes reads and writes the stripe_sandboxes DynamoDB table.
type Sandboxes struct {
	ddb   DynamoDBAPI
	table string
}

// NewSandboxes constructs a Sandboxes bound to the given client and table name.
// Table name is expected to come from config.ResourceNames().SandboxesTable.
func NewSandboxes(ddb DynamoDBAPI, table string) *Sandboxes {
	return &Sandboxes{ddb: ddb, table: table}
}

// Put writes s to the sandboxes table. Overwrites any existing item with the
// same sandbox_id. Rejects zero-value CreatedAt/UpdatedAt so a caller that
// forgets to set them doesn't silently persist "0001-01-01T00:00:00Z".
func (s *Sandboxes) Put(ctx context.Context, sb Sandbox) error {
	if sb.CreatedAt.IsZero() || sb.UpdatedAt.IsZero() {
		return fmt.Errorf("put sandbox %q: CreatedAt and UpdatedAt must be set", sb.SandboxID)
	}
	item := toItem(sb)
	if _, err := s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &s.table,
		Item:      item,
	}); err != nil {
		return fmt.Errorf("put sandbox %q: %w", sb.SandboxID, err)
	}
	return nil
}

// PutLegacy records a metadata-only row marking appID as a pre-stripe-v2
// ("paste your secret key") integration. Idempotent: overwrites any existing
// legacy row for the same app (same synthetic sandbox_id). The row carries no
// Stripe credentials, account ID, or claim URL — it exists only so
// postSandboxes can short-circuit and avoid clobbering a working pasted key.
//
// Deliberately does NOT guard against overwriting a real (provisioned/claimed/
// live) row: the synthetic `legacy#<appId>` key can't collide with a real
// cbsbx_* sandbox_id anyway, so a legacy row and a managed row for the same
// app are distinct items that coexist at the storage layer. At the API
// layer they are NOT equal: postSandboxes queries app_id-index and a legacy
// row always wins the short-circuit — the intended Phase 1 gate, biased toward
// never provisioning over a pasted key.
//
// Re-run note: this rewrites created_at on every call (full PutItem overwrite),
// so re-running the backfill or repeated agent self-marks for an already-
// recorded app reset the timestamp. Acceptable because the row is metadata-only
// and created_at feeds no audit or ordering query. If that changes, switch to
// an UpdateItem with created_at = if_not_exists(created_at, :now) to preserve
// first-write history.
func (s *Sandboxes) PutLegacy(ctx context.Context, appID string) error {
	now := time.Now().UTC()
	return s.Put(ctx, Sandbox{
		SandboxID:   LegacySandboxID(appID),
		AppID:       appID,
		ClaimStatus: ClaimStatusLegacy,
		CreatedAt:   now,
		UpdatedAt:   now,
	})
}

// GetBySandboxID fetches the sandbox with the given sandbox_id. Returns
// ErrSandboxNotFound when no such item exists.
func (s *Sandboxes) GetBySandboxID(ctx context.Context, sandboxID string) (Sandbox, error) {
	out, err := s.ddb.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &s.table,
		Key: map[string]types.AttributeValue{
			"sandbox_id": &types.AttributeValueMemberS{Value: sandboxID},
		},
	})
	if err != nil {
		return Sandbox{}, fmt.Errorf("get sandbox %q: %w", sandboxID, err)
	}
	if out.Item == nil {
		return Sandbox{}, ErrSandboxNotFound
	}
	return fromItem(out.Item), nil
}

// UpdateClaimStatus advances a sandbox's lifecycle state via a single
// DynamoDB UpdateItem with a monotonic-progression condition expression.
// Concurrent webhook events (e.g. claimed + owner_account_updated for the
// same sandbox) cannot clobber each other: the condition rejects any
// downgrade (live → claimed) and re-applying the same status is a no-op.
//
// Returns ErrSandboxNotFound when no row exists — a webhook event for an
// unknown sandbox is either a routing mistake or a stale replay; the caller
// logs and ACKs without retrying. A condition rejection caused by the
// monotonic guard returns nil (no-op), since the sandbox is already in a
// valid downstream state.
//
// liveAccountID is only persisted when non-empty; pass "" to leave it
// untouched. This lets the `claimed` handler advance status without
// overwriting a later-arriving owner_account, and lets the
// `owner_account_updated` handler set the field while relying on
// idempotency for the status.
func (s *Sandboxes) UpdateClaimStatus(ctx context.Context, sandboxID string, status ClaimStatus, liveAccountID string) error {
	allowed := allowedSourceStatuses(status)
	if len(allowed) == 0 {
		return fmt.Errorf("update sandbox %q: invalid target status %q", sandboxID, status)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	exprNames := map[string]string{
		"#cs": "claim_status",
		"#ua": "updated_at",
	}
	exprValues := map[string]types.AttributeValue{
		":s": &types.AttributeValueMemberS{Value: string(status)},
		":u": &types.AttributeValueMemberS{Value: now},
	}
	setExprs := []string{"#cs = :s", "#ua = :u"}
	if liveAccountID != "" {
		exprNames["#la"] = "live_account_id"
		exprValues[":l"] = &types.AttributeValueMemberS{Value: liveAccountID}
		setExprs = append(setExprs, "#la = :l")
	}

	placeholders := make([]string, 0, len(allowed))
	for i, src := range allowed {
		ph := fmt.Sprintf(":a%d", i)
		exprValues[ph] = &types.AttributeValueMemberS{Value: string(src)}
		placeholders = append(placeholders, ph)
	}

	updateExpr := "SET " + strings.Join(setExprs, ", ")
	condExpr := fmt.Sprintf("attribute_exists(sandbox_id) AND #cs IN (%s)", strings.Join(placeholders, ", "))

	_, err := s.ddb.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &s.table,
		Key: map[string]types.AttributeValue{
			"sandbox_id": &types.AttributeValueMemberS{Value: sandboxID},
		},
		UpdateExpression:          aws.String(updateExpr),
		ConditionExpression:       aws.String(condExpr),
		ExpressionAttributeNames:  exprNames,
		ExpressionAttributeValues: exprValues,
	})
	if err != nil {
		var ccf *types.ConditionalCheckFailedException
		if errors.As(err, &ccf) {
			// Discriminate "row missing" from "monotonic guard rejected".
			// The latter is a normal race outcome — the sandbox is already
			// at or past target — so callers ACK without retry.
			if _, getErr := s.GetBySandboxID(ctx, sandboxID); errors.Is(getErr, ErrSandboxNotFound) {
				return ErrSandboxNotFound
			} else if getErr != nil {
				slog.Warn("store.sandboxes.update_post_condition_get_failed",
					"sandbox_id", sandboxID, "error", getErr)
			} else {
				slog.Info("store.sandboxes.update_skipped_monotonic_guard",
					"sandbox_id", sandboxID, "target_status", string(status))
			}
			return nil
		}
		return fmt.Errorf("update sandbox %q: %w", sandboxID, err)
	}
	return nil
}

// allowedSourceStatuses returns the set of current claim_status values from
// which a transition to target is permitted. Lifecycle is monotonic —
// provisioned → claimed → live, with revoked as a terminal override.
// Idempotent re-application of the same status is always allowed (target
// is included in its own allowed-source set).
func allowedSourceStatuses(target ClaimStatus) []ClaimStatus {
	switch target {
	case ClaimStatusClaimed:
		return []ClaimStatus{ClaimStatusProvisioned, ClaimStatusClaimed}
	case ClaimStatusLive:
		return []ClaimStatus{ClaimStatusProvisioned, ClaimStatusClaimed, ClaimStatusLive}
	case ClaimStatusRevoked:
		return []ClaimStatus{ClaimStatusProvisioned, ClaimStatusClaimed, ClaimStatusLive, ClaimStatusRevoked}
	case ClaimStatusProvisioned:
		// Initial state — only set via Put, never via UpdateClaimStatus.
		return nil
	case ClaimStatusLegacy:
		// Terminal. Set only via PutLegacy (backfill or agent self-mark),
		// never reached by a webhook (Stripe doesn't emit events for these
		// accounts) and never a valid UpdateClaimStatus target. A future
		// upgrade that moves a legacy account onto the managed flow would
		// land via its own dedicated path, not through this monotonic-
		// progression helper.
		return nil
	default:
		return nil
	}
}

// UpdateClaimURL writes a refreshed onboarding URL and its new expiry
// onto an existing sandbox row. Used after a successful Stripe
// renew_onboarding_link call: the previous URL is invalidated by Stripe
// the moment the new one is issued, so persisting before any redirect
// matters.
//
// Returns ErrSandboxNotFound when the sandbox row is absent. Idempotent
// re-application of the same (claimURL, expiresAt) is a no-op overwrite
// — there's no claim_status guard here because the underlying URL/expiry
// can drift independently of lifecycle state (e.g. a user clicks an
// expired link after we already saw `claimed`, refreshing the link is
// still meaningful).
func (s *Sandboxes) UpdateClaimURL(ctx context.Context, sandboxID, claimURL string, expiresAt time.Time) error {
	if claimURL == "" {
		return fmt.Errorf("update sandbox %q: claimURL is required", sandboxID)
	}
	if expiresAt.IsZero() {
		return fmt.Errorf("update sandbox %q: expiresAt is required", sandboxID)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.ddb.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &s.table,
		Key: map[string]types.AttributeValue{
			"sandbox_id": &types.AttributeValueMemberS{Value: sandboxID},
		},
		UpdateExpression:    aws.String("SET #cu = :u, #ce = :e, #ua = :n"),
		ConditionExpression: aws.String("attribute_exists(sandbox_id)"),
		ExpressionAttributeNames: map[string]string{
			"#cu": "claim_url",
			"#ce": "claim_url_expires_at",
			"#ua": "updated_at",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":u": &types.AttributeValueMemberS{Value: claimURL},
			":e": &types.AttributeValueMemberS{Value: expiresAt.UTC().Format(time.RFC3339)},
			":n": &types.AttributeValueMemberS{Value: now},
		},
	})
	if err != nil {
		var ccf *types.ConditionalCheckFailedException
		if errors.As(err, &ccf) {
			return ErrSandboxNotFound
		}
		return fmt.Errorf("update claim url for %q: %w", sandboxID, err)
	}
	return nil
}

// QueryByAppID returns all sandboxes whose app_id attribute equals appID via
// the app_id-index GSI. Returns a nil slice (not an error) when no items match.
func (s *Sandboxes) QueryByAppID(ctx context.Context, appID string) ([]Sandbox, error) {
	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              &s.table,
		IndexName:              aws.String(appIDIndex),
		KeyConditionExpression: aws.String("app_id = :a"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":a": &types.AttributeValueMemberS{Value: appID},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("query sandboxes by app_id %q: %w", appID, err)
	}
	if len(out.Items) == 0 {
		return nil, nil
	}
	sandboxes := make([]Sandbox, 0, len(out.Items))
	for _, item := range out.Items {
		sandboxes = append(sandboxes, fromItem(item))
	}
	// TODO(multi-sandbox): if we ever support multiple sandboxes per app,
	// (a) sort by created_at DESC here so callers get the most recent, and
	// (b) follow LastEvaluatedKey to paginate — this Query currently takes
	// only the first page (<= 1MB), which is fine today because the
	// one-sandbox-per-app invariant caps the result at one item per appId.
	// Both changes land together in the same follow-up.
	return sandboxes, nil
}

// toItem converts a Sandbox to a DynamoDB attribute map. Attribute names are
// snake_case to match the CDK-declared partition key and GSI key.
//
// No credential attributes are written. publishable_key / secret_key /
// mcp_key all live in mhp-airo's alloc env and are never persisted here.
// See the Sandbox struct doc for the full rationale.
func toItem(s Sandbox) map[string]types.AttributeValue {
	item := map[string]types.AttributeValue{
		"sandbox_id":   &types.AttributeValueMemberS{Value: s.SandboxID},
		"app_id":       &types.AttributeValueMemberS{Value: s.AppID},
		"claim_status": &types.AttributeValueMemberS{Value: string(s.ClaimStatus)},
		"created_at":   &types.AttributeValueMemberS{Value: s.CreatedAt.UTC().Format(time.RFC3339)},
		"updated_at":   &types.AttributeValueMemberS{Value: s.UpdatedAt.UTC().Format(time.RFC3339)},
	}
	// account_id / claim_url / live_account_id are omitted while empty.
	// Normal sandbox rows always set account_id and claim_url at creation, so
	// this only affects metadata-only `legacy` rows (which carry none of them),
	// keeping those rows genuinely minimal. fromItem reads absent attributes as
	// "" so reads are unchanged. live_account_id is additionally meaningful when
	// absent: it distinguishes pre-claim from live (a post-live empty would be a
	// data bug, not a valid state).
	if s.AccountID != "" {
		item["account_id"] = &types.AttributeValueMemberS{Value: s.AccountID}
	}
	if s.ClaimURL != "" {
		item["claim_url"] = &types.AttributeValueMemberS{Value: s.ClaimURL}
	}
	if s.LiveAccountID != "" {
		item["live_account_id"] = &types.AttributeValueMemberS{Value: s.LiveAccountID}
	}
	// Omit expiry attributes while zero so a row written before this
	// schema landed doesn't acquire a misleading 1970-01-01 value on
	// the next UpdateClaimStatus round-trip. Backfill happens on the
	// next sandbox-create or refresh.
	if !s.ExpiresAt.IsZero() {
		item["expires_at"] = &types.AttributeValueMemberS{Value: s.ExpiresAt.UTC().Format(time.RFC3339)}
	}
	if !s.ClaimURLExpiresAt.IsZero() {
		item["claim_url_expires_at"] = &types.AttributeValueMemberS{Value: s.ClaimURLExpiresAt.UTC().Format(time.RFC3339)}
	}
	return item
}

// fromItem is the inverse of toItem. Missing or wrong-typed attributes leave
// their struct field zero-valued; timestamp parse errors are logged and the
// field zeroed so one bad row doesn't block an otherwise-valid read.
func fromItem(item map[string]types.AttributeValue) Sandbox {
	return Sandbox{
		SandboxID:         stringAttr(item, "sandbox_id"),
		AppID:             stringAttr(item, "app_id"),
		AccountID:         stringAttr(item, "account_id"),
		ClaimURL:          stringAttr(item, "claim_url"),
		ClaimStatus:       ClaimStatus(stringAttr(item, "claim_status")),
		LiveAccountID:     stringAttr(item, "live_account_id"),
		ExpiresAt:         timeAttr(item, "expires_at"),
		ClaimURLExpiresAt: timeAttr(item, "claim_url_expires_at"),
		CreatedAt:         timeAttr(item, "created_at"),
		UpdatedAt:         timeAttr(item, "updated_at"),
	}
}

func stringAttr(item map[string]types.AttributeValue, key string) string {
	v, ok := item[key].(*types.AttributeValueMemberS)
	if !ok {
		return ""
	}
	return v.Value
}

func timeAttr(item map[string]types.AttributeValue, key string) time.Time {
	s := stringAttr(item, key)
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		slog.Warn("store.sandboxes.time_parse_failed", "attr", key, "value", s, "error", err)
		return time.Time{}
	}
	return t
}

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
)

// appIDIndex is the name of the GSI on app_id declared in the CDK stack.
const appIDIndex = "app_id-index"

// Sandbox is the persistence shape of a claimable sandbox. Distinct from
// stripe.Sandbox (protocol DTO) because this one carries lifecycle state
// (ClaimStatus, LiveAccountID, timestamps) that Stripe doesn't return, and
// intentionally omits Stripe-issued credentials — sk/pk/ek flow only
// through mhp-airo's alloc env, never this table.
type Sandbox struct {
	SandboxID     string
	AppID         string
	AccountID     string
	ClaimURL      string
	ClaimStatus   ClaimStatus
	LiveAccountID string // empty until the merchant claims; omitted from the DynamoDB item while empty
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// DynamoDBAPI is the narrow slice of *dynamodb.Client that Sandboxes needs.
// Tests provide a fake implementation; production code passes the real client.
type DynamoDBAPI interface {
	PutItem(ctx context.Context, in *dynamodb.PutItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	Query(ctx context.Context, in *dynamodb.QueryInput, opts ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
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
		"account_id":   &types.AttributeValueMemberS{Value: s.AccountID},
		"claim_url":    &types.AttributeValueMemberS{Value: s.ClaimURL},
		"claim_status": &types.AttributeValueMemberS{Value: string(s.ClaimStatus)},
		"created_at":   &types.AttributeValueMemberS{Value: s.CreatedAt.UTC().Format(time.RFC3339)},
		"updated_at":   &types.AttributeValueMemberS{Value: s.UpdatedAt.UTC().Format(time.RFC3339)},
	}
	// Omit live_account_id while empty so readers can distinguish pre-claim
	// from live-but-empty (which shouldn't happen post-live but would otherwise
	// be indistinguishable from a data bug).
	if s.LiveAccountID != "" {
		item["live_account_id"] = &types.AttributeValueMemberS{Value: s.LiveAccountID}
	}
	return item
}

// fromItem is the inverse of toItem. Missing or wrong-typed attributes leave
// their struct field zero-valued; timestamp parse errors are logged and the
// field zeroed so one bad row doesn't block an otherwise-valid read.
func fromItem(item map[string]types.AttributeValue) Sandbox {
	return Sandbox{
		SandboxID:     stringAttr(item, "sandbox_id"),
		AppID:         stringAttr(item, "app_id"),
		AccountID:     stringAttr(item, "account_id"),
		ClaimURL:      stringAttr(item, "claim_url"),
		ClaimStatus:   ClaimStatus(stringAttr(item, "claim_status")),
		LiveAccountID: stringAttr(item, "live_account_id"),
		CreatedAt:     timeAttr(item, "created_at"),
		UpdatedAt:     timeAttr(item, "updated_at"),
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

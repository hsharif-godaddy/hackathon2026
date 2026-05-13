// Package store wraps the DynamoDB access patterns stripe-service needs.
// The tables themselves are provisioned by AiroStripeServiceStack in
// cdk/lib/airo-stripe-service-stack.ts — this package assumes the CDK names
// and key schema.
package store

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// ErrEventExists is returned by Events.PutNew when the conditional Put
// fails because event_id already exists. Callers branch on this with
// errors.Is to treat the request as a duplicate (idempotency).
var ErrEventExists = errors.New("store: event already exists")

// dynamoEventsAPI is the narrow slice of *dynamodb.Client that Events
// needs. Tests provide a fake; production code passes the real client.
//
// The unexported name and minimal surface (just PutItem) are deliberate:
// PR #3667 introduces an exported DynamoDBAPI in this package with a
// wider Put/Get/Query surface. Different name + scope here keeps both
// PRs mergeable in either order; a follow-up cleanup can collapse them.
type dynamoEventsAPI interface {
	PutItem(ctx context.Context, in *dynamodb.PutItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
}

// Events writes to the stripe_events DynamoDB table. The table is keyed
// on event_id (PK only) with a TTL attribute named "ttl" — the CDK
// (cdk/lib/airo-stripe-service-stack.ts) is the source of truth for both.
type Events struct {
	ddb   dynamoEventsAPI
	table string
}

// NewEvents constructs an Events bound to the given client and table.
// Table name comes from config.ResourceNames().EventsTable.
func NewEvents(ddb dynamoEventsAPI, table string) *Events {
	return &Events{ddb: ddb, table: table}
}

// eventTTL is how long a deduplication row lives. Stripe retains events
// for ~30 days, after which dedupe matters less because retries stop.
const eventTTL = 30 * 24 * time.Hour

// PutNew inserts a fresh event row. Atomic: returns ErrEventExists if
// event_id already exists in the table (i.e. we've seen this webhook
// before and processed it).
//
// receivedAt drives both the stored timestamp attribute and the TTL.
// In production callers pass time.Now().UTC(); tests pin a known value.
func (e *Events) PutNew(ctx context.Context, eventID, eventType string, receivedAt time.Time) error {
	ttlSeconds := receivedAt.Add(eventTTL).Unix()
	item := map[string]types.AttributeValue{
		"event_id":    &types.AttributeValueMemberS{Value: eventID},
		"event_type":  &types.AttributeValueMemberS{Value: eventType},
		"received_at": &types.AttributeValueMemberS{Value: receivedAt.UTC().Format(time.RFC3339)},
		"ttl":         &types.AttributeValueMemberN{Value: strconv.FormatInt(ttlSeconds, 10)},
	}

	_, err := e.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           &e.table,
		Item:                item,
		ConditionExpression: aws.String("attribute_not_exists(event_id)"),
	})
	if err != nil {
		var cce *types.ConditionalCheckFailedException
		if errors.As(err, &cce) {
			return ErrEventExists
		}
		return fmt.Errorf("put event %q: %w", eventID, err)
	}
	return nil
}

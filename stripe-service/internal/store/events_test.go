package store

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// fakeEventsDDB satisfies dynamoEventsAPI. Records the most recent input
// for assertions and returns whatever putErr is set to (nil for success).
type fakeEventsDDB struct {
	lastInput *dynamodb.PutItemInput
	putErr    error
}

func (f *fakeEventsDDB) PutItem(_ context.Context, in *dynamodb.PutItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error) {
	f.lastInput = in
	if f.putErr != nil {
		return nil, f.putErr
	}
	return &dynamodb.PutItemOutput{}, nil
}

func TestPutNew_FirstWriteSucceeds(t *testing.T) {
	ddb := &fakeEventsDDB{}
	e := NewEvents(ddb, "test-events")
	receivedAt := time.Date(2026, 5, 12, 10, 30, 0, 0, time.UTC)

	if err := e.PutNew(context.Background(), "evt_001", "claimable_sandbox.claimed", receivedAt); err != nil {
		t.Fatalf("PutNew: %v", err)
	}
	if ddb.lastInput == nil {
		t.Fatal("PutItem was not called")
	}
	if got := *ddb.lastInput.TableName; got != "test-events" {
		t.Errorf("TableName: want test-events, got %q", got)
	}

	// All four expected attributes present with correct values + types.
	stringAttr := func(key, want string) {
		v, ok := ddb.lastInput.Item[key].(*types.AttributeValueMemberS)
		if !ok {
			t.Errorf("attr %q: not a string attribute (or missing)", key)
			return
		}
		if v.Value != want {
			t.Errorf("attr %q: want %q, got %q", key, want, v.Value)
		}
	}
	stringAttr("event_id", "evt_001")
	stringAttr("event_type", "claimable_sandbox.claimed")
	stringAttr("received_at", "2026-05-12T10:30:00Z")

	ttl, ok := ddb.lastInput.Item["ttl"].(*types.AttributeValueMemberN)
	if !ok {
		t.Fatalf("attr ttl: not a number attribute")
	}
	if got, err := strconv.ParseInt(ttl.Value, 10, 64); err != nil {
		t.Errorf("ttl is not an integer: %v", err)
	} else if want := receivedAt.Add(eventTTL).Unix(); got != want {
		t.Errorf("ttl: want %d, got %d", want, got)
	}

	// Regression guard: the conditional gate is the whole reason this
	// method exists. If a refactor drops it the table would silently
	// allow re-processing of replayed events.
	if ddb.lastInput.ConditionExpression == nil ||
		!strings.Contains(*ddb.lastInput.ConditionExpression, "attribute_not_exists(event_id)") {
		t.Errorf("ConditionExpression: want attribute_not_exists(event_id), got %v", ddb.lastInput.ConditionExpression)
	}
}

func TestPutNew_TTLIs30DaysFromReceivedAt(t *testing.T) {
	ddb := &fakeEventsDDB{}
	e := NewEvents(ddb, "test-events")
	now := time.Now().UTC().Truncate(time.Second)

	if err := e.PutNew(context.Background(), "evt_002", "claimable_sandbox.claimed", now); err != nil {
		t.Fatalf("PutNew: %v", err)
	}

	ttl := ddb.lastInput.Item["ttl"].(*types.AttributeValueMemberN)
	got, _ := strconv.ParseInt(ttl.Value, 10, 64)
	want := now.Add(30 * 24 * time.Hour).Unix()
	if got != want {
		t.Errorf("ttl: want %d (now + 30d), got %d (delta %ds)", want, got, got-want)
	}
}

func TestPutNew_DuplicateReturnsErrEventExists(t *testing.T) {
	ddb := &fakeEventsDDB{
		// AWS SDK v2 surfaces the conditional check failure as this concrete
		// type. errors.As against it is what the production code does.
		putErr: &types.ConditionalCheckFailedException{},
	}
	e := NewEvents(ddb, "test-events")

	err := e.PutNew(context.Background(), "evt_003", "claimable_sandbox.claimed", time.Now())
	if !errors.Is(err, ErrEventExists) {
		t.Fatalf("PutNew on existing row: want errors.Is(err, ErrEventExists), got %v", err)
	}
}

func TestPutNew_GenericErrorIsWrapped(t *testing.T) {
	ddb := &fakeEventsDDB{putErr: errors.New("ddb is sad")}
	e := NewEvents(ddb, "test-events")

	err := e.PutNew(context.Background(), "evt_004", "claimable_sandbox.claimed", time.Now())
	if err == nil {
		t.Fatal("PutNew on generic error: want error, got nil")
	}
	if errors.Is(err, ErrEventExists) {
		t.Errorf("generic error should not be ErrEventExists; got %v", err)
	}
	if !strings.Contains(err.Error(), "evt_004") {
		t.Errorf("error should include the event id; got %q", err)
	}
	if !strings.Contains(err.Error(), "ddb is sad") {
		t.Errorf("error should wrap the underlying error; got %q", err)
	}
}

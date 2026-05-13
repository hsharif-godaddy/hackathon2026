package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// fakeDDB records inputs and returns canned outputs or errors. Zero value is
// a store containing no items; all operations return nil error and empty
// responses unless configured otherwise.
type fakeDDB struct {
	putInputs                []*dynamodb.PutItemInput
	getItems                 map[string]map[string]types.AttributeValue   // keyed by sandbox_id
	queryItems               map[string][]map[string]types.AttributeValue // keyed by app_id
	lastQuery                *dynamodb.QueryInput
	putErr, getErr, queryErr error
}

func (f *fakeDDB) PutItem(_ context.Context, in *dynamodb.PutItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error) {
	if f.putErr != nil {
		return nil, f.putErr
	}
	f.putInputs = append(f.putInputs, in)
	return &dynamodb.PutItemOutput{}, nil
}

func (f *fakeDDB) GetItem(_ context.Context, in *dynamodb.GetItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	idAttr, _ := in.Key["sandbox_id"].(*types.AttributeValueMemberS)
	if idAttr == nil {
		return &dynamodb.GetItemOutput{}, nil
	}
	item, ok := f.getItems[idAttr.Value]
	if !ok {
		return &dynamodb.GetItemOutput{}, nil
	}
	return &dynamodb.GetItemOutput{Item: item}, nil
}

func (f *fakeDDB) Query(_ context.Context, in *dynamodb.QueryInput, _ ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error) {
	f.lastQuery = in
	if f.queryErr != nil {
		return nil, f.queryErr
	}
	appAttr, _ := in.ExpressionAttributeValues[":a"].(*types.AttributeValueMemberS)
	if appAttr == nil {
		return &dynamodb.QueryOutput{}, nil
	}
	return &dynamodb.QueryOutput{Items: f.queryItems[appAttr.Value]}, nil
}

func TestPut_MarshalsExpectedItem(t *testing.T) {
	ddb := &fakeDDB{}
	store := NewSandboxes(ddb, "test-table")

	now := time.Date(2026, 5, 11, 10, 30, 0, 0, time.UTC)
	err := store.Put(context.Background(), Sandbox{
		SandboxID:   "cbsbx_fake_abc",
		AppID:       "app-1",
		AccountID:   "acct_fake_abc",
		ClaimURL:    "https://example.com/claim",
		ClaimStatus: ClaimStatusProvisioned,
		CreatedAt:   now,
		UpdatedAt:   now,
	})
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if len(ddb.putInputs) != 1 {
		t.Fatalf("PutItem calls: want 1, got %d", len(ddb.putInputs))
	}
	got := ddb.putInputs[0]
	if *got.TableName != "test-table" {
		t.Errorf("TableName: want %q, got %q", "test-table", *got.TableName)
	}
	for attr, want := range map[string]string{
		"sandbox_id":   "cbsbx_fake_abc",
		"app_id":       "app-1",
		"account_id":   "acct_fake_abc",
		"claim_url":    "https://example.com/claim",
		"claim_status": "provisioned",
		"created_at":   "2026-05-11T10:30:00Z",
		"updated_at":   "2026-05-11T10:30:00Z",
	} {
		v, ok := got.Item[attr].(*types.AttributeValueMemberS)
		if !ok {
			t.Errorf("attr %q: not a string attribute (or missing)", attr)
			continue
		}
		if v.Value != want {
			t.Errorf("attr %q: want %q, got %q", attr, want, v.Value)
		}
	}
	if _, present := got.Item["live_account_id"]; present {
		t.Errorf("live_account_id should be omitted when empty; got present")
	}
	// Regression guard: no Stripe-issued credential must ever be written to
	// DDB — they all live only in mhp-airo's alloc env. If a future refactor
	// reintroduces any of them as a DDB attribute, catch it here.
	for _, attr := range []string{"publishable_key", "secret_key", "mcp_key"} {
		if _, present := got.Item[attr]; present {
			t.Errorf("attr %q must be absent from the marshaled item (Stripe credentials live in mhp-airo, not DDB)", attr)
		}
	}
}

func TestPut_IncludesLiveAccountIDWhenSet(t *testing.T) {
	ddb := &fakeDDB{}
	store := NewSandboxes(ddb, "test-table")
	now := time.Date(2026, 5, 11, 10, 30, 0, 0, time.UTC)
	err := store.Put(context.Background(), Sandbox{
		SandboxID:     "cbsbx_fake_abc",
		AppID:         "app-1",
		ClaimStatus:   ClaimStatusLive,
		LiveAccountID: "acct_live_xyz",
		CreatedAt:     now,
		UpdatedAt:     now,
	})
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	v, ok := ddb.putInputs[0].Item["live_account_id"].(*types.AttributeValueMemberS)
	if !ok {
		t.Fatalf("live_account_id: missing or wrong type")
	}
	if v.Value != "acct_live_xyz" {
		t.Errorf("live_account_id: want acct_live_xyz, got %q", v.Value)
	}
}

func TestPut_RejectsZeroTimestamps(t *testing.T) {
	ddb := &fakeDDB{}
	store := NewSandboxes(ddb, "test-table")
	now := time.Date(2026, 5, 11, 10, 30, 0, 0, time.UTC)

	cases := []struct {
		name      string
		createdAt time.Time
		updatedAt time.Time
	}{
		{"both zero", time.Time{}, time.Time{}},
		{"created zero", time.Time{}, now},
		{"updated zero", now, time.Time{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := store.Put(context.Background(), Sandbox{
				SandboxID:   "cbsbx_fake_abc",
				AppID:       "app-1",
				ClaimStatus: ClaimStatusProvisioned,
				CreatedAt:   tc.createdAt,
				UpdatedAt:   tc.updatedAt,
			})
			if err == nil {
				t.Fatalf("Put: want error for zero timestamp, got nil")
			}
		})
	}
	if len(ddb.putInputs) != 0 {
		t.Errorf("PutItem: want 0 calls on validation failure, got %d", len(ddb.putInputs))
	}
}

func TestGetBySandboxID_Found(t *testing.T) {
	ddb := &fakeDDB{
		getItems: map[string]map[string]types.AttributeValue{
			"cbsbx_fake_abc": {
				"sandbox_id":   &types.AttributeValueMemberS{Value: "cbsbx_fake_abc"},
				"app_id":       &types.AttributeValueMemberS{Value: "app-1"},
				"account_id":   &types.AttributeValueMemberS{Value: "acct_fake_abc"},
				"claim_status": &types.AttributeValueMemberS{Value: "provisioned"},
				"created_at":   &types.AttributeValueMemberS{Value: "2026-05-11T10:30:00Z"},
			},
		},
	}
	store := NewSandboxes(ddb, "test-table")

	sb, err := store.GetBySandboxID(context.Background(), "cbsbx_fake_abc")
	if err != nil {
		t.Fatalf("GetBySandboxID: %v", err)
	}
	if sb.SandboxID != "cbsbx_fake_abc" {
		t.Errorf("SandboxID: want cbsbx_fake_abc, got %q", sb.SandboxID)
	}
	if sb.AppID != "app-1" {
		t.Errorf("AppID: want app-1, got %q", sb.AppID)
	}
	if sb.ClaimStatus != ClaimStatusProvisioned {
		t.Errorf("ClaimStatus: want provisioned, got %q", sb.ClaimStatus)
	}
	if sb.CreatedAt.IsZero() {
		t.Errorf("CreatedAt: should be parsed non-zero")
	}
}

func TestGetBySandboxID_NotFound(t *testing.T) {
	ddb := &fakeDDB{}
	store := NewSandboxes(ddb, "test-table")

	_, err := store.GetBySandboxID(context.Background(), "missing")
	if !errors.Is(err, ErrSandboxNotFound) {
		t.Fatalf("want ErrSandboxNotFound, got %v", err)
	}
}

func TestQueryByAppID_Found(t *testing.T) {
	ddb := &fakeDDB{
		queryItems: map[string][]map[string]types.AttributeValue{
			"app-1": {
				{
					"sandbox_id": &types.AttributeValueMemberS{Value: "cbsbx_fake_abc"},
					"app_id":     &types.AttributeValueMemberS{Value: "app-1"},
				},
			},
		},
	}
	store := NewSandboxes(ddb, "test-table")

	got, err := store.QueryByAppID(context.Background(), "app-1")
	if err != nil {
		t.Fatalf("QueryByAppID: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("results: want 1, got %d", len(got))
	}
	if got[0].SandboxID != "cbsbx_fake_abc" {
		t.Errorf("SandboxID: want cbsbx_fake_abc, got %q", got[0].SandboxID)
	}
	// Regression guard: the query must target the GSI.
	if ddb.lastQuery == nil || ddb.lastQuery.IndexName == nil || *ddb.lastQuery.IndexName != "app_id-index" {
		t.Errorf("IndexName: want %q, got %v", "app_id-index", ddb.lastQuery)
	}
}

func TestQueryByAppID_Empty(t *testing.T) {
	ddb := &fakeDDB{}
	store := NewSandboxes(ddb, "test-table")

	got, err := store.QueryByAppID(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("QueryByAppID: %v", err)
	}
	if got != nil {
		t.Errorf("empty result: want nil slice, got %v", got)
	}
}

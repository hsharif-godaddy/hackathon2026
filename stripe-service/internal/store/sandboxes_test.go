package store

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// fakeDDB records inputs and returns canned outputs or errors. Zero value is
// a store containing no items; all operations return nil error and empty
// responses unless configured otherwise.
type fakeDDB struct {
	putInputs                           []*dynamodb.PutItemInput
	updateInputs                        []*dynamodb.UpdateItemInput
	getItems                            map[string]map[string]types.AttributeValue   // keyed by sandbox_id
	queryItems                          map[string][]map[string]types.AttributeValue // keyed by app_id
	lastQuery                           *dynamodb.QueryInput
	putErr, getErr, queryErr, updateErr error
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

// UpdateItem evaluates the production condition expressions we generate:
//
//  1. attribute_exists(sandbox_id) AND #cs IN (:a0, :a1, ...) — used by
//     UpdateClaimStatus; checks that the row exists AND its current
//     claim_status is in the allowed-source set.
//
//  2. attribute_exists(sandbox_id) — used by UpdateClaimURL; only checks
//     that the row exists (no claim_status guard).
//
// On success it applies all SET clauses we know we generate (claim_status,
// updated_at, optionally live_account_id, claim_url, claim_url_expires_at)
// by mutating the map in place, so a follow-up GetBySandboxID reflects the
// update.
func (f *fakeDDB) UpdateItem(_ context.Context, in *dynamodb.UpdateItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
	if f.updateErr != nil {
		return nil, f.updateErr
	}
	f.updateInputs = append(f.updateInputs, in)

	idAttr, _ := in.Key["sandbox_id"].(*types.AttributeValueMemberS)
	if idAttr == nil {
		return &dynamodb.UpdateItemOutput{}, nil
	}
	item, exists := f.getItems[idAttr.Value]

	if in.ConditionExpression != nil {
		if !exists {
			return nil, &types.ConditionalCheckFailedException{}
		}
		// If the expression contains ":a" placeholders it carries a
		// claim_status IN guard (UpdateClaimStatus). Verify the current
		// status is in the allowed set.
		hasStatusGuard := false
		for k := range in.ExpressionAttributeValues {
			if strings.HasPrefix(k, ":a") {
				hasStatusGuard = true
				break
			}
		}
		if hasStatusGuard {
			currentCS := ""
			if cs, ok := item["claim_status"].(*types.AttributeValueMemberS); ok {
				currentCS = cs.Value
			}
			allowedHit := false
			for k, v := range in.ExpressionAttributeValues {
				if !strings.HasPrefix(k, ":a") {
					continue
				}
				if sv, ok := v.(*types.AttributeValueMemberS); ok && sv.Value == currentCS {
					allowedHit = true
					break
				}
			}
			if !allowedHit {
				return nil, &types.ConditionalCheckFailedException{}
			}
		}
		// No ":a" placeholders means purely attribute_exists — already
		// satisfied by the !exists check above.
	}

	if exists {
		newItem := make(map[string]types.AttributeValue, len(item))
		for k, v := range item {
			newItem[k] = v
		}
		if _, isStatusUpdate := in.ExpressionAttributeValues[":s"]; isStatusUpdate {
			// UpdateClaimStatus: :s=claim_status, :u=updated_at, :l=live_account_id
			newItem["claim_status"] = in.ExpressionAttributeValues[":s"]
			if v, ok := in.ExpressionAttributeValues[":u"]; ok {
				newItem["updated_at"] = v
			}
			if v, ok := in.ExpressionAttributeValues[":l"]; ok {
				newItem["live_account_id"] = v
			}
		} else {
			// UpdateClaimURL: :u=claim_url, :e=claim_url_expires_at, :n=updated_at
			if v, ok := in.ExpressionAttributeValues[":u"]; ok {
				newItem["claim_url"] = v
			}
			if v, ok := in.ExpressionAttributeValues[":e"]; ok {
				newItem["claim_url_expires_at"] = v
			}
			if v, ok := in.ExpressionAttributeValues[":n"]; ok {
				newItem["updated_at"] = v
			}
		}
		f.getItems[idAttr.Value] = newItem
	}
	return &dynamodb.UpdateItemOutput{}, nil
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

func TestUpdateClaimStatus_AdvancesStatusAndSetsLiveAccountID(t *testing.T) {
	now := time.Date(2026, 5, 11, 10, 30, 0, 0, time.UTC)
	ddb := &fakeDDB{
		getItems: map[string]map[string]types.AttributeValue{
			"cbsbx_fake_abc": {
				"sandbox_id":   &types.AttributeValueMemberS{Value: "cbsbx_fake_abc"},
				"app_id":       &types.AttributeValueMemberS{Value: "app-1"},
				"account_id":   &types.AttributeValueMemberS{Value: "acct_fake_abc"},
				"claim_url":    &types.AttributeValueMemberS{Value: "https://example.com/claim"},
				"claim_status": &types.AttributeValueMemberS{Value: "claimed"},
				"created_at":   &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
				"updated_at":   &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
			},
		},
	}
	s := NewSandboxes(ddb, "test-table")

	err := s.UpdateClaimStatus(context.Background(), "cbsbx_fake_abc", ClaimStatusLive, "acct_live_xyz")
	if err != nil {
		t.Fatalf("UpdateClaimStatus: %v", err)
	}
	if len(ddb.updateInputs) != 1 {
		t.Fatalf("UpdateItem calls: want 1, got %d", len(ddb.updateInputs))
	}
	if len(ddb.putInputs) != 0 {
		t.Errorf("PutItem calls: want 0 (UpdateItem-only path), got %d", len(ddb.putInputs))
	}
	item := ddb.getItems["cbsbx_fake_abc"]
	if v, _ := item["claim_status"].(*types.AttributeValueMemberS); v == nil || v.Value != "live" {
		t.Errorf("claim_status: want live, got %v", item["claim_status"])
	}
	if v, _ := item["live_account_id"].(*types.AttributeValueMemberS); v == nil || v.Value != "acct_live_xyz" {
		t.Errorf("live_account_id: want acct_live_xyz, got %v", item["live_account_id"])
	}

	// Regression guard: the condition expression must enforce the monotonic
	// guard so a stale event can't downgrade a later state.
	in := ddb.updateInputs[0]
	if in.ConditionExpression == nil || !strings.Contains(*in.ConditionExpression, "#cs IN") {
		t.Errorf("ConditionExpression: want monotonic guard via #cs IN (...), got %v", in.ConditionExpression)
	}
	if in.ConditionExpression == nil || !strings.Contains(*in.ConditionExpression, "attribute_exists(sandbox_id)") {
		t.Errorf("ConditionExpression: want attribute_exists(sandbox_id) for not-found discrimination, got %v", in.ConditionExpression)
	}
}

func TestUpdateClaimStatus_EmptyLiveAccountIDPreservesExisting(t *testing.T) {
	// Passing liveAccountID="" must not overwrite an already-set live_account_id.
	now := time.Date(2026, 5, 11, 10, 30, 0, 0, time.UTC)
	ddb := &fakeDDB{
		getItems: map[string]map[string]types.AttributeValue{
			"cbsbx_fake_abc": {
				"sandbox_id":      &types.AttributeValueMemberS{Value: "cbsbx_fake_abc"},
				"app_id":          &types.AttributeValueMemberS{Value: "app-1"},
				"account_id":      &types.AttributeValueMemberS{Value: "acct_fake_abc"},
				"claim_url":       &types.AttributeValueMemberS{Value: "https://example.com/claim"},
				"claim_status":    &types.AttributeValueMemberS{Value: "claimed"},
				"live_account_id": &types.AttributeValueMemberS{Value: "acct_already_set"},
				"created_at":      &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
				"updated_at":      &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
			},
		},
	}
	s := NewSandboxes(ddb, "test-table")

	err := s.UpdateClaimStatus(context.Background(), "cbsbx_fake_abc", ClaimStatusLive, "")
	if err != nil {
		t.Fatalf("UpdateClaimStatus: %v", err)
	}
	item := ddb.getItems["cbsbx_fake_abc"]
	if v, _ := item["live_account_id"].(*types.AttributeValueMemberS); v == nil || v.Value != "acct_already_set" {
		t.Errorf("live_account_id: want acct_already_set (preserved), got %v", item["live_account_id"])
	}

	// When liveAccountID is "", the SET clause must not touch live_account_id
	// at all — otherwise we'd be writing the empty string back, costing a
	// pointless write and (worse) clobbering a real value if a later
	// UpdateItem races us on the same row.
	in := ddb.updateInputs[0]
	if in.UpdateExpression == nil || strings.Contains(*in.UpdateExpression, "#la") {
		t.Errorf("UpdateExpression: should not reference #la when liveAccountID is empty, got %v", in.UpdateExpression)
	}
	if _, present := in.ExpressionAttributeValues[":l"]; present {
		t.Errorf(":l attribute value should be absent when liveAccountID is empty")
	}
	if _, present := in.ExpressionAttributeNames["#la"]; present {
		t.Errorf("#la attribute name should be absent when liveAccountID is empty")
	}
}

func TestUpdateClaimStatus_PropagatesErrSandboxNotFound(t *testing.T) {
	// ErrSandboxNotFound must propagate unwrapped so callers can errors.Is on it.
	// With UpdateItem the row-missing case surfaces as a ConditionalCheckFailedException;
	// the discriminator GetItem confirms it.
	ddb := &fakeDDB{}
	s := NewSandboxes(ddb, "test-table")

	err := s.UpdateClaimStatus(context.Background(), "missing", ClaimStatusClaimed, "")
	if !errors.Is(err, ErrSandboxNotFound) {
		t.Fatalf("want errors.Is(err, ErrSandboxNotFound), got %v", err)
	}
}

func TestUpdateClaimStatus_DoesNotDowngradeLiveToClaimed(t *testing.T) {
	// Concurrent webhook events can fire in either order. If `live`
	// (owner_account_updated) lands and is applied before `claimed`, the
	// late-arriving `claimed` event must NOT downgrade the row back to
	// claimed. The monotonic-guard condition expression enforces this.
	now := time.Date(2026, 5, 11, 10, 30, 0, 0, time.UTC)
	ddb := &fakeDDB{
		getItems: map[string]map[string]types.AttributeValue{
			"cbsbx_fake_abc": {
				"sandbox_id":      &types.AttributeValueMemberS{Value: "cbsbx_fake_abc"},
				"app_id":          &types.AttributeValueMemberS{Value: "app-1"},
				"claim_status":    &types.AttributeValueMemberS{Value: "live"},
				"live_account_id": &types.AttributeValueMemberS{Value: "acct_live_xyz"},
				"created_at":      &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
				"updated_at":      &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
			},
		},
	}
	s := NewSandboxes(ddb, "test-table")

	// Late `claimed` event lands after the row is already at live.
	err := s.UpdateClaimStatus(context.Background(), "cbsbx_fake_abc", ClaimStatusClaimed, "")
	if err != nil {
		t.Fatalf("UpdateClaimStatus: want nil (monotonic no-op), got %v", err)
	}

	item := ddb.getItems["cbsbx_fake_abc"]
	if v, _ := item["claim_status"].(*types.AttributeValueMemberS); v == nil || v.Value != "live" {
		t.Errorf("claim_status: must remain live (race-safe), got %v", item["claim_status"])
	}
	if v, _ := item["live_account_id"].(*types.AttributeValueMemberS); v == nil || v.Value != "acct_live_xyz" {
		t.Errorf("live_account_id: must be preserved across rejected update, got %v", item["live_account_id"])
	}
}

func TestUpdateClaimStatus_AllowsLivePromotionFromAllNonRevokedStates(t *testing.T) {
	// owner_account_updated is allowed to promote the sandbox to live from
	// any non-revoked state, including idempotent re-application of live.
	now := time.Date(2026, 5, 11, 10, 30, 0, 0, time.UTC)
	cases := []struct {
		name    string
		current string
	}{
		{"from provisioned", "provisioned"},
		{"from claimed", "claimed"},
		{"idempotent live", "live"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ddb := &fakeDDB{
				getItems: map[string]map[string]types.AttributeValue{
					"cbsbx_fake_abc": {
						"sandbox_id":   &types.AttributeValueMemberS{Value: "cbsbx_fake_abc"},
						"app_id":       &types.AttributeValueMemberS{Value: "app-1"},
						"claim_status": &types.AttributeValueMemberS{Value: tc.current},
						"created_at":   &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
						"updated_at":   &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
					},
				},
			}
			s := NewSandboxes(ddb, "test-table")

			err := s.UpdateClaimStatus(context.Background(), "cbsbx_fake_abc", ClaimStatusLive, "acct_live_xyz")
			if err != nil {
				t.Fatalf("UpdateClaimStatus from %s: %v", tc.current, err)
			}
			item := ddb.getItems["cbsbx_fake_abc"]
			if v, _ := item["claim_status"].(*types.AttributeValueMemberS); v == nil || v.Value != "live" {
				t.Errorf("claim_status from %s: want live, got %v", tc.current, item["claim_status"])
			}
			if v, _ := item["live_account_id"].(*types.AttributeValueMemberS); v == nil || v.Value != "acct_live_xyz" {
				t.Errorf("live_account_id from %s: want acct_live_xyz, got %v", tc.current, item["live_account_id"])
			}
		})
	}
}

func TestUpdateClaimURL_HappyPath(t *testing.T) {
	now := time.Date(2026, 5, 11, 10, 30, 0, 0, time.UTC)
	ddb := &fakeDDB{
		getItems: map[string]map[string]types.AttributeValue{
			"cbsbx_fake_abc": {
				"sandbox_id":   &types.AttributeValueMemberS{Value: "cbsbx_fake_abc"},
				"app_id":       &types.AttributeValueMemberS{Value: "app-1"},
				"claim_url":    &types.AttributeValueMemberS{Value: "https://stripe.com/old"},
				"claim_status": &types.AttributeValueMemberS{Value: "provisioned"},
				"created_at":   &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
				"updated_at":   &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
			},
		},
	}
	s := NewSandboxes(ddb, "test-table")

	newExpiry := time.Date(2026, 5, 18, 10, 30, 0, 0, time.UTC)
	err := s.UpdateClaimURL(context.Background(), "cbsbx_fake_abc", "https://stripe.com/new", newExpiry)
	if err != nil {
		t.Fatalf("UpdateClaimURL: %v", err)
	}
	if len(ddb.updateInputs) != 1 {
		t.Fatalf("UpdateItem calls: want 1, got %d", len(ddb.updateInputs))
	}

	item := ddb.getItems["cbsbx_fake_abc"]
	if v, _ := item["claim_url"].(*types.AttributeValueMemberS); v == nil || v.Value != "https://stripe.com/new" {
		t.Errorf("claim_url: want https://stripe.com/new, got %v", item["claim_url"])
	}
	if v, _ := item["claim_url_expires_at"].(*types.AttributeValueMemberS); v == nil || v.Value != newExpiry.UTC().Format(time.RFC3339) {
		t.Errorf("claim_url_expires_at: want %s, got %v", newExpiry.UTC().Format(time.RFC3339), item["claim_url_expires_at"])
	}
	if v, _ := item["updated_at"].(*types.AttributeValueMemberS); v == nil || v.Value == now.Format(time.RFC3339) {
		t.Errorf("updated_at: should be bumped, still shows original value %v", item["updated_at"])
	}
}

func TestUpdateClaimURL_ReturnsErrSandboxNotFound(t *testing.T) {
	ddb := &fakeDDB{}
	s := NewSandboxes(ddb, "test-table")

	newExpiry := time.Date(2026, 5, 18, 10, 30, 0, 0, time.UTC)
	err := s.UpdateClaimURL(context.Background(), "missing", "https://stripe.com/new", newExpiry)
	if !errors.Is(err, ErrSandboxNotFound) {
		t.Fatalf("want errors.Is(err, ErrSandboxNotFound), got %v", err)
	}
}

func TestUpdateClaimURL_RejectsEmptyClaimURL(t *testing.T) {
	ddb := &fakeDDB{}
	s := NewSandboxes(ddb, "test-table")

	newExpiry := time.Date(2026, 5, 18, 10, 30, 0, 0, time.UTC)
	err := s.UpdateClaimURL(context.Background(), "cbsbx_fake_abc", "", newExpiry)
	if err == nil {
		t.Fatalf("want error for empty claimURL, got nil")
	}
	if len(ddb.updateInputs) != 0 {
		t.Errorf("UpdateItem should not be called on validation failure; got %d calls", len(ddb.updateInputs))
	}
}

func TestUpdateClaimURL_RejectsZeroExpiresAt(t *testing.T) {
	ddb := &fakeDDB{}
	s := NewSandboxes(ddb, "test-table")

	err := s.UpdateClaimURL(context.Background(), "cbsbx_fake_abc", "https://stripe.com/new", time.Time{})
	if err == nil {
		t.Fatalf("want error for zero expiresAt, got nil")
	}
	if len(ddb.updateInputs) != 0 {
		t.Errorf("UpdateItem should not be called on validation failure; got %d calls", len(ddb.updateInputs))
	}
}

func TestToItemFromItem_RoundTrip_ExpiryFields(t *testing.T) {
	// Verify that ExpiresAt and ClaimURLExpiresAt survive a toItem+fromItem
	// round trip. A missing RFC3339 tag or wrong attribute name would zero
	// both fields and silently break the auto-renew check.
	now := time.Date(2026, 5, 11, 10, 30, 0, 0, time.UTC)
	expiresAt := time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC)
	claimExpiry := time.Date(2026, 5, 18, 0, 0, 0, 0, time.UTC)

	in := Sandbox{
		SandboxID:         "cbsbx_fake_abc",
		AppID:             "app-1",
		AccountID:         "acct_fake_abc",
		ClaimURL:          "https://example.com/claim",
		ClaimStatus:       ClaimStatusProvisioned,
		ExpiresAt:         expiresAt,
		ClaimURLExpiresAt: claimExpiry,
		CreatedAt:         now,
		UpdatedAt:         now,
	}

	out := fromItem(toItem(in))

	if !out.ExpiresAt.Equal(expiresAt) {
		t.Errorf("ExpiresAt: want %v, got %v", expiresAt, out.ExpiresAt)
	}
	if !out.ClaimURLExpiresAt.Equal(claimExpiry) {
		t.Errorf("ClaimURLExpiresAt: want %v, got %v", claimExpiry, out.ClaimURLExpiresAt)
	}
}

func TestToItemFromItem_RoundTrip_ZeroExpiryFieldsOmitted(t *testing.T) {
	// A Sandbox with zero ExpiresAt/ClaimURLExpiresAt (e.g. a row written
	// before the expiry schema landed) must round-trip as zero, not 1970.
	// toItem omits the attributes when zero; fromItem returns zero for
	// missing attributes.
	now := time.Date(2026, 5, 11, 10, 30, 0, 0, time.UTC)
	in := Sandbox{
		SandboxID:   "cbsbx_fake_abc",
		AppID:       "app-1",
		ClaimStatus: ClaimStatusProvisioned,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	item := toItem(in)
	if _, present := item["expires_at"]; present {
		t.Errorf("expires_at should be omitted when zero; got %v", item["expires_at"])
	}
	if _, present := item["claim_url_expires_at"]; present {
		t.Errorf("claim_url_expires_at should be omitted when zero; got %v", item["claim_url_expires_at"])
	}

	out := fromItem(item)
	if !out.ExpiresAt.IsZero() {
		t.Errorf("ExpiresAt: want zero, got %v", out.ExpiresAt)
	}
	if !out.ClaimURLExpiresAt.IsZero() {
		t.Errorf("ClaimURLExpiresAt: want zero, got %v", out.ClaimURLExpiresAt)
	}
}

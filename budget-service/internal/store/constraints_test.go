package store

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// PG SQLSTATE codes used by schema-regression tests.
const (
	pgCheckViolation   = "23514"
	pgNotNullViolation = "23502"
)

func assertPGError(t *testing.T, err error, wantCode string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected PG error %q, got nil", wantCode)
	}
	var pe *pq.Error
	if !errors.As(err, &pe) {
		t.Fatalf("expected *pq.Error, got %T: %v", err, err)
	}
	if string(pe.Code) != wantCode {
		t.Fatalf("expected SQLSTATE %q, got %q (%s)", wantCode, pe.Code, pe.Message)
	}
}

// TestBudgetSessionItemsCallRequestIDLengthCheck verifies the DB-level CHECK
// constraint added in migration 000015 rejects oversized call_request_id even
// when the API-layer guard is bypassed. Asserts the specific SQLSTATE so a
// migration that drops the CHECK but leaves UNIQUE in place cannot silently
// satisfy this guard via a coincidental unique-violation error.
func TestBudgetSessionItemsCallRequestIDLengthCheck(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	key := "callreq-len-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name     string
		value    string
		wantCode string // empty string = expect success
	}{
		{"empty_rejected", "", pgCheckViolation},
		{"length_1_accepted", "a", ""},
		{"exactly_256_accepted", strings.Repeat("a", 256), ""},
		{"257_rejected", strings.Repeat("a", 257), pgCheckViolation},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Each subtest gets its own session so UNIQUE (session_id, call_request_id)
			// can never coincidentally satisfy a "reject" case via a 23505 collision
			// from a prior subtest's value.
			sessionID := uuid.NewString()
			if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil, false); err != nil {
				t.Fatal(err)
			}
			_, err := st.db.ExecContext(ctx, `
				INSERT INTO budget_session_items (session_id, budget_item_id, cost_usd, credits_charged, call_request_id)
				VALUES ($1, NULL, 0, 0, $2)
			`, sessionID, tc.value)
			if tc.wantCode == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			assertPGError(t, err, tc.wantCode)
		})
	}

	// NOT NULL is a separate load-bearing guard: a future migration could drop
	// NOT NULL while keeping the CHECK, and NULL would silently pass because
	// `NULL BETWEEN 1 AND 256` evaluates to UNKNOWN, not FALSE.
	t.Run("null_rejected", func(t *testing.T) {
		sessionID := uuid.NewString()
		if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil, false); err != nil {
			t.Fatal(err)
		}
		_, err := st.db.ExecContext(ctx, `
			INSERT INTO budget_session_items (session_id, budget_item_id, cost_usd, credits_charged, call_request_id)
			VALUES ($1, NULL, 0, 0, NULL)
		`, sessionID)
		assertPGError(t, err, pgNotNullViolation)
	})
}

// TestProductsProductKeyLengthCheck verifies the DB-level CHECK constraint on
// products.product_key (migration 000001: char_length > 0 AND <= 256). Asserts
// the specific SQLSTATE so a migration that drops the CHECK but leaves the
// PRIMARY KEY intact cannot silently satisfy this guard via a 23505 collision.
//
// Accepted values are prefixed with a per-test uuid so the exact product_key
// cannot collide with any other test's fixtures (the PK constraint is tested
// separately elsewhere; here we only care about length).
func TestProductsProductKeyLengthCheck(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	// Use unique prefixes to avoid collisions with other tests' product rows.
	runID := strings.ReplaceAll(uuid.NewString(), "-", "")
	// For the "length 1" check we use a unique 5-char prefix to avoid PK collisions
	// with the 16 possible single hex-digit values that other runs may have inserted.
	shortUnique := "z" + runID[:4]

	cases := []struct {
		name     string
		value    string
		wantCode string
	}{
		{"empty_rejected", "", pgCheckViolation},
		{"length_1_accepted", shortUnique, ""},
		{"exactly_256_accepted", runID + strings.Repeat("x", 256-len(runID)), ""},
		{"257_rejected", strings.Repeat("c", 257), pgCheckViolation},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := st.db.ExecContext(ctx, `
				INSERT INTO products (product_key) VALUES ($1)
			`, tc.value)
			if tc.wantCode == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			assertPGError(t, err, tc.wantCode)
		})
	}
}

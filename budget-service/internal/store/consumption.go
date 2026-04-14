// Consumption: USD→credits for session lines and session reports. Each budget_item row keeps its own
// cost_credit_ratio; we never blend ratios across rows. Order matches docs/budget-service-spec.md.
// Pool "used" is budget_items.credits_used (cached); an AFTER INSERT trigger on budget_item_credit_ledger
// keeps it equal to SUM(ledger.credits_delta) per item.
package store

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"time"

	"github.com/shopspring/decimal"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/credits"
)

// budgetConsumptionState is one row's pool for walking: how many credits remain (total-used) at csr.
// expiresAt and resetInt are used for filtering expired items and prioritizing resetting items.
// createdAt is used for stable tie-breaking in sort order (matching SQL ORDER BY).
type budgetConsumptionState struct {
	id        string
	csr       decimal.Decimal
	total     decimal.Decimal
	used      decimal.Decimal
	expiresAt *time.Time
	resetInt  *string
	createdAt time.Time
}

// budgetCreditChunk is one slice of a USD amount taken from a single budget_item at that row's ratio.
type budgetCreditChunk struct {
	budgetItemID string
	credits      decimal.Decimal
	usdChunk     decimal.Decimal
}

// sortConsumptionItems sorts items by consumption priority matching the SQL ORDER BY:
// reset-interval items first (reset_interval IS NOT NULL), then by expires_at ASC NULLS LAST,
// then by created_at, then by id.
func sortConsumptionItems(items []budgetConsumptionState) {
	sort.SliceStable(items, func(i, j int) bool {
		// Reset-interval items come first (matches SQL ORDER BY reset_interval IS NULL).
		iResetting := items[i].resetInt != nil
		jResetting := items[j].resetInt != nil
		if iResetting != jResetting {
			return iResetting // reset interval set comes first
		}

		// Then by expires_at ASC NULLS LAST
		iHasExpire := items[i].expiresAt != nil
		jHasExpire := items[j].expiresAt != nil
		if iHasExpire && jHasExpire {
			if !items[i].expiresAt.Equal(*items[j].expiresAt) {
				return items[i].expiresAt.Before(*items[j].expiresAt)
			}
		} else if iHasExpire != jHasExpire {
			return iHasExpire // has expiry comes before no expiry (NULLS LAST)
		}

		// Then by created_at (matching SQL ORDER BY)
		if !items[i].createdAt.Equal(items[j].createdAt) {
			return items[i].createdAt.Before(items[j].createdAt)
		}

		// Final tie-break by id
		return items[i].id < items[j].id
	})
}

// filterConsumableItems returns only items that are eligible for credit allocation at the given time.
// An item is NOT consumable if:
// - It has expired (expiresAt <= now)
// - It has no remaining credits (total - used <= 0)
func filterConsumableItems(items []budgetConsumptionState, now time.Time) []budgetConsumptionState {
	var out []budgetConsumptionState
	for i := range items {
		// Skip expired items (expiresAt is at or before now)
		if items[i].expiresAt != nil && !items[i].expiresAt.After(now) {
			continue
		}
		// Skip items with no remaining credits
		avail := items[i].total.Sub(items[i].used)
		if !avail.IsPositive() {
			continue
		}
		out = append(out, items[i])
	}
	return out
}

// consumeBudgetCostUSD sorts items by priority, filters expired/exhausted items, and allocates credits.
// Items can be passed in any order; they will be sorted according to consumption priority.
// Mutates items[].used to reflect consumed credits for repeated in-memory consumption.
// Returns ErrInsufficientCredits if USD remains after walking all eligible items.
func consumeBudgetCostUSD(usd decimal.Decimal, items []budgetConsumptionState, now time.Time) ([]budgetCreditChunk, error) {
	if !usd.IsPositive() {
		return nil, nil
	}

	// Make a copy to avoid mutating the original slice order.
	sorted := make([]budgetConsumptionState, len(items))
	copy(sorted, items)
	sortConsumptionItems(sorted)
	consumable := filterConsumableItems(sorted, now)

	// Walk consumable items and allocate credits.
	var out []budgetCreditChunk
	usdRem := usd
	for i := range consumable {
		if !usdRem.IsPositive() {
			break
		}
		avail := consumable[i].total.Sub(consumable[i].used)
		if !avail.IsPositive() {
			continue
		}
		capacityUsd := avail.Mul(consumable[i].csr)
		if !capacityUsd.IsPositive() {
			continue
		}
		usdChunk := usdRem
		if capacityUsd.LessThan(usdChunk) {
			usdChunk = capacityUsd
		}
		creditChunk, err := credits.DollarsToCredits(usdChunk, consumable[i].csr)
		if err != nil {
			return nil, err
		}
		if !creditChunk.IsPositive() {
			return nil, fmt.Errorf("usd chunk produced zero credits: %w", credits.ErrInvalid)
		}
		// Rounding can theoretically exceed pool; never deduct more than remaining credits on the row.
		if creditChunk.GreaterThan(avail) {
			creditChunk = avail
		}
		out = append(out, budgetCreditChunk{
			budgetItemID: consumable[i].id,
			credits:      creditChunk,
			usdChunk:     usdChunk,
		})
		consumable[i].used = consumable[i].used.Add(creditChunk)
		usdRem = usdRem.Sub(usdChunk)
	}

	// Reconcile mutated used values back onto the caller's original slice
	// so repeated in-memory consumption sees prior spend.
	usedByID := make(map[string]decimal.Decimal, len(consumable))
	for i := range consumable {
		usedByID[consumable[i].id] = consumable[i].used
	}
	for i := range items {
		if used, ok := usedByID[items[i].id]; ok {
			items[i].used = used
		}
	}

	if usdRem.IsPositive() {
		return nil, ErrInsufficientCredits
	}
	return out, nil
}

// budgetHasConsumableCapacity checks if at least one item has positive available credits
// after filtering expired items. Returns true if any item can accept a positive USD amount.
func budgetHasConsumableCapacity(items []budgetConsumptionState, now time.Time) bool {
	consumable := filterConsumableItems(items, now)
	for i := range consumable {
		avail := consumable[i].total.Sub(consumable[i].used)
		if !avail.IsPositive() {
			continue
		}
		capacityUsd := avail.Mul(consumable[i].csr)
		if capacityUsd.IsPositive() {
			return true
		}
	}
	return false
}

// loadBudgetConsumptionStatesTx returns rows in consumption priority: reset interval lines first
// (reset_interval set), then soonest expires_at, then created_at, then id.
func loadBudgetConsumptionStatesTx(ctx context.Context, tx *sql.Tx, budgetID string, forUpdate bool) ([]budgetConsumptionState, error) {
	q := `
			SELECT bi.id, bi.credits_total, bi.credits_used, bi.cost_credit_ratio, bi.expires_at, bi.reset_interval, bi.created_at
			FROM budget_items bi
			WHERE bi.budget_id = $1 AND bi.deleted_at IS NULL
			ORDER BY (bi.reset_interval IS NULL), bi.expires_at NULLS LAST, bi.created_at, bi.id
		`
	if forUpdate {
		q += ` FOR UPDATE`
	}
	rows, err := tx.QueryContext(ctx, q, budgetID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []budgetConsumptionState
	for rows.Next() {
		var st budgetConsumptionState
		var expiresAt sql.NullTime
		var resetInt sql.NullString
		if err := rows.Scan(&st.id, &st.total, &st.used, &st.csr, &expiresAt, &resetInt, &st.createdAt); err != nil {
			return nil, err
		}
		if expiresAt.Valid {
			tm := expiresAt.Time
			st.expiresAt = &tm
		}
		if resetInt.Valid {
			r := resetInt.String
			st.resetInt = &r
		}
		out = append(out, st)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, ErrNoBudgetItems
	}
	return out, nil
}

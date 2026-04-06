// Consumption: USD→credits for session lines and session reports. Each budget_item row keeps its own
// credit_spend_ratio; we never blend ratios across rows. Order matches docs/budget-service-spec.md.
// Pool “used” is budget_items.credits_used (cached); an AFTER INSERT trigger on budget_item_credit_ledger
// keeps it equal to SUM(ledger.credits_delta) per item.
package store

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/shopspring/decimal"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/credits"
)

// budgetConsumptionState is one row’s pool for walking: how many credits remain (total−used) at csr.
type budgetConsumptionState struct {
	id    string
	csr   decimal.Decimal
	total decimal.Decimal
	used  decimal.Decimal
}

// budgetCreditChunk is one slice of a USD amount taken from a single budget_item at that row’s ratio.
type budgetCreditChunk struct {
	budgetItemID string
	credits      decimal.Decimal
	usdChunk     decimal.Decimal
}

// consumeBudgetCostUSD walks items in slice order (caller must load via loadBudgetConsumptionStatesTx).
// credits = round_6(usd/csr) per chunk; capacityUsd = availCredits×csr caps how much USD one row can cover.
// Mutates items[].used; returns ErrInsufficientCredits if USD remains after the walk.
func consumeBudgetCostUSD(usd decimal.Decimal, items []budgetConsumptionState) ([]budgetCreditChunk, error) {
	if !usd.IsPositive() {
		return nil, nil
	}
	var out []budgetCreditChunk
	usdRem := usd
	for i := range items {
		if !usdRem.IsPositive() {
			break
		}
		avail := items[i].total.Sub(items[i].used)
		if !avail.IsPositive() {
			continue
		}
		capacityUsd := avail.Mul(items[i].csr)
		if !capacityUsd.IsPositive() {
			continue
		}
		usdChunk := usdRem
		if capacityUsd.LessThan(usdChunk) {
			usdChunk = capacityUsd
		}
		creditChunk, err := credits.DollarsToCredits(usdChunk, items[i].csr)
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
			budgetItemID: items[i].id,
			credits:      creditChunk,
			usdChunk:     usdChunk,
		})
		items[i].used = items[i].used.Add(creditChunk)
		usdRem = usdRem.Sub(usdChunk)
	}
	if usdRem.IsPositive() {
		return nil, ErrInsufficientCredits
	}
	return out, nil
}

// budgetHasConsumableCapacity matches consumeBudgetCostUSD progress for a positive USD amount:
// at least one row with positive (credits_total−credits_used) and positive capacity USD (avail×ratio).
func budgetHasConsumableCapacity(items []budgetConsumptionState) bool {
	for i := range items {
		avail := items[i].total.Sub(items[i].used)
		if !avail.IsPositive() {
			continue
		}
		capacityUsd := avail.Mul(items[i].csr)
		if capacityUsd.IsPositive() {
			return true
		}
	}
	return false
}

// loadBudgetConsumptionStatesTx returns rows in consumption priority: renewable lines first
// (renew_interval set), then soonest expire_at, then stable tie-break.
func loadBudgetConsumptionStatesTx(ctx context.Context, tx *sql.Tx, budgetID string, forUpdate bool) ([]budgetConsumptionState, error) {
	q := `
		SELECT bi.id, bi.credits_total, bi.credits_used, bi.credit_spend_ratio
		FROM budget_items bi
		WHERE bi.budget_id = $1
		ORDER BY (bi.renew_interval IS NULL), bi.expire_at ASC NULLS LAST, bi.created_at, bi.id
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
		if err := rows.Scan(&st.id, &st.total, &st.used, &st.csr); err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, ErrNotFound
	}
	return out, nil
}

package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/shopspring/decimal"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/credits"
)

const lazyResetBatchSize = 500

type ItemInput struct {
	CreditsTotal    string
	CreditsUsed     string // optional: initial credits spent (for migration)
	CostCreditRatio string
	ExpiresAt       *string
	StartsAt        *string
	ResetsAt        *string
	ResetInterval   *string
	Label           *string
}

type PutItemInput struct {
	BudgetItemID    *string
	CreditsTotal    string
	CreditsUsed     string // only for new items (insert)
	CostCreditRatio string
	ExpiresAt       *string
	StartsAt        *string
	ResetsAt        *string
	ResetInterval   *string
	Label           *string
}

type SessionLine struct {
	Cost          string
	CallRequestID string
}

type SessionLineOut struct {
	Cost           string
	CreditsCharged string
	CallRequestID  string
}

// SessionAppendMathLine is PATCH session ?debug=1 payload: per-line credits plus which budget_items absorbed USD chunks.
type SessionAppendMathLine struct {
	CostUsd        string `json:"costUsd"`
	CreditsCharged string `json:"creditsCharged"`
	Allocations    []struct {
		BudgetItemID string `json:"budgetItemId"`
		UsdChunk     string `json:"usdChunk"`
		Credits      string `json:"credits"`
	} `json:"allocations"`
}

// BudgetConsumptionPreviewRow is one budget line in USD→credits priority order (read-only).
type BudgetConsumptionPreviewRow struct {
	BudgetItemID    string  `json:"budgetItemId"`
	CostCreditRatio string  `json:"costCreditRatio"`
	ResetInterval   *string `json:"resetInterval"`
	ExpiresAt       *string `json:"expiresAt"`
}

type ReportLineInput struct {
	BudgetCost  string
	ProductCost string
	Label       string
}

type ReportAllocationOut struct {
	BudgetItemID string
	CreditsUsed  string
}

type SessionReportItemOut struct {
	ReportItemID string
	BudgetCost   string
	ProductCost  string
	Label        string
	CreatedAt    time.Time
	BudgetItems  []ReportAllocationOut
}

type SessionReportDetail struct {
	ProductKey       string
	BudgetID         string
	SessionID        string
	ReportID         string
	BudgetCostTotal  string
	ProductCostTotal string
	CreditsAvailable string
	Items            []SessionReportItemOut
}

type BudgetDetail struct {
	BudgetID       string
	ProductKey     string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	DeletedAt      *time.Time
	CreditsTotal   string
	CreditsUsed    string
	CreditsPending string
	Items          []BudgetItemRow
}

type BudgetItemRow struct {
	ID              string
	CreditsTotal    string
	CreditsUsed     string
	CostCreditRatio string
	ExpiresAt       *time.Time
	StartsAt        *time.Time
	ResetsAt        *time.Time
	ResetInterval   *string
	Label           *string
	DeletedAt       *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type BudgetSessionDetail struct {
	BudgetID            string
	CostTotal           string
	CreditsChargedTotal string
	Metadata            []byte
	CreatedAt           time.Time
	UpdatedAt           time.Time
	ReconciledAt        *time.Time
	Lines               []SessionLineOut
}

func nullTimeRFC3339(p *string) (sql.NullTime, error) {
	if p == nil || strings.TrimSpace(*p) == "" {
		return sql.NullTime{}, nil
	}
	t, err := time.Parse(time.RFC3339, *p)
	if err != nil {
		return sql.NullTime{}, err
	}
	return sql.NullTime{Time: t, Valid: true}, nil
}

func resetIntervalForDB(p *string) (sql.NullString, error) {
	norm, err := NormalizeResetInterval(p)
	if err != nil {
		return sql.NullString{}, err
	}
	if norm == nil {
		return sql.NullString{}, nil
	}
	return sql.NullString{String: *norm, Valid: true}, nil
}

func labelForDB(p *string) sql.NullString {
	if p == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *p, Valid: true}
}

type preparedBudgetItemInsert struct {
	ID              string
	CreditsTotal    string
	CostCreditRatio string
	ExpiresAt       sql.NullTime
	StartsAt        sql.NullTime
	ResetsAt        sql.NullTime
	ResetInterval   sql.NullString
	Label           sql.NullString
	CreatedAt       time.Time
}

func prepareBudgetItemInsert(in ItemInput) (*preparedBudgetItemInsert, error) {
	exp, err := nullTimeRFC3339(in.ExpiresAt)
	if err != nil {
		return nil, err
	}
	st, err := nullTimeRFC3339(in.StartsAt)
	if err != nil {
		return nil, err
	}
	createdAt := time.Now().UTC()
	if !st.Valid {
		st = sql.NullTime{Time: createdAt, Valid: true}
	}
	rs, err := nullTimeRFC3339(in.ResetsAt)
	if err != nil {
		return nil, err
	}
	resetInterval, err := resetIntervalForDB(in.ResetInterval)
	if err != nil {
		return nil, err
	}
	if !rs.Valid && resetInterval.Valid {
		nextReset, err := NextResetAt(st.Time, resetInterval.String)
		if err != nil {
			return nil, err
		}
		rs = sql.NullTime{Time: nextReset, Valid: true}
	}
	return &preparedBudgetItemInsert{
		ID:              uuid.NewString(),
		CreditsTotal:    in.CreditsTotal,
		CostCreditRatio: in.CostCreditRatio,
		ExpiresAt:       exp,
		StartsAt:        st,
		ResetsAt:        rs,
		ResetInterval:   resetInterval,
		Label:           labelForDB(in.Label),
		CreatedAt:       createdAt,
	}, nil
}

func insertPreparedBudgetItem(ctx context.Context, tx *sql.Tx, budgetID string, prepared *preparedBudgetItemInsert) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO budget_items (
			id, budget_id, credits_total, credits_used, cost_credit_ratio,
			expires_at, starts_at, resets_at, reset_interval, label, created_at
		) VALUES ($1, $2, $3, 0, $4, $5, $6, $7, $8, $9, $10)
	`, prepared.ID, budgetID, prepared.CreditsTotal, prepared.CostCreditRatio,
		prepared.ExpiresAt, prepared.StartsAt, prepared.ResetsAt, prepared.ResetInterval, prepared.Label, prepared.CreatedAt)
	return err
}

func mapNotFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func mapFKNotFound(err error) error {
	var pqErr *pq.Error
	if errors.As(err, &pqErr) && pqErr.Code == "23503" {
		return ErrNotFound
	}
	return err
}

const sessionCallRequestUniqueConstraint = "budget_session_items_session_call_request_unique"

func mapReportSessionUnique(err error) error {
	var pqErr *pq.Error
	if errors.As(err, &pqErr) && pqErr.Code == "23505" {
		return ErrAlreadyReconciled
	}
	return err
}

func mapSessionCallRequestUnique(err error) error {
	var pqErr *pq.Error
	if errors.As(err, &pqErr) && pqErr.Code == "23505" && pqErr.Constraint == sessionCallRequestUniqueConstraint {
		return ErrDuplicateCallRequestID
	}
	return err
}

func applyDueResetsForBudgetTx(ctx context.Context, tx *sql.Tx, budgetID string) error {
	_, err := tx.ExecContext(ctx, `SELECT public.process_due_budget_item_resets($1::uuid, $2::integer)`, budgetID, lazyResetBatchSize)
	return err
}

func (s *Store) CreateBudget(ctx context.Context, budgetID, productKey string, items []ItemInput) error {
	if _, err := uuid.Parse(budgetID); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var lock int
	err = tx.QueryRowContext(ctx, `
		SELECT 1 FROM products WHERE product_key = $1 AND deleted_at IS NULL FOR UPDATE
	`, productKey).Scan(&lock)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrUnknownProductKey
		}
		return err
	}

	if _, err := tx.ExecContext(ctx, `INSERT INTO budgets (id, product_key) VALUES ($1, $2)`, budgetID, productKey); err != nil {
		return err
	}
	for i := range items {
		if _, err := insertBudgetItem(ctx, tx, budgetID, items[i]); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func insertBudgetItem(ctx context.Context, tx *sql.Tx, budgetID string, in ItemInput) (string, error) {
	prepared, err := prepareBudgetItemInsert(in)
	if err != nil {
		return "", err
	}
	if err := insertPreparedBudgetItem(ctx, tx, budgetID, prepared); err != nil {
		return "", err
	}

	// Insert initial_spend ledger entry if creditsUsed > 0.
	// The ledger trigger will automatically bump budget_items.credits_used.
	if in.CreditsUsed != "" {
		cu, err := decimal.NewFromString(in.CreditsUsed)
		if err != nil {
			return "", err
		}
		if cu.IsPositive() {
			_, err = tx.ExecContext(ctx, `
				INSERT INTO budget_item_credit_ledger (id, budget_item_id, entry_kind, credits_delta)
				VALUES ($1, $2, 'initial_spend', $3)
			`, uuid.NewString(), prepared.ID, credits.Format(cu))
			if err != nil {
				return "", err
			}
		}
	}

	return prepared.ID, nil
}

func insertBudgetItemsHistory(ctx context.Context, tx *sql.Tx, itemID, budgetID string) error {
	res, err := tx.ExecContext(ctx, `
		INSERT INTO budget_items_history (
			budget_item_id, budget_id, credits_total, credits_used, cost_credit_ratio,
			expires_at, starts_at, reset_interval, resets_at, label, item_created_at, item_updated_at
		)
		SELECT
			id, budget_id, credits_total, credits_used, cost_credit_ratio,
			expires_at, starts_at, reset_interval, resets_at, label, created_at, updated_at
		FROM budget_items
		WHERE id = $1 AND budget_id = $2 AND deleted_at IS NULL
	`, itemID, budgetID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) GetBudget(ctx context.Context, budgetID string) (*BudgetDetail, error) {
	if _, err := uuid.Parse(budgetID); err != nil {
		return nil, err
	}
	var d BudgetDetail
	var ct, cu, cp decimal.Decimal
	var pk sql.NullString
	var del sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT
			b.id,
			b.product_key,
			b.created_at,
			b.updated_at,
			b.deleted_at,
			COALESCE((SELECT SUM(credits_total) FROM budget_items bi WHERE bi.budget_id = b.id AND bi.deleted_at IS NULL), 0),
			COALESCE((SELECT SUM(bi.credits_used) FROM budget_items bi WHERE bi.budget_id = b.id AND bi.deleted_at IS NULL), 0),
			COALESCE((
				SELECT SUM(bsi.credits_charged)
				FROM budget_session_items bsi
				JOIN budget_sessions bs ON bs.id = bsi.session_id
				WHERE bs.budget_id = b.id AND bs.reconciled_at IS NULL
			), 0)
		FROM budgets b
		WHERE b.id = $1
	`, budgetID).Scan(
		&d.BudgetID, &pk, &d.CreatedAt, &d.UpdatedAt, &del,
		&ct, &cu, &cp,
	)
	if err != nil {
		return nil, mapNotFound(err)
	}
	if pk.Valid {
		d.ProductKey = pk.String
	}
	if del.Valid {
		t := del.Time
		d.DeletedAt = &t
	}
	d.CreditsTotal = credits.Format(ct)
	d.CreditsUsed = credits.Format(cu)
	d.CreditsPending = credits.Format(cp)

	rows, err := s.db.QueryContext(ctx, `
		SELECT
			bi.id,
			bi.credits_total,
			bi.credits_used,
			bi.cost_credit_ratio,
			bi.expires_at, bi.starts_at, bi.resets_at, bi.reset_interval, bi.label, bi.deleted_at, bi.created_at, bi.updated_at
		FROM budget_items bi
		WHERE bi.budget_id = $1
		ORDER BY bi.created_at, bi.id
	`, budgetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var r BudgetItemRow
		var exp, st, rs sql.NullTime
		var reset, lbl sql.NullString
		var ctot, cusd, csr decimal.Decimal
		var delItem sql.NullTime
		if err := rows.Scan(
			&r.ID, &ctot, &cusd, &csr,
			&exp, &st, &rs, &reset, &lbl, &delItem, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, err
		}
		r.CreditsTotal = credits.Format(ctot)
		r.CreditsUsed = credits.Format(cusd)
		r.CostCreditRatio = credits.Format(csr)
		if exp.Valid {
			t := exp.Time
			r.ExpiresAt = &t
		}
		if st.Valid {
			t := st.Time
			r.StartsAt = &t
		}
		if rs.Valid {
			t := rs.Time
			r.ResetsAt = &t
		}
		if reset.Valid {
			sv := reset.String
			r.ResetInterval = &sv
		}
		if lbl.Valid {
			ls := lbl.String
			r.Label = &ls
		}
		if delItem.Valid {
			t := delItem.Time
			r.DeletedAt = &t
		}
		d.Items = append(d.Items, r)
	}
	return &d, rows.Err()
}

func (s *Store) GetBudgetItem(ctx context.Context, budgetID, itemID string) (*BudgetItemRow, error) {
	if _, err := uuid.Parse(budgetID); err != nil {
		return nil, err
	}
	if _, err := uuid.Parse(itemID); err != nil {
		return nil, err
	}
	var r BudgetItemRow
	var exp, st, rs sql.NullTime
	var reset, lbl sql.NullString
	var ctot, cusd, csr decimal.Decimal
	var delItem sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT
			bi.id,
			bi.credits_total,
			bi.credits_used,
			bi.cost_credit_ratio,
			bi.expires_at, bi.starts_at, bi.resets_at, bi.reset_interval, bi.label, bi.deleted_at, bi.created_at, bi.updated_at
		FROM budget_items bi
		WHERE bi.id = $1 AND bi.budget_id = $2
	`, itemID, budgetID).Scan(
		&r.ID, &ctot, &cusd, &csr,
		&exp, &st, &rs, &reset, &lbl, &delItem, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return nil, mapNotFound(err)
	}
	r.CreditsTotal = credits.Format(ctot)
	r.CreditsUsed = credits.Format(cusd)
	r.CostCreditRatio = credits.Format(csr)
	if exp.Valid {
		t := exp.Time
		r.ExpiresAt = &t
	}
	if st.Valid {
		t := st.Time
		r.StartsAt = &t
	}
	if rs.Valid {
		t := rs.Time
		r.ResetsAt = &t
	}
	if reset.Valid {
		sv := reset.String
		r.ResetInterval = &sv
	}
	if lbl.Valid {
		ls := lbl.String
		r.Label = &ls
	}
	if delItem.Valid {
		t := delItem.Time
		r.DeletedAt = &t
	}
	return &r, nil
}

func (s *Store) UpdateBudgetItems(ctx context.Context, budgetID string, items []PutItemInput) error {
	if _, err := uuid.Parse(budgetID); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM budgets WHERE id = $1 AND deleted_at IS NULL`, budgetID).Scan(&exists); err != nil {
		return mapNotFound(err)
	}

	for i := range items {
		it := items[i]
		if it.BudgetItemID == nil || strings.TrimSpace(*it.BudgetItemID) == "" {
			return fmt.Errorf("UpdateBudgetItems: budgetItemId is required for each item")
		}
		itemID := strings.TrimSpace(*it.BudgetItemID)
		if _, err := uuid.Parse(itemID); err != nil {
			return err
		}
		exp, err := nullTimeRFC3339(it.ExpiresAt)
		if err != nil {
			return err
		}
		st, err := nullTimeRFC3339(it.StartsAt)
		if err != nil {
			return err
		}
		rs, err := nullTimeRFC3339(it.ResetsAt)
		if err != nil {
			return err
		}
		resetInterval, err := resetIntervalForDB(it.ResetInterval)
		if err != nil {
			return err
		}
		lbl := labelForDB(it.Label)
		if err := insertBudgetItemsHistory(ctx, tx, itemID, budgetID); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `
			UPDATE budget_items SET
				credits_total = $1,
				cost_credit_ratio = $2,
				expires_at = $3,
				starts_at = $4,
				resets_at = $5,
				reset_interval = $6,
				label = $7
			WHERE id = $8 AND budget_id = $9 AND deleted_at IS NULL
		`, it.CreditsTotal, it.CostCreditRatio,
			exp, st, rs, resetInterval, lbl, itemID, budgetID)
		if err != nil {
			return err
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			return ErrNotFound
		}
	}
	return tx.Commit()
}

func (s *Store) InsertBudgetItem(ctx context.Context, budgetID string, in ItemInput) (string, error) {
	if _, err := uuid.Parse(budgetID); err != nil {
		return "", err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()

	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM budgets WHERE id = $1 AND deleted_at IS NULL`, budgetID).Scan(&exists); err != nil {
		return "", mapNotFound(err)
	}
	id, err := insertBudgetItem(ctx, tx, budgetID, in)
	if err != nil {
		return "", err
	}
	return id, tx.Commit()
}

func (s *Store) UpdateBudgetItem(ctx context.Context, budgetID, itemID string, in ItemInput) error {
	if _, err := uuid.Parse(budgetID); err != nil {
		return err
	}
	if _, err := uuid.Parse(itemID); err != nil {
		return err
	}
	exp, err := nullTimeRFC3339(in.ExpiresAt)
	if err != nil {
		return err
	}
	st, err := nullTimeRFC3339(in.StartsAt)
	if err != nil {
		return err
	}
	rs, err := nullTimeRFC3339(in.ResetsAt)
	if err != nil {
		return err
	}
	resetInterval, err := resetIntervalForDB(in.ResetInterval)
	if err != nil {
		return err
	}
	lbl := labelForDB(in.Label)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := insertBudgetItemsHistory(ctx, tx, itemID, budgetID); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `
		UPDATE budget_items SET
			credits_total = $1,
			cost_credit_ratio = $2,
			expires_at = $3,
			starts_at = $4,
			resets_at = $5,
			reset_interval = $6,
			label = $7
		WHERE id = $8 AND budget_id = $9 AND deleted_at IS NULL
	`, in.CreditsTotal, in.CostCreditRatio,
		exp, st, rs, resetInterval, lbl, itemID, budgetID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

func (s *Store) CreateBudgetSession(ctx context.Context, budgetID, sessionID string, metadataJSON []byte) error {
	if _, err := uuid.Parse(budgetID); err != nil {
		return err
	}
	if _, err := uuid.Parse(sessionID); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var budgetOK int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM budgets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, budgetID).Scan(&budgetOK); err != nil {
		return mapNotFound(err)
	}
	if err := applyDueResetsForBudgetTx(ctx, tx, budgetID); err != nil {
		return err
	}

	// Read-only capacity check — no FOR UPDATE needed since we only INSERT into budget_sessions,
	// not mutate budget_items. This avoids serializing session opens behind spend transactions.
	states, err := loadBudgetConsumptionStatesTx(ctx, tx, budgetID, false)
	if err != nil {
		return err
	}
	if !budgetHasConsumableCapacity(states, time.Now()) {
		return ErrNoSessionCapacity
	}

	var metaArg any
	if len(metadataJSON) > 0 {
		metaArg = metadataJSON
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO budget_sessions (id, budget_id, metadata) VALUES ($1, $2, $3)
	`, sessionID, budgetID, metaArg); err != nil {
		return mapFKNotFound(err)
	}
	return tx.Commit()
}

// BudgetConsumptionPreview lists budget_items in the same order as consumeBudgetCostUSD (for GET session ?debug=1).
func (s *Store) BudgetConsumptionPreview(ctx context.Context, budgetID string) ([]BudgetConsumptionPreviewRow, error) {
	if _, err := uuid.Parse(budgetID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, cost_credit_ratio::text, reset_interval, expires_at
		FROM budget_items
		WHERE budget_id = $1 AND deleted_at IS NULL
		ORDER BY (reset_interval IS NULL), expires_at ASC NULLS LAST, created_at, id
	`, budgetID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []BudgetConsumptionPreviewRow
	for rows.Next() {
		var r BudgetConsumptionPreviewRow
		var reset sql.NullString
		var exp sql.NullTime
		if err := rows.Scan(&r.BudgetItemID, &r.CostCreditRatio, &reset, &exp); err != nil {
			return nil, err
		}
		if reset.Valid {
			sv := reset.String
			r.ResetInterval = &sv
		}
		if exp.Valid {
			s := exp.Time.UTC().Format(time.RFC3339Nano)
			r.ExpiresAt = &s
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// DebugSessionCreditsReplay re-runs consumeBudgetCostUSDSession for each stored line in id order against current
// budget_items.credits_used (read-only). Mismatch vs credits_charged means items/ratios changed after append.
func (s *Store) DebugSessionCreditsReplay(ctx context.Context, sessionID string) ([]string, error) {
	if _, err := uuid.Parse(sessionID); err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var budgetID string
	err = tx.QueryRowContext(ctx, `
		SELECT budget_id FROM budget_sessions WHERE id = $1 AND reconciled_at IS NULL
	`, sessionID).Scan(&budgetID)
	if err != nil {
		return nil, mapNotFound(err)
	}

	states, err := loadBudgetConsumptionStatesTx(ctx, tx, budgetID, false)
	if err != nil {
		if errors.Is(err, ErrNoBudgetItems) {
			return []string{}, nil
		}
		return nil, err
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT cost_usd FROM budget_session_items WHERE session_id = $1 ORDER BY id
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var totals []string
	now := time.Now()
	for rows.Next() {
		var costD decimal.Decimal
		if err := rows.Scan(&costD); err != nil {
			return nil, err
		}
		chunks, err := consumeBudgetCostUSDSession(costD, states, now)
		if err != nil {
			return nil, err
		}
		var sum decimal.Decimal
		for i := range chunks {
			sum = sum.Add(chunks[i].credits)
		}
		totals = append(totals, credits.Format(sum))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return totals, nil
}

// AppendSessionItems records GoCode USD per line and credits_charged from priority consumption.
// Prior lines are replayed first so a second PATCH sees the same virtual pool as if one batch had been sent.
// On success, the returned budgetID is the session's budget (for callers that need it without a follow-up load).
//
// Uses optimistic concurrency: a read transaction locks the session, applies due interval resets
// and commits, then computes allocations without locking budget_items. A short write transaction
// locks budget_items, verifies credits_used, and inserts. This shortens the budget_items lock
// window from full replay+compute+insert to verify+insert.
func (s *Store) AppendSessionItems(ctx context.Context, sessionID string, lines []SessionLine) ([]SessionAppendMathLine, string, error) {
	if _, err := uuid.Parse(sessionID); err != nil {
		return nil, "", err
	}

	const maxRetries = 3
	for attempt := range maxRetries {
		out, budgetID, retry, err := s.appendSessionItemsOptimistic(ctx, sessionID, lines)
		if err != nil {
			if retry && attempt < maxRetries-1 {
				// Jitter before retry to spread out concurrent retriers.
				jitter := time.Duration(attempt+1)*5*time.Millisecond + time.Duration(rand.IntN(5))*time.Millisecond
				time.Sleep(jitter)
				continue
			}
			return nil, "", err
		}
		return out, budgetID, nil
	}
	// Unreachable: the loop always returns, but the compiler requires this.
	return nil, "", ErrOptimisticRetryExhausted
}

// appendSessionItemsOptimistic runs one attempt of the two-phase optimistic append.
// Returns retry=true if budget_items.credits_used changed between the read and write phases.
func (s *Store) appendSessionItemsOptimistic(ctx context.Context, sessionID string, lines []SessionLine) (
	[]SessionAppendMathLine, string, bool, error,
) {
	// ── Phase 1: Read — lock session, load states WITHOUT locking budget_items, replay + compute. ──

	readTx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, "", false, err
	}
	readCommitted := false
	defer func() {
		if !readCommitted {
			_ = readTx.Rollback()
		}
	}()

	// Lock the session row to serialize concurrent PATCHes against the same session.
	var budgetID string
	err = readTx.QueryRowContext(ctx, `
		SELECT bs.budget_id FROM budget_sessions bs
		INNER JOIN budgets b ON b.id = bs.budget_id AND b.deleted_at IS NULL
		WHERE bs.id = $1 AND bs.reconciled_at IS NULL
		FOR UPDATE OF bs
	`, sessionID).Scan(&budgetID)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, "", false, err
		}
		var rec sql.NullTime
		err = readTx.QueryRowContext(ctx, `
			SELECT reconciled_at FROM budget_sessions WHERE id = $1
		`, sessionID).Scan(&rec)
		if err != nil {
			return nil, "", false, mapNotFound(err)
		}
		if rec.Valid {
			return nil, "", false, ErrAlreadyReconciled
		}
		return nil, "", false, ErrNotFound
	}

	// Apply due resets in this transaction and commit (below) so Phase 2 verification never
	// undoes a reset on rollback — that was the cause of spurious 409s when a reset fired in writeTx.
	if err := applyDueResetsForBudgetTx(ctx, readTx, budgetID); err != nil {
		return nil, "", false, err
	}

	// Load budget_items WITHOUT FOR UPDATE — this is the key optimization.
	states, err := loadBudgetConsumptionStatesTx(ctx, readTx, budgetID, false)
	if err != nil {
		return nil, "", false, err
	}

	// Snapshot credits_used per item before consumption for optimistic verification.
	usedSnapshot := make(map[string]decimal.Decimal, len(states))
	for _, st := range states {
		usedSnapshot[st.id] = st.used
	}

	now := time.Now()

	// Replay existing lines so new lines stack on the same consumption order.
	// Track count for stale-replay detection in Phase 2.
	var priorItemCount int
	priorRows, err := readTx.QueryContext(ctx, `
		SELECT cost_usd FROM budget_session_items WHERE session_id = $1 ORDER BY id
	`, sessionID)
	if err != nil {
		return nil, "", false, err
	}
	for priorRows.Next() {
		priorItemCount++
		var costD decimal.Decimal
		if err := priorRows.Scan(&costD); err != nil {
			_ = priorRows.Close()
			return nil, "", false, err
		}
		if _, err := consumeBudgetCostUSDSession(costD, states, now); err != nil {
			_ = priorRows.Close()
			return nil, "", false, err
		}
	}
	if err := priorRows.Close(); err != nil {
		return nil, "", false, err
	}
	if err := priorRows.Err(); err != nil {
		return nil, "", false, err
	}

	// Compute new line allocations.
	type precomputedLine struct {
		costStr    string
		chargedStr string
		chunks     []budgetCreditChunk
	}
	precomputed := make([]precomputedLine, 0, len(lines))
	for i := range lines {
		costD, err := credits.ParseNonNegative(lines[i].Cost)
		if err != nil {
			return nil, "", false, err
		}
		costStr := credits.Format(costD)
		chunks, err := consumeBudgetCostUSDSession(costD, states, now)
		if err != nil {
			return nil, "", false, err
		}
		var chargedSum decimal.Decimal
		for j := range chunks {
			chargedSum = chargedSum.Add(chunks[j].credits)
		}
		precomputed = append(precomputed, precomputedLine{
			costStr:    costStr,
			chargedStr: credits.Format(chargedSum),
			chunks:     chunks,
		})
	}

	if err := readTx.Commit(); err != nil {
		return nil, "", false, err
	}
	readCommitted = true

	// ── Phase 2: Write — lock budget_items, verify snapshot, insert rows. ──

	writeTx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, "", false, err
	}
	defer func() { _ = writeTx.Rollback() }()

	// Re-lock session row in write tx.
	var budgetIDCheck string
	err = writeTx.QueryRowContext(ctx, `
		SELECT bs.budget_id FROM budget_sessions bs
		INNER JOIN budgets b ON b.id = bs.budget_id AND b.deleted_at IS NULL
		WHERE bs.id = $1 AND bs.reconciled_at IS NULL
		FOR UPDATE OF bs
	`, sessionID).Scan(&budgetIDCheck)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, "", false, ErrAlreadyReconciled
		}
		return nil, "", false, err
	}

	// Verify the session still points at the same budget as Phase 1.
	// This is not a transient conflict — retrying won't help.
	if budgetIDCheck != budgetID {
		return nil, "", false, ErrBudgetMismatch
	}

	// Verify no other writer added items to this session between phases.
	var currentItemCount int
	err = writeTx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM budget_session_items WHERE session_id = $1
	`, sessionID).Scan(&currentItemCount)
	if err != nil {
		return nil, "", false, err
	}
	if currentItemCount != priorItemCount {
		// Another PATCH slipped in between phases — retry with fresh replay.
		return nil, "", true, ErrOptimisticRetryExhausted
	}

	// Re-run lazy resets: usually no-op (Phase 1 already committed), but a reset that becomes
	// due in the gap after readTx commit must run before we insert. If that changes
	// credits_used vs. usedSnapshot, we retry — one slot may burn on a rare interval edge.
	// (Do not move this after the optimistic check while still inserting precomputed lines from
	// Phase 1: a fresh reset there would require recomputing allocations, not a line reorder.)
	if err := applyDueResetsForBudgetTx(ctx, writeTx, budgetIDCheck); err != nil {
		return nil, "", false, err
	}

	// Lock and load budget_items — this is the critical section we've shortened.
	currentStates, err := loadBudgetConsumptionStatesTx(ctx, writeTx, budgetIDCheck, true)
	if err != nil {
		return nil, "", false, err
	}

	// Optimistic verification: check that credits_used hasn't changed since Phase 1.
	for _, cur := range currentStates {
		if prev, ok := usedSnapshot[cur.id]; ok {
			if !cur.used.Equal(prev) {
				// Another transaction modified credits_used — retry.
				return nil, "", true, ErrOptimisticRetryExhausted
			}
		}
		// New items that appeared after Phase 1 are fine — they don't invalidate our computation.
	}
	// Items that disappeared (deleted between phases) would cause insert FK failures below.

	// Insert the precomputed rows.
	out := make([]SessionAppendMathLine, 0, len(lines))
	for i := range precomputed {
		pc := &precomputed[i]
		if _, err = writeTx.ExecContext(ctx, `
			INSERT INTO budget_session_items (session_id, cost_usd, credits_charged, call_request_id)
			VALUES ($1, $2, $3, $4)
		`, sessionID, pc.costStr, pc.chargedStr, lines[i].CallRequestID); err != nil {
			return nil, "", false, mapSessionCallRequestUnique(err)
		}
		math := SessionAppendMathLine{CostUsd: pc.costStr, CreditsCharged: pc.chargedStr}
		for j := range pc.chunks {
			math.Allocations = append(math.Allocations, struct {
				BudgetItemID string `json:"budgetItemId"`
				UsdChunk     string `json:"usdChunk"`
				Credits      string `json:"credits"`
			}{
				BudgetItemID: pc.chunks[j].budgetItemID,
				UsdChunk:     credits.Format(pc.chunks[j].usdChunk),
				Credits:      credits.Format(pc.chunks[j].credits),
			})
		}
		out = append(out, math)
	}
	if _, err = writeTx.ExecContext(ctx, `UPDATE budget_sessions SET updated_at = now() WHERE id = $1`, sessionID); err != nil {
		return nil, "", false, err
	}
	if err := writeTx.Commit(); err != nil {
		return nil, "", false, err
	}
	return out, budgetID, false, nil
}

func (s *Store) GetBudgetSession(ctx context.Context, sessionID string) (*BudgetSessionDetail, error) {
	if _, err := uuid.Parse(sessionID); err != nil {
		return nil, err
	}
	var d BudgetSessionDetail
	var rec sql.NullTime
	var costSum, creditSum decimal.Decimal
	var metadata []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT
			bs.budget_id,
			bs.metadata,
			bs.created_at,
			bs.updated_at,
			bs.reconciled_at,
			COALESCE((SELECT SUM(cost_usd) FROM budget_session_items WHERE session_id = bs.id), 0),
			COALESCE((SELECT SUM(credits_charged) FROM budget_session_items WHERE session_id = bs.id), 0)
		FROM budget_sessions bs
		WHERE bs.id = $1 AND bs.reconciled_at IS NULL
	`, sessionID).Scan(&d.BudgetID, &metadata, &d.CreatedAt, &d.UpdatedAt, &rec, &costSum, &creditSum)
	if err != nil {
		return nil, mapNotFound(err)
	}
	d.Metadata = metadata
	if rec.Valid {
		t := rec.Time
		d.ReconciledAt = &t
	}
	d.CostTotal = credits.Format(costSum)
	d.CreditsChargedTotal = credits.Format(creditSum)

	rows, err := s.db.QueryContext(ctx, `
		SELECT cost_usd, credits_charged, call_request_id FROM budget_session_items WHERE session_id = $1 ORDER BY id
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var line SessionLineOut
		var costD, chD decimal.Decimal
		if err := rows.Scan(&costD, &chD, &line.CallRequestID); err != nil {
			return nil, err
		}
		line.Cost = credits.Format(costD)
		line.CreditsCharged = credits.Format(chD)
		d.Lines = append(d.Lines, line)
	}
	return &d, rows.Err()
}

// CreateSessionReport applies each report line's budgetCost USD using the same per-item consumption rules as session PATCH.
func (s *Store) CreateSessionReport(ctx context.Context, sessionID string, items []ReportLineInput) (string, string, error) {
	if _, err := uuid.Parse(sessionID); err != nil {
		return "", "", err
	}
	if len(items) == 0 {
		return "", "", credits.ErrInvalid
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", "", err
	}
	defer func() { _ = tx.Rollback() }()

	var budgetID string
	var rec sql.NullTime
	err = tx.QueryRowContext(ctx, `
		SELECT bs.budget_id, bs.reconciled_at
		FROM budget_sessions bs
		INNER JOIN budgets b ON b.id = bs.budget_id AND b.deleted_at IS NULL
		WHERE bs.id = $1
		FOR UPDATE OF bs
	`, sessionID).Scan(&budgetID, &rec)
	if err != nil {
		return "", "", mapNotFound(err)
	}
	if rec.Valid {
		return "", "", ErrAlreadyReconciled
	}

	// Get productKey for webhook payload
	var productKey sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT product_key FROM budgets WHERE id = $1`, budgetID).Scan(&productKey); err != nil {
		return "", "", err
	}

	if err := applyDueResetsForBudgetTx(ctx, tx, budgetID); err != nil {
		return "", "", err
	}

	// One mutable snapshot across all report lines; later lines see credits_used from earlier lines in this tx (trigger bumps column on ledger insert).
	budgetItems, err := loadBudgetConsumptionStatesTx(ctx, tx, budgetID, true)
	if err != nil {
		return "", "", err
	}

	// Track which items are NOT yet exhausted before consumption (for exhausted webhook detection)
	notYetExhausted := make(map[string]bool, len(budgetItems))
	for _, bi := range budgetItems {
		if bi.used.LessThan(bi.total) {
			notYetExhausted[bi.id] = true
		}
	}

	now := time.Now()

	reportID := uuid.NewString()
	if _, err := tx.ExecContext(ctx, `INSERT INTO budget_session_reports (id, session_id) VALUES ($1, $2)`, reportID, sessionID); err != nil {
		return "", "", mapReportSessionUnique(err)
	}

	// Track totals and items for webhook payload
	var budgetCostTotal, productCostTotal decimal.Decimal
	reportItemsPayload := make([]ReportItemPayload, 0, len(items))

	for i := range items {
		bc, err := credits.ParseNonNegative(items[i].BudgetCost)
		if err != nil {
			return "", "", err
		}
		pc, err := credits.ParseNonNegative(items[i].ProductCost)
		if err != nil {
			return "", "", err
		}

		budgetCostTotal = budgetCostTotal.Add(bc)
		productCostTotal = productCostTotal.Add(pc)

		itemID := uuid.NewString()
		_, err = tx.ExecContext(ctx, `
			INSERT INTO budget_session_report_items (id, report_id, budget_cost, product_cost, label)
			VALUES ($1, $2, $3, $4, $5)
		`, itemID, reportID, credits.Format(bc), credits.Format(pc), strings.TrimSpace(items[i].Label))
		if err != nil {
			return "", "", err
		}

		chunks, err := consumeBudgetCostUSD(bc, budgetItems, now)
		if err != nil {
			return "", "", err
		}

		// Track allocations for webhook payload
		allocations := make([]ReportItemAllocationPayload, 0, len(chunks))

		for j := range chunks {
			takeStr := credits.Format(chunks[j].credits)
			if _, err = tx.ExecContext(ctx, `
				INSERT INTO budget_session_report_item_allocations (report_item_id, budget_item_id, credits_used)
				VALUES ($1, $2, $3)
			`, itemID, chunks[j].budgetItemID, takeStr); err != nil {
				return "", "", err
			}
			if _, err = tx.ExecContext(ctx, `
				INSERT INTO budget_item_credit_ledger (id, budget_item_id, entry_kind, credits_delta, report_item_id)
				VALUES ($1, $2, 'session_spend', $3, $4)
			`, uuid.NewString(), chunks[j].budgetItemID, takeStr, itemID); err != nil {
				return "", "", err
			}

			allocations = append(allocations, ReportItemAllocationPayload{
				BudgetItemID: chunks[j].budgetItemID,
				CreditsUsed:  takeStr,
			})
		}

		reportItemsPayload = append(reportItemsPayload, ReportItemPayload{
			ReportItemID: itemID,
			BudgetCost:   credits.Format(bc),
			ProductCost:  credits.Format(pc),
			Label:        strings.TrimSpace(items[i].Label),
			CreatedAt:    now,
			BudgetItems:  allocations,
		})
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE budget_sessions
		SET reconciled_at = COALESCE(reconciled_at, now()), updated_at = now()
		WHERE id = $1
	`, sessionID); err != nil {
		return "", "", err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE budgets SET updated_at = now() WHERE id = $1`, budgetID); err != nil {
		return "", "", err
	}

	// Calculate credits available after all allocations and detect newly exhausted items
	var creditsAvailable decimal.Decimal
	var newlyExhausted []budgetConsumptionState
	for _, bi := range budgetItems {
		remaining := bi.total.Sub(bi.used)
		if remaining.IsPositive() {
			creditsAvailable = creditsAvailable.Add(remaining)
		} else if notYetExhausted[bi.id] {
			// Item transitioned from non-exhausted to exhausted in this report
			newlyExhausted = append(newlyExhausted, bi)
		}
	}

	// Insert outbox events for webhook delivery if productKey exists
	if productKey.Valid && productKey.String != "" {
		// Insert exhausted events for items that became fully consumed
		for _, bi := range newlyExhausted {
			exhaustedPayload := ExhaustedResult{
				BudgetItemID: bi.id,
				BudgetID:     budgetID,
				SessionID:    sessionID,
				ReportID:     reportID,
				CreditsTotal: bi.total,
			}
			// Idempotency key: {event-type}:{itemId}:{reportId} - prevents duplicate webhooks for same exhaustion
			idempotencyKey := "budget-item.exhausted:" + bi.id + ":" + reportID
			if err := InsertOutboxEventTx(ctx, tx, "budget-item.exhausted", productKey.String, exhaustedPayload.ToPayload(), idempotencyKey); err != nil {
				return "", "", err
			}
		}

		payload := ReportCreatedPayload{
			ProductKey:       productKey.String,
			BudgetID:         budgetID,
			SessionID:        sessionID,
			ReportID:         reportID,
			BudgetCostTotal:  budgetCostTotal,
			ProductCostTotal: productCostTotal,
			CreditsAvailable: creditsAvailable,
			ReportItems:      reportItemsPayload,
		}

		idempotencyKey := "report.created:" + reportID
		if err := InsertOutboxEventTx(ctx, tx, "report.created", productKey.String, payload.ToPayload(), idempotencyKey); err != nil {
			return "", "", err
		}
	}

	if err := tx.Commit(); err != nil {
		return "", "", err
	}
	return reportID, budgetID, nil
}

func (s *Store) GetSessionReport(ctx context.Context, sessionID, reportID string) (*SessionReportDetail, error) {
	if _, err := uuid.Parse(sessionID); err != nil {
		return nil, err
	}
	if _, err := uuid.Parse(reportID); err != nil {
		return nil, err
	}
	var d SessionReportDetail
	var pk sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT br.id, b.id, bs.id, b.product_key
		FROM budget_session_reports br
		JOIN budget_sessions bs ON bs.id = br.session_id
		JOIN budgets b ON b.id = bs.budget_id
		WHERE br.id = $1 AND bs.id = $2
	`, reportID, sessionID).Scan(&d.ReportID, &d.BudgetID, &d.SessionID, &pk)
	if err != nil {
		return nil, mapNotFound(err)
	}
	if pk.Valid {
		d.ProductKey = pk.String
	}

	var bcTot, pcTot, credAvail decimal.Decimal
	budgetID := d.BudgetID
	err = s.db.QueryRowContext(ctx, `
		SELECT
			COALESCE((SELECT SUM(budget_cost) FROM budget_session_report_items WHERE report_id = $1), 0),
			COALESCE((SELECT SUM(product_cost) FROM budget_session_report_items WHERE report_id = $1), 0),
			COALESCE((SELECT SUM(bi.credits_total - bi.credits_used) FROM budget_items bi WHERE bi.budget_id = $2 AND bi.deleted_at IS NULL), 0)
	`, reportID, budgetID).Scan(&bcTot, &pcTot, &credAvail)
	if err != nil {
		return nil, err
	}
	d.BudgetCostTotal = credits.Format(bcTot)
	d.ProductCostTotal = credits.Format(pcTot)
	d.CreditsAvailable = credits.Format(credAvail)

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, budget_cost, product_cost, label, created_at
		FROM budget_session_report_items
		WHERE report_id = $1
		ORDER BY created_at, id
	`, reportID)
	if err != nil {
		return nil, err
	}
	var pending []SessionReportItemOut
	for rows.Next() {
		var it SessionReportItemOut
		var bcd, pcd decimal.Decimal
		if err := rows.Scan(&it.ReportItemID, &bcd, &pcd, &it.Label, &it.CreatedAt); err != nil {
			_ = rows.Close()
			return nil, err
		}
		it.BudgetCost = credits.Format(bcd)
		it.ProductCost = credits.Format(pcd)
		pending = append(pending, it)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i := range pending {
		arows, err := s.db.QueryContext(ctx, `
			SELECT budget_item_id, credits_used
			FROM budget_session_report_item_allocations
			WHERE report_item_id = $1
			ORDER BY budget_item_id
		`, pending[i].ReportItemID)
		if err != nil {
			return nil, err
		}
		for arows.Next() {
			var a ReportAllocationOut
			var cu decimal.Decimal
			if err := arows.Scan(&a.BudgetItemID, &cu); err != nil {
				_ = arows.Close()
				return nil, err
			}
			a.CreditsUsed = credits.Format(cu)
			pending[i].BudgetItems = append(pending[i].BudgetItems, a)
		}
		if err := arows.Close(); err != nil {
			return nil, err
		}
		if err := arows.Err(); err != nil {
			return nil, err
		}
	}
	d.Items = pending
	return &d, nil
}

func (s *Store) SoftDeleteBudget(ctx context.Context, budgetID string) error {
	if _, err := uuid.Parse(budgetID); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var budgetDeleted sql.NullTime
	if err := tx.QueryRowContext(ctx, `
		SELECT deleted_at FROM budgets WHERE id = $1 FOR UPDATE
	`, budgetID).Scan(&budgetDeleted); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if budgetDeleted.Valid {
		return ErrNotFound
	}
	var openSessions int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM budget_sessions WHERE budget_id = $1 AND reconciled_at IS NULL
	`, budgetID).Scan(&openSessions); err != nil {
		return err
	}
	if openSessions > 0 {
		return ErrBudgetHasUnreconciledSessions
	}
	res, err := tx.ExecContext(ctx, `
		UPDATE budgets SET deleted_at = now(), updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
	`, budgetID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE budget_items SET deleted_at = now(), updated_at = now()
		WHERE budget_id = $1 AND deleted_at IS NULL
	`, budgetID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SoftDeleteBudgetItem(ctx context.Context, budgetID, itemID string) error {
	if _, err := uuid.Parse(budgetID); err != nil {
		return err
	}
	if _, err := uuid.Parse(itemID); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var budgetDeleted sql.NullTime
	if err := tx.QueryRowContext(ctx, `
		SELECT deleted_at FROM budgets WHERE id = $1 FOR UPDATE
	`, budgetID).Scan(&budgetDeleted); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if budgetDeleted.Valid {
		return ErrNotFound
	}
	var openSessions int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM budget_sessions WHERE budget_id = $1 AND reconciled_at IS NULL
	`, budgetID).Scan(&openSessions); err != nil {
		return err
	}
	if openSessions > 0 {
		return ErrBudgetHasUnreconciledSessions
	}
	res, err := tx.ExecContext(ctx, `
		UPDATE budget_items SET deleted_at = now(), updated_at = now()
		WHERE id = $1 AND budget_id = $2 AND deleted_at IS NULL
	`, itemID, budgetID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// ResetResult holds info about a budget item reset for webhook delivery.
type ResetResult struct {
	BudgetItemID  string
	BudgetID      string
	ProductKey    string
	CreditsReset  decimal.Decimal
	CreditsTotal  decimal.Decimal
	NextResetsAt  time.Time
	ResetInterval string
}

// ToPayload converts to webhook payload format.
func (r *ResetResult) ToPayload() map[string]any {
	return map[string]any{
		"budgetItemId":  r.BudgetItemID,
		"budgetId":      r.BudgetID,
		"creditsReset":  credits.Format(r.CreditsReset),
		"creditsTotal":  credits.Format(r.CreditsTotal),
		"nextResetsAt":  r.NextResetsAt.UTC().Format(time.RFC3339Nano),
		"resetInterval": r.ResetInterval,
	}
}

// ProcessDueResetsWithOutbox processes due resets and inserts outbox events atomically.
// This replaces the pg_cron job functionality. Items with credits_used > 0 get a periodic_reset
// ledger entry to zero their usage; all due items get resets_at advanced to the next future boundary.
// Returns the count of items processed.
func (s *Store) ProcessDueResetsWithOutbox(ctx context.Context, batchSize int) (int, error) {
	if batchSize < 1 {
		batchSize = 500
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, `
		SELECT bi.id, bi.budget_id, b.product_key, bi.credits_used,
		       bi.credits_total, bi.resets_at, bi.reset_interval
		FROM budget_items bi
		JOIN budgets b ON b.id = bi.budget_id AND b.deleted_at IS NULL
		WHERE bi.resets_at IS NOT NULL
		  AND bi.reset_interval IS NOT NULL
		  AND bi.resets_at <= now()
		  AND bi.deleted_at IS NULL
		ORDER BY bi.resets_at, bi.id
		LIMIT $1
		FOR UPDATE OF bi SKIP LOCKED
	`, batchSize)
	if err != nil {
		return 0, err
	}

	type dueItem struct {
		id            string
		budgetID      string
		productKey    sql.NullString
		creditsUsed   decimal.Decimal
		creditsTotal  decimal.Decimal
		resetsAt      time.Time
		resetInterval string
	}
	var items []dueItem
	for rows.Next() {
		var item dueItem
		if err := rows.Scan(&item.id, &item.budgetID, &item.productKey,
			&item.creditsUsed, &item.creditsTotal, &item.resetsAt, &item.resetInterval); err != nil {
			_ = rows.Close()
			return 0, err
		}
		items = append(items, item)
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	if len(items) == 0 {
		return 0, tx.Commit()
	}

	// Get DB timestamp once for consistent clock reference (avoids app/DB clock skew)
	var dbNow time.Time
	if err := tx.QueryRowContext(ctx, `SELECT now()`).Scan(&dbNow); err != nil {
		return 0, err
	}

	for _, item := range items {
		// Compute next reset boundary
		nextResetsAt, err := NextResetAt(item.resetsAt, item.resetInterval)
		if err != nil {
			return 0, err
		}
		// Advance until future (handles long gaps)
		for !nextResetsAt.After(dbNow) {
			nextResetsAt, err = NextResetAt(nextResetsAt, item.resetInterval)
			if err != nil {
				return 0, err
			}
		}

		// Insert ledger entry if credits were used
		if item.creditsUsed.IsPositive() {
			ledgerID := uuid.NewString()
			deltaStr := credits.Format(item.creditsUsed.Neg())
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO budget_item_credit_ledger (id, budget_item_id, entry_kind, credits_delta, report_item_id)
				VALUES ($1, $2, 'periodic_reset', $3, NULL)
			`, ledgerID, item.id, deltaStr); err != nil {
				return 0, err
			}
		}

		// Update resets_at to next boundary
		if _, err := tx.ExecContext(ctx, `
			UPDATE budget_items SET resets_at = $1 WHERE id = $2
		`, nextResetsAt, item.id); err != nil {
			return 0, err
		}

		// Insert outbox event for webhook delivery (only if credits were reset and product key exists)
		if item.creditsUsed.IsPositive() && item.productKey.Valid && item.productKey.String != "" {
			result := ResetResult{
				BudgetItemID:  item.id,
				BudgetID:      item.budgetID,
				ProductKey:    item.productKey.String,
				CreditsReset:  item.creditsUsed,
				CreditsTotal:  item.creditsTotal,
				NextResetsAt:  nextResetsAt,
				ResetInterval: item.resetInterval,
			}
			// Idempotency key: {event-type}:{itemId}:{resetsAt} - prevents duplicate webhooks for same reset cycle
			idempotencyKey := "budget-item.reset:" + item.id + ":" + item.resetsAt.UTC().Format(time.RFC3339Nano)
			if err := InsertOutboxEventTx(ctx, tx, "budget-item.reset", item.productKey.String, result.ToPayload(), idempotencyKey); err != nil {
				return 0, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(items), nil
}

// ExpirationResult holds info about an expired budget item for webhook delivery.
type ExpirationResult struct {
	BudgetItemID     string
	BudgetID         string
	ProductKey       string
	ExpiredAt        time.Time
	CreditsRemaining decimal.Decimal
	CreditsTotal     decimal.Decimal
}

// ToPayload converts to webhook payload format.
func (e *ExpirationResult) ToPayload() map[string]any {
	return map[string]any{
		"budgetItemId":     e.BudgetItemID,
		"budgetId":         e.BudgetID,
		"expiredAt":        e.ExpiredAt.UTC().Format(time.RFC3339Nano),
		"creditsRemaining": credits.Format(e.CreditsRemaining),
		"creditsTotal":     credits.Format(e.CreditsTotal),
	}
}

// ExhaustedResult holds info about a budget item that became fully consumed.
type ExhaustedResult struct {
	BudgetItemID string
	BudgetID     string
	SessionID    string
	ReportID     string
	CreditsTotal decimal.Decimal
}

// ToPayload converts to webhook payload format.
func (e *ExhaustedResult) ToPayload() map[string]any {
	return map[string]any{
		"budgetItemId": e.BudgetItemID,
		"budgetId":     e.BudgetID,
		"sessionId":    e.SessionID,
		"reportId":     e.ReportID,
		"creditsTotal": credits.Format(e.CreditsTotal),
	}
}

// ReportCreatedPayload holds info about a created session report for webhook delivery.
type ReportCreatedPayload struct {
	ProductKey       string
	BudgetID         string
	SessionID        string
	ReportID         string
	BudgetCostTotal  decimal.Decimal
	ProductCostTotal decimal.Decimal
	CreditsAvailable decimal.Decimal
	ReportItems      []ReportItemPayload
}

// ReportItemPayload holds info about a single report item for webhook payload.
type ReportItemPayload struct {
	ReportItemID string
	BudgetCost   string
	ProductCost  string
	Label        string
	CreatedAt    time.Time
	BudgetItems  []ReportItemAllocationPayload
}

// ReportItemAllocationPayload holds info about a budget item allocation for webhook payload.
type ReportItemAllocationPayload struct {
	BudgetItemID string
	CreditsUsed  string
}

// ToPayload converts to webhook payload format.
func (r *ReportCreatedPayload) ToPayload() map[string]any {
	webhookReportItems := make([]map[string]any, len(r.ReportItems))
	for i, ri := range r.ReportItems {
		budgetItemsPayload := make([]map[string]any, len(ri.BudgetItems))
		for j, bi := range ri.BudgetItems {
			budgetItemsPayload[j] = map[string]any{
				"budgetItemId": bi.BudgetItemID,
				"creditsUsed":  bi.CreditsUsed,
			}
		}
		webhookReportItems[i] = map[string]any{
			"reportItemId": ri.ReportItemID,
			"budgetCost":   ri.BudgetCost,
			"productCost":  ri.ProductCost,
			"label":        ri.Label,
			"createdAt":    ri.CreatedAt.UTC().Format(time.RFC3339Nano),
			"budgetItems":  budgetItemsPayload,
		}
	}

	return map[string]any{
		"productKey":       r.ProductKey,
		"budgetId":         r.BudgetID,
		"sessionId":        r.SessionID,
		"reportId":         r.ReportID,
		"budgetCostTotal":  credits.Format(r.BudgetCostTotal),
		"productCostTotal": credits.Format(r.ProductCostTotal),
		"creditsAvailable": credits.Format(r.CreditsAvailable),
		"reportItems":      webhookReportItems,
	}
}

// ProcessDueExpirationsWithOutbox finds expired items not yet notified, marks them notified,
// and inserts outbox events atomically. This eliminates the windowed query gap.
// Returns the count of items processed.
func (s *Store) ProcessDueExpirationsWithOutbox(ctx context.Context, batchSize int) (int, error) {
	if batchSize < 1 {
		batchSize = 500
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, `
		SELECT bi.id, bi.budget_id, b.product_key, bi.expires_at,
		       bi.credits_total, bi.credits_used
		FROM budget_items bi
		JOIN budgets b ON b.id = bi.budget_id AND b.deleted_at IS NULL
		WHERE bi.expires_at <= now()
		  AND bi.expiration_notified_at IS NULL
		  AND bi.deleted_at IS NULL
		ORDER BY bi.expires_at, bi.id
		LIMIT $1
		FOR UPDATE OF bi SKIP LOCKED
	`, batchSize)
	if err != nil {
		return 0, err
	}

	type expiredItem struct {
		id           string
		budgetID     string
		productKey   sql.NullString
		expiresAt    time.Time
		creditsTotal decimal.Decimal
		creditsUsed  decimal.Decimal
	}
	var items []expiredItem
	for rows.Next() {
		var item expiredItem
		if err := rows.Scan(&item.id, &item.budgetID, &item.productKey, &item.expiresAt,
			&item.creditsTotal, &item.creditsUsed); err != nil {
			_ = rows.Close()
			return 0, err
		}
		items = append(items, item)
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	if len(items) == 0 {
		return 0, tx.Commit()
	}

	for _, item := range items {
		// Mark item as notified
		if _, err := tx.ExecContext(ctx, `
			UPDATE budget_items SET expiration_notified_at = now() WHERE id = $1
		`, item.id); err != nil {
			return 0, err
		}

		// Insert outbox event for webhook delivery (only if product key exists)
		if item.productKey.Valid && item.productKey.String != "" {
			result := ExpirationResult{
				BudgetItemID:     item.id,
				BudgetID:         item.budgetID,
				ProductKey:       item.productKey.String,
				ExpiredAt:        item.expiresAt,
				CreditsRemaining: item.creditsTotal.Sub(item.creditsUsed),
				CreditsTotal:     item.creditsTotal,
			}
			// Idempotency key: {event-type}:{itemId}:{expiresAt} - prevents duplicate webhooks
			idempotencyKey := "budget-item.expired:" + item.id + ":" + item.expiresAt.UTC().Format(time.RFC3339Nano)
			if err := InsertOutboxEventTx(ctx, tx, "budget-item.expired", item.productKey.String, result.ToPayload(), idempotencyKey); err != nil {
				return 0, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(items), nil
}

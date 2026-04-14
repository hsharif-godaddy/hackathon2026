package store

import (
	"context"
	"database/sql"
	"errors"
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

type preparedBudgetItemInsert struct {
	ID              string
	CreditsTotal    string
	CostCreditRatio string
	ExpiresAt       sql.NullTime
	StartsAt        sql.NullTime
	ResetsAt        sql.NullTime
	ResetInterval   sql.NullString
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
		CreatedAt:       createdAt,
	}, nil
}

func insertPreparedBudgetItem(ctx context.Context, tx *sql.Tx, budgetID string, prepared *preparedBudgetItemInsert) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO budget_items (
			id, budget_id, credits_total, credits_used, cost_credit_ratio,
			expires_at, starts_at, resets_at, reset_interval, created_at
		) VALUES ($1, $2, $3, 0, $4, $5, $6, $7, $8, $9)
	`, prepared.ID, budgetID, prepared.CreditsTotal, prepared.CostCreditRatio,
		prepared.ExpiresAt, prepared.StartsAt, prepared.ResetsAt, prepared.ResetInterval, prepared.CreatedAt)
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
			expires_at, starts_at, reset_interval, resets_at, item_created_at, item_updated_at
		)
		SELECT
			id, budget_id, credits_total, credits_used, cost_credit_ratio,
			expires_at, starts_at, reset_interval, resets_at, created_at, updated_at
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
			bi.expires_at, bi.starts_at, bi.resets_at, bi.reset_interval, bi.deleted_at, bi.created_at, bi.updated_at
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
		var reset sql.NullString
		var ctot, cusd, csr decimal.Decimal
		var delItem sql.NullTime
		if err := rows.Scan(
			&r.ID, &ctot, &cusd, &csr,
			&exp, &st, &rs, &reset, &delItem, &r.CreatedAt, &r.UpdatedAt,
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
	var reset sql.NullString
	var ctot, cusd, csr decimal.Decimal
	var delItem sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT
			bi.id,
			bi.credits_total,
			bi.credits_used,
			bi.cost_credit_ratio,
			bi.expires_at, bi.starts_at, bi.resets_at, bi.reset_interval, bi.deleted_at, bi.created_at, bi.updated_at
		FROM budget_items bi
		WHERE bi.id = $1 AND bi.budget_id = $2
	`, itemID, budgetID).Scan(
		&r.ID, &ctot, &cusd, &csr,
		&exp, &st, &rs, &reset, &delItem, &r.CreatedAt, &r.UpdatedAt,
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
	if delItem.Valid {
		t := delItem.Time
		r.DeletedAt = &t
	}
	return &r, nil
}

func (s *Store) UpsertBudgetItems(ctx context.Context, budgetID string, items []PutItemInput) error {
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
			if _, err := insertBudgetItem(ctx, tx, budgetID, ItemInput{
				CreditsTotal:    it.CreditsTotal,
				CreditsUsed:     it.CreditsUsed,
				CostCreditRatio: it.CostCreditRatio,
				ExpiresAt:       it.ExpiresAt,
				StartsAt:        it.StartsAt,
				ResetsAt:        it.ResetsAt,
				ResetInterval:   it.ResetInterval,
			}); err != nil {
				return err
			}
			continue
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
				reset_interval = $6
			WHERE id = $7 AND budget_id = $8 AND deleted_at IS NULL
		`, it.CreditsTotal, it.CostCreditRatio,
			exp, st, rs, resetInterval, itemID, budgetID)
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
			reset_interval = $6
		WHERE id = $7 AND budget_id = $8 AND deleted_at IS NULL
	`, in.CreditsTotal, in.CostCreditRatio,
		exp, st, rs, resetInterval, itemID, budgetID)
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

	states, err := loadBudgetConsumptionStatesTx(ctx, tx, budgetID, true)
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
func (s *Store) AppendSessionItems(ctx context.Context, sessionID string, lines []SessionLine) ([]SessionAppendMathLine, string, error) {
	if _, err := uuid.Parse(sessionID); err != nil {
		return nil, "", err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = tx.Rollback() }()

	// Serialize concurrent PATCHes against the same session + budget_items consumption state.
	var budgetID string
	err = tx.QueryRowContext(ctx, `
		SELECT bs.budget_id FROM budget_sessions bs
		INNER JOIN budgets b ON b.id = bs.budget_id AND b.deleted_at IS NULL
		WHERE bs.id = $1 AND bs.reconciled_at IS NULL
		FOR UPDATE OF bs
	`, sessionID).Scan(&budgetID)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, "", err
		}
		var rec sql.NullTime
		err = tx.QueryRowContext(ctx, `
			SELECT reconciled_at FROM budget_sessions WHERE id = $1
		`, sessionID).Scan(&rec)
		if err != nil {
			return nil, "", mapNotFound(err)
		}
		if rec.Valid {
			return nil, "", ErrAlreadyReconciled
		}
		// Row exists with reconciled_at null but first query missed it: should be unreachable; surface as not found.
		return nil, "", ErrNotFound
	}
	if err := applyDueResetsForBudgetTx(ctx, tx, budgetID); err != nil {
		return nil, "", err
	}

	states, err := loadBudgetConsumptionStatesTx(ctx, tx, budgetID, true)
	if err != nil {
		return nil, "", err
	}

	now := time.Now()

	// Replay existing lines so new lines stack on the same consumption order as a single chronological stream.
	priorRows, err := tx.QueryContext(ctx, `
		SELECT cost_usd FROM budget_session_items WHERE session_id = $1 ORDER BY id
	`, sessionID)
	if err != nil {
		return nil, "", err
	}
	for priorRows.Next() {
		var costD decimal.Decimal
		if err := priorRows.Scan(&costD); err != nil {
			_ = priorRows.Close()
			return nil, "", err
		}
		if _, err := consumeBudgetCostUSDSession(costD, states, now); err != nil {
			_ = priorRows.Close()
			return nil, "", err
		}
	}
	if err := priorRows.Close(); err != nil {
		return nil, "", err
	}
	if err := priorRows.Err(); err != nil {
		return nil, "", err
	}

	out := make([]SessionAppendMathLine, 0, len(lines))
	for i := range lines {
		costD, err := credits.ParseNonNegative(lines[i].Cost)
		if err != nil {
			return nil, "", err
		}
		costStr := credits.Format(costD)
		chunks, err := consumeBudgetCostUSDSession(costD, states, now)
		if err != nil {
			return nil, "", err
		}
		var chargedSum decimal.Decimal
		for j := range chunks {
			chargedSum = chargedSum.Add(chunks[j].credits)
		}
		chargedStr := credits.Format(chargedSum)
		if _, err = tx.ExecContext(ctx, `
			INSERT INTO budget_session_items (session_id, cost_usd, credits_charged, call_request_id)
			VALUES ($1, $2, $3, $4)
		`, sessionID, costStr, chargedStr, lines[i].CallRequestID); err != nil {
			return nil, "", mapSessionCallRequestUnique(err)
		}
		math := SessionAppendMathLine{CostUsd: costStr, CreditsCharged: chargedStr}
		for j := range chunks {
			math.Allocations = append(math.Allocations, struct {
				BudgetItemID string `json:"budgetItemId"`
				UsdChunk     string `json:"usdChunk"`
				Credits      string `json:"credits"`
			}{
				BudgetItemID: chunks[j].budgetItemID,
				UsdChunk:     credits.Format(chunks[j].usdChunk),
				Credits:      credits.Format(chunks[j].credits),
			})
		}
		out = append(out, math)
	}
	if _, err = tx.ExecContext(ctx, `UPDATE budget_sessions SET updated_at = now() WHERE id = $1`, sessionID); err != nil {
		return nil, "", err
	}
	if err := tx.Commit(); err != nil {
		return nil, "", err
	}
	return out, budgetID, nil
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

// CreateSessionReport applies each report line’s budgetCost USD using the same per-item consumption rules as session PATCH.
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
	if err := applyDueResetsForBudgetTx(ctx, tx, budgetID); err != nil {
		return "", "", err
	}

	// One mutable snapshot across all report lines; later lines see credits_used from earlier lines in this tx (trigger bumps column on ledger insert).
	budgetItems, err := loadBudgetConsumptionStatesTx(ctx, tx, budgetID, true)
	if err != nil {
		return "", "", err
	}

	now := time.Now()

	reportID := uuid.NewString()
	if _, err := tx.ExecContext(ctx, `INSERT INTO budget_session_reports (id, session_id) VALUES ($1, $2)`, reportID, sessionID); err != nil {
		return "", "", mapReportSessionUnique(err)
	}

	for i := range items {
		bc, err := credits.ParseNonNegative(items[i].BudgetCost)
		if err != nil {
			return "", "", err
		}
		pc, err := credits.ParseNonNegative(items[i].ProductCost)
		if err != nil {
			return "", "", err
		}
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
		}
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

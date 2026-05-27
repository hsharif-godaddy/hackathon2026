package checks

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func shortID(id string) string {
	if len(id) < 8 {
		return id
	}
	return id[:8]
}

// BMSRemoteSeedCheck verifies that a dev budget exists on the remote dev BMS
// and that the local .dev-bms/budget-id file references a valid budget.
type BMSRemoteSeedCheck struct{}

func (c *BMSRemoteSeedCheck) Name() string     { return "BMS Remote Budget" }
func (c *BMSRemoteSeedCheck) Category() string { return preflight.CategoryServices }

func (c *BMSRemoteSeedCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	idPath := filepath.Join(projectRoot, preflight.BMSDevBudgetIDFile)
	raw, err := os.ReadFile(idPath)
	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "no .dev-bms/budget-id file; budget not seeded",
			FixAvailable: true,
		}
	}

	budgetID := strings.TrimSpace(string(raw))
	if budgetID == "" {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      ".dev-bms/budget-id is empty",
			FixAvailable: true,
		}
	}

	// Verify budget still exists on remote (token needed for auth).
	token, err := getBMSToken(ctx, projectRoot)
	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      fmt.Sprintf("cannot verify budget: %s", err),
			FixAvailable: true,
		}
	}

	budget, err := getBudget(ctx, budgetID, token)
	if err != nil {
		// Budget was deleted remotely or is inaccessible.
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      fmt.Sprintf("budget %s not found on remote: %s", shortID(budgetID), err),
			FixAvailable: true,
		}
	}

	// Check if credits are exhausted.
	exhausted, parseErr := budgetCreditsExhausted(budget)
	if parseErr != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      fmt.Sprintf("budget %s: %s", shortID(budgetID), parseErr),
			FixAvailable: true,
		}
	}
	if exhausted {
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      fmt.Sprintf("budget %s credits exhausted; will top up", shortID(budgetID)),
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  fmt.Sprintf("budget %s ok", shortID(budgetID)),
	}
}

type bmsBudgetResponse struct {
	BudgetID     string    `json:"budgetId"`
	CreditsTotal string    `json:"creditsTotal"`
	CreditsUsed  string    `json:"creditsUsed"`
	Items        []bmsItem `json:"items"`
}

type bmsItem struct {
	BudgetItemID string `json:"budgetItemId"`
	CreditsTotal string `json:"creditsTotal"`
	CreditsUsed  string `json:"creditsUsed"`
}

func getBudget(ctx context.Context, budgetID string, token string) (*bmsBudgetResponse, error) {
	url := preflight.BMSRemoteBaseURL + "/api/v1/budgets/" + budgetID
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "sso-jwt "+token)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("not found")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	var budget bmsBudgetResponse
	if err := json.NewDecoder(resp.Body).Decode(&budget); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return &budget, nil
}

func budgetCreditsExhausted(b *bmsBudgetResponse) (bool, error) {
	total, errT := strconv.ParseFloat(b.CreditsTotal, 64)
	used, errU := strconv.ParseFloat(b.CreditsUsed, 64)
	if errT != nil || errU != nil {
		return false, fmt.Errorf("unparseable credits: total=%q used=%q", b.CreditsTotal, b.CreditsUsed)
	}
	if total <= 0 {
		return true, nil
	}
	return used >= total, nil
}

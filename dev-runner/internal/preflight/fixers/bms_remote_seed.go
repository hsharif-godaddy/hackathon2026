package fixers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

const (
	bmsProductKey  = "airo-app-builder"
	bmsCreditLimit = "1000000.000000"
)

var errBudgetNotFound = errors.New("budget not found")

// bmsBaseURL is the BMS API base URL. Tests override this to point at httptest servers.
var bmsBaseURL = preflight.BMSRemoteBaseURL

// getTokenFunc is the token acquisition function. Tests override this to avoid shelling out.
var getTokenFunc = getToken

// BMSRemoteSeedFixer seeds a budget on the remote dev BMS and writes the
// budgetId to .dev-bms/budget-id for LCP to read on subscription creation.
type BMSRemoteSeedFixer struct{}

func (f *BMSRemoteSeedFixer) Fix(ctx context.Context, projectRoot string) error {
	token, err := getTokenFunc(ctx, projectRoot)
	if err != nil {
		writeSeedStatus(projectRoot, "failed: "+err.Error())
		return err
	}

	// Check if we already have a budget that just needs a top-up.
	idPath := filepath.Join(projectRoot, preflight.BMSDevBudgetIDFile)
	if existing, err := os.ReadFile(idPath); err == nil {
		budgetID := strings.TrimSpace(string(existing))
		if budgetID != "" {
			topUpErr := topUpIfNeeded(ctx, budgetID, token)
			if topUpErr == nil {
				writeSeedStatus(projectRoot, "ok")
				return nil
			}
			if !errors.Is(topUpErr, errBudgetNotFound) {
				writeSeedStatus(projectRoot, "failed: "+topUpErr.Error())
				return topUpErr
			}
			// 404: budget gone or soft-deleted; fall through to create new one.
		}
	}

	budgetID, err := createBudget(ctx, token)
	if err != nil {
		writeSeedStatus(projectRoot, "failed: "+err.Error())
		return fmt.Errorf("create budget: %w", err)
	}
	if budgetID == "" {
		writeSeedStatus(projectRoot, "failed: BMS returned empty budgetId")
		return fmt.Errorf("create budget: BMS returned empty budgetId")
	}

	if err := os.MkdirAll(filepath.Dir(idPath), 0755); err != nil {
		writeSeedStatus(projectRoot, "failed: "+err.Error())
		return fmt.Errorf("create .dev-bms dir: %w", err)
	}
	if err := os.WriteFile(idPath, []byte(budgetID+"\n"), 0644); err != nil {
		writeSeedStatus(projectRoot, fmt.Sprintf("failed: orphaned remote budget %s; delete via API: %s", budgetID, err))
		return fmt.Errorf("write .dev-bms/budget-id (orphaned remote budget %s): %w", budgetID, err)
	}

	writeSeedStatus(projectRoot, "ok")
	return nil
}

func getToken(ctx context.Context, projectRoot string) (string, error) {
	scriptPath := filepath.Join(projectRoot, "dev-runner", "scripts", "bms-get-token.js")
	token, err := RunCommandStdout(ctx, projectRoot, "node", scriptPath)
	if err != nil {
		return "", fmt.Errorf("S2S token failed (run: aws sso login --profile airobuild-dev-private-sso): %w", err)
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return "", fmt.Errorf("empty token")
	}
	return token, nil
}

type createBudgetRequest struct {
	ProductKey string             `json:"productKey"`
	Items      []createBudgetItem `json:"items"`
}

type createBudgetItem struct {
	CreditsTotal string  `json:"creditsTotal"`
	Label        *string `json:"label,omitempty"`
}

type createBudgetResponse struct {
	BudgetID string `json:"budgetId"`
}

func createBudget(ctx context.Context, token string) (string, error) {
	label := "dev-runner seed"
	payload := createBudgetRequest{
		ProductKey: bmsProductKey,
		Items: []createBudgetItem{
			{CreditsTotal: bmsCreditLimit, Label: &label},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, bmsBaseURL+"/api/v1/budgets", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "sso-jwt "+token)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		var errBody struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&errBody)
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, errBody.Error)
	}

	var result createBudgetResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}
	return result.BudgetID, nil
}

type budgetResponse struct {
	CreditsTotal string `json:"creditsTotal"`
	CreditsUsed  string `json:"creditsUsed"`
}

func topUpIfNeeded(ctx context.Context, budgetID string, token string) error {
	url := bmsBaseURL + "/api/v1/budgets/" + budgetID
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "sso-jwt "+token)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return errBudgetNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	var budget budgetResponse
	if err := json.NewDecoder(resp.Body).Decode(&budget); err != nil {
		return err
	}

	total, errT := strconv.ParseFloat(budget.CreditsTotal, 64)
	used, errU := strconv.ParseFloat(budget.CreditsUsed, 64)
	if errT != nil || errU != nil {
		return fmt.Errorf("unparseable credits: total=%q used=%q", budget.CreditsTotal, budget.CreditsUsed)
	}

	if total <= 0 || used >= total {
		itemErr := addBudgetItem(ctx, budgetID, token)
		if itemErr != nil {
			return fmt.Errorf("top-up budget item: %w", itemErr)
		}
	}
	return nil
}

func addBudgetItem(ctx context.Context, budgetID string, token string) error {
	label := "dev-runner top-up"
	payload := createBudgetItem{CreditsTotal: bmsCreditLimit, Label: &label}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	url := bmsBaseURL + "/api/v1/budgets/" + budgetID + "/budget-items"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "sso-jwt "+token)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("top-up failed: HTTP %d", resp.StatusCode)
	}
	return nil
}

func writeSeedStatus(projectRoot string, status string) {
	path := filepath.Join(projectRoot, preflight.BMSSeedStatusFile)
	dir := filepath.Dir(path)
	_ = os.MkdirAll(dir, 0755)
	_ = os.WriteFile(path, []byte(status+"\n"), 0644)
}

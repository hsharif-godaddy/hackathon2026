//go:build integration

// Package integration provides integration tests for budget-service.
// Run with: INTEGRATION_TEST=1 go test -tags=integration ./internal/integration/...
package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/airo-ai-builder/budget-service/pkg/models"
)

const defaultBaseURL = "http://localhost:8080"

// Client is an HTTP client for the budget-service API.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a new API client.
func NewClient() *Client {
	baseURL := os.Getenv("BUDGET_SERVICE_URL")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// skipIfNoIntegration skips the test if integration tests are not enabled.
func skipIfNoIntegration(t testing.TB) {
	t.Helper()
	if os.Getenv("INTEGRATION_TEST") != "1" {
		t.Skip("Skipping integration test (set INTEGRATION_TEST=1 to run)")
	}
}

// CreateBudget creates a new budget via the API.
func (c *Client) CreateBudget(req models.CreateBudgetRequest) (*models.Budget, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	resp, err := c.httpClient.Post(c.baseURL+"/api/v1/budgets", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("post request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	var budget models.Budget
	if err := json.NewDecoder(resp.Body).Decode(&budget); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &budget, nil
}

// GetBudgets retrieves all budgets for a subscription.
func (c *Client) GetBudgets(subscriptionID string) (*models.BudgetsResponse, error) {
	resp, err := c.httpClient.Get(c.baseURL + "/api/v1/subscriptions/" + subscriptionID + "/budgets")
	if err != nil {
		return nil, fmt.Errorf("get request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	var result models.BudgetsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result, nil
}

// Spend sends a spend request for a subscription.
func (c *Client) Spend(subscriptionID string, req models.SpendRequest) (*models.SpendResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	resp, err := c.httpClient.Post(
		c.baseURL+"/api/v1/subscriptions/"+subscriptionID+"/spend",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("post request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	var result models.SpendResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result, nil
}

// Release sends a release request for a subscription.
func (c *Client) Release(subscriptionID string, req models.ReleaseRequest) (*models.ReleaseResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	resp, err := c.httpClient.Post(
		c.baseURL+"/api/v1/subscriptions/"+subscriptionID+"/release",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("post request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	var result models.ReleaseResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result, nil
}

// DeleteBudget deletes a budget by ID.
func (c *Client) DeleteBudget(budgetID string) error {
	req, err := http.NewRequest(http.MethodDelete, c.baseURL+"/api/v1/budgets/"+budgetID, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("delete request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// Health checks if the service is healthy.
func (c *Client) Health() error {
	resp, err := c.httpClient.Get(c.baseURL + "/api/v1/health")
	if err != nil {
		return fmt.Errorf("get request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unhealthy: status %d", resp.StatusCode)
	}
	return nil
}

// generateSubscriptionID creates a unique subscription ID for testing.
// Uses milliseconds to stay within VARCHAR(21) column limit.
func generateSubscriptionID() string {
	return fmt.Sprintf("t%d", time.Now().UnixMilli())
}

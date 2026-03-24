// pkg/models/api.go
package models

import "time"

// Request types

type CreateBudgetRequest struct {
	SubscriptionID        string        `json:"subscriptionId"`
	Type                  BudgetType    `json:"type"`
	Label                 string        `json:"label"`
	MaxCredits            string        `json:"maxCredits"`       // Decimal string, e.g., "1000.50"
	ConversionFactor      string        `json:"conversionFactor"` // Decimal string, e.g., "1.5"
	ExpirationOrResetDate time.Time     `json:"expirationOrResetDate"`
	ResetInterval         ResetInterval `json:"resetInterval,omitempty"`
}

type UpdateBudgetRequest struct {
	Label                 *string        `json:"label,omitempty"`
	MaxCredits            *string        `json:"maxCredits,omitempty"`       // Decimal string
	ConversionFactor      *string        `json:"conversionFactor,omitempty"` // Decimal string
	ExpirationOrResetDate *time.Time     `json:"expirationOrResetDate,omitempty"`
	ResetInterval         *ResetInterval `json:"resetInterval,omitempty"`
}

type SpendRequest struct {
	Amount        string `json:"amount"` // Decimal string, e.g., "50.123456"
	OperationType string `json:"operationType,omitempty"`
	OperationID   string `json:"operationId,omitempty"`
}

type ReleaseRequest struct {
	Amount        string `json:"amount"` // Decimal string
	OperationType string `json:"operationType,omitempty"`
	OperationID   string `json:"operationId,omitempty"`
}

// Response types

type BudgetsResponse struct {
	SubscriptionID           string   `json:"subscriptionId"`
	TotalMaxCredits          string   `json:"totalMaxCredits"`          // Precise sum
	TotalCurrentValue        string   `json:"totalCurrentValue"`        // Precise sum
	TotalMaxCreditsRounded   int64    `json:"totalMaxCreditsRounded"`   // Rounded sum
	TotalCurrentValueRounded int64    `json:"totalCurrentValueRounded"` // Rounded sum
	Budgets                  []Budget `json:"budgets"`
}

type Allocation struct {
	BudgetID          string `json:"budgetId"`
	Amount            string `json:"amount"`            // Precise amount spent/released
	NewBalance        string `json:"newBalance"`        // Precise new balance
	NewBalanceRounded int64  `json:"newBalanceRounded"` // Rounded new balance
}

type Alert struct {
	Type      string `json:"type"`
	BudgetID  string `json:"budgetId"`
	Threshold int64  `json:"threshold,omitempty"`
	Current   int64  `json:"current"` // Rounded current value
}

type SpendResponse struct {
	Success             bool         `json:"success"`
	AmountRequested     string       `json:"amountRequested"` // Precise
	AmountSpent         string       `json:"amountSpent"`     // Precise (after conversion)
	Allocations         []Allocation `json:"allocations"`
	TotalBalance        string       `json:"totalBalance"`        // Precise
	TotalBalanceRounded int64        `json:"totalBalanceRounded"` // Rounded
	OverBudget          bool         `json:"overBudget"`
	Alerts              []Alert      `json:"alerts"`
}

type ReleaseResponse struct {
	Success             bool         `json:"success"`
	Allocations         []Allocation `json:"allocations"`
	TotalBalance        string       `json:"totalBalance"`        // Precise
	TotalBalanceRounded int64        `json:"totalBalanceRounded"` // Rounded
}

type HealthResponse struct {
	Status   string `json:"status"`
	Version  string `json:"version"`
	Database string `json:"database"`
	Uptime   string `json:"uptime"`
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Code    string `json:"code,omitempty"`
	Details string `json:"details,omitempty"`
}

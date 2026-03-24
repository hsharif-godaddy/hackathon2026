// pkg/models/budget.go
package models

import (
	"time"

	"github.com/google/uuid"
)

type BudgetType string

const (
	BudgetTypeInterval BudgetType = "interval"
	BudgetTypeBurndown BudgetType = "burndown"
)

type ResetInterval string

const (
	ResetIntervalDaily   ResetInterval = "daily"
	ResetIntervalMonthly ResetInterval = "monthly"
)

// Budget represents a credit budget with precise decimal values.
// Credit values are stored as strings to preserve NUMERIC(20,6) precision.
// Rounded values are provided for display purposes.
type Budget struct {
	ID                    uuid.UUID      `json:"budgetId"`
	SubscriptionID        string         `json:"subscriptionId"`
	Type                  BudgetType     `json:"type"`
	Label                 string         `json:"label"`
	MaxCredits            string         `json:"maxCredits"`          // Precise NUMERIC value
	CurrentValue          string         `json:"currentValue"`        // Precise NUMERIC value
	MaxCreditsRounded     int64          `json:"maxCreditsRounded"`   // ROUND(max_credits)
	CurrentValueRounded   int64          `json:"currentValueRounded"` // ROUND(current_value)
	ConversionFactor      string         `json:"conversionFactor"`    // Precise DECIMAL value
	ExpirationOrResetDate time.Time      `json:"expirationOrResetDate"`
	ResetInterval         *ResetInterval `json:"resetInterval,omitempty"`
	CreatedAt             time.Time      `json:"createdAt"`
	UpdatedAt             time.Time      `json:"updatedAt"`
}

func (b *Budget) NeedsReset() bool {
	if b.Type != BudgetTypeInterval || b.ResetInterval == nil {
		return false
	}
	return time.Now().After(b.ExpirationOrResetDate)
}

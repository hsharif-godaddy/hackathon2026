package store

import (
	"errors"
	"time"
)

// ErrSubscriptionNotOwned is returned when a subscription exists but belongs to a different customer.
var ErrSubscriptionNotOwned = errors.New("access denied: not subscription owner")

// ErrAppNotFound is returned when an app ID does not match any row.
var ErrAppNotFound = errors.New("app not found")

// ErrAttributeNotFound is returned when an attribute lookup misses.
var ErrAttributeNotFound = errors.New("attribute not found")

// ErrAttributeAlreadyExists is returned when an attribute key already exists for an owner.
var ErrAttributeAlreadyExists = errors.New("attribute already exists")

type App struct {
	ID                    string            `json:"id"`
	SubscriptionID        string            `json:"subscriptionId"`
	SystemID              string            `json:"systemId"`
	Status                string            `json:"status"`
	ImageDigest           string            `json:"imageDigest,omitempty"`
	LifecycleState        string            `json:"lifecycleState,omitempty"`
	Variables             map[string]any    `json:"variables,omitempty"`
	Variants              []string          `json:"variants,omitempty"`
	CreatedAt             time.Time         `json:"createdAt"`
	UpdatedAt             time.Time         `json:"updatedAt"`
	PreviewPort           int               `json:"previewPort,omitempty"`
	PublishPort           int               `json:"publishPort,omitempty"`
	SupervisorPort        int               `json:"supervisorPort,omitempty"`
	PublishSupervisorPort int               `json:"publishSupervisorPort,omitempty"`
	URLs                  map[string]string `json:"urls,omitempty"`
}

type Job struct {
	ID        string    `json:"id"`
	AppID     string    `json:"appId"`
	Status    string    `json:"status"`
	Error     string    `json:"error,omitempty"`
	JobType   string    `json:"jobType"`
	CreatedAt time.Time `json:"createdAt"`
}

type Secret struct {
	AppID         string `json:"appId"`
	Variant       string `json:"variant"`
	Name          string `json:"name"`
	Value         string `json:"value"`
	SystemManaged bool   `json:"systemManaged"`
}

type Deployment struct {
	ID          string `json:"id"`
	AppID       string `json:"appId"`
	GitHash     string `json:"gitHash"`
	Variant     string `json:"variant"`
	Status      string `json:"status"`
	StatusJobID string `json:"statusJobId"`
	Attempts    int    `json:"attempts"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type Subscription struct {
	ID            string `json:"id"`
	ProductID     string `json:"productId"`
	OwnerProduct  string `json:"ownerProduct"`
	CustomerID    string `json:"customerId"`
	Status        string `json:"status"`
	Reason        string `json:"reason"`
	IsTrial       bool   `json:"isTrial"`
	HadAiroPlus   bool   `json:"hadAiroPlus"`
	TokenBudgetID string `json:"tokenBudgetId"`
	BMSBudgetID   string `json:"bmsBudgetId"`
	Plan          string `json:"plan"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

type Attribute struct {
	ID        string         `json:"id"`
	OwnerType string         `json:"ownerType"`
	OwnerID   string         `json:"ownerId"`
	Key       string         `json:"key"`
	Value     map[string]any `json:"value"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
}

const (
	DefaultCustomerID = "local-customer-001"
	DefaultDatacenter = "local-dc"
	DefaultProductID  = "aab-v1"
)

// Lifecycle state constants (matching hosting backend)
const (
	LifecycleStateRunning      = "running"
	LifecycleStatePaused       = "paused"
	LifecycleStateArchived     = "archived"
	LifecycleStateReloading    = "reloading"
	LifecycleStateProvisioning = "provisioning"
	LifecycleStateDeleting     = "deleting"
	LifecycleStateFailed       = "failed"
)

// Lifecycle reason constants (matching hosting backend)
const (
	LifecycleReasonHibernation         = "hibernation"
	LifecycleReasonUserRequest         = "user_request"
	LifecycleReasonMaintenance         = "maintenance"
	LifecycleReasonDeploymentComplete  = "deployment_complete"
	LifecycleReasonUserResumed         = "user_resumed"
	LifecycleReasonFleetReload         = "fleet_reload"
	LifecycleReasonDeployment          = "deployment"
	LifecycleReasonReloadComplete      = "reload_complete"
	LifecycleReasonOnDemandStaleImages = "on_demand_stale_images"
	LifecycleReasonColdArchive         = "cold_archive"
)

type Automation struct {
	ID           string    `json:"id"`
	AppID        string    `json:"appId"`
	Name         string    `json:"name"`
	DefnType     string    `json:"defnType"`
	DefnLocation string    `json:"defnLocation"`
	DefnRef      string    `json:"defnRef"`
	TriggerType  string    `json:"triggerType"`
	CronExpr     string    `json:"cronExpr"`
	Enabled      bool      `json:"enabled"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type AutomationRun struct {
	ID           string     `json:"id"`
	AutomationID string     `json:"automationId"`
	AppID        string     `json:"appId"`
	Status       string     `json:"status"`
	TriggerType  string     `json:"triggerType"`
	SummaryRef   string     `json:"summaryRef,omitempty"`
	ErrorMessage string     `json:"errorMessage,omitempty"`
	StartedAt    time.Time  `json:"startedAt"`
	FinishedAt   *time.Time `json:"finishedAt,omitempty"`
}

func SubscriptionIDForCustomer(customerID string) string {
	if customerID == DefaultCustomerID {
		return "local-sub-001"
	}
	return "local-sub-" + customerID
}

func SystemIDForCustomer(customerID string) string {
	if customerID == DefaultCustomerID {
		return "local-sys-001"
	}
	return "local-sys-" + customerID
}

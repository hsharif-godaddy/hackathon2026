package store

import "time"

type App struct {
	ID                     string            `json:"id"`
	SubscriptionID         string            `json:"subscriptionId"`
	SystemID               string            `json:"systemId"`
	Status                 string            `json:"status"`
	Variables              map[string]any    `json:"variables,omitempty"`
	Variants               []string          `json:"variants,omitempty"`
	CreatedAt              time.Time         `json:"createdAt"`
	UpdatedAt              time.Time         `json:"updatedAt"`
	PreviewPort            int               `json:"previewPort,omitempty"`
	PublishPort            int               `json:"publishPort,omitempty"`
	SupervisorPort         int               `json:"supervisorPort,omitempty"`
	PublishSupervisorPort  int               `json:"publishSupervisorPort,omitempty"`
	URLs                   map[string]string `json:"urls,omitempty"`
}

type Job struct {
	ID        string    `json:"id"`
	AppID     string    `json:"appId"`
	Status    string    `json:"status"`
	Error     string    `json:"error,omitempty"`
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

const (
	DefaultSubscriptionID = "local-sub-001"
	DefaultSystemID       = "local-sys-001"
	DefaultCustomerID     = "local-customer-001"
	DefaultDatacenter     = "local-dc"
	DefaultProductID      = "aab-v1"
)

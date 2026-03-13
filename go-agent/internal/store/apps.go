package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// App represents a row in the apps table.
type App struct {
	ID                    string
	Name                  string
	Path                  string
	Port                  int
	SocketPath            *string
	PublishSupervisorPath *string
	PreviewURL            *string
	InitialPrompt         *string
	TemplateVersion       *string
	SubscriptionID        *string
	CustomerID            *string
	Status                string
	InitialBuildComplete  bool
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

// AppRepo provides CRUD operations for apps.
type AppRepo struct {
	db *sql.DB
}

// NewAppRepo creates a new AppRepo.
func NewAppRepo(db *sql.DB) *AppRepo {
	return &AppRepo{db: db}
}

// Create inserts a new app.
func (r *AppRepo) Create(ctx context.Context, app App) (*App, error) {
	now := time.Now().UTC()
	app.CreatedAt = now
	app.UpdatedAt = now
	if app.Status == "" {
		app.Status = "creating"
	}
	if app.Port == 0 {
		app.Port = 5000
	}

	_, err := r.db.ExecContext(ctx,
		`INSERT INTO apps
			(id, name, path, port, socket_path, publish_supervisor_path,
			 preview_url, initial_prompt, template_version,
			 subscription_id, customer_id, status, initial_build_complete,
			 created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		app.ID, app.Name, app.Path, app.Port,
		app.SocketPath, app.PublishSupervisorPath,
		app.PreviewURL, app.InitialPrompt, app.TemplateVersion,
		app.SubscriptionID, app.CustomerID,
		app.Status, app.InitialBuildComplete,
		app.CreatedAt, app.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("creating app: %w", err)
	}
	return &app, nil
}

// FindByID returns an app by ID.
func (r *AppRepo) FindByID(ctx context.Context, id string) (*App, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, name, path, port, socket_path, publish_supervisor_path,
				preview_url, initial_prompt, template_version,
				subscription_id, customer_id, status, initial_build_complete,
				created_at, updated_at
		 FROM apps WHERE id = ?`, id,
	)
	return scanApp(row)
}

// UpdateStatus updates the app's status field.
func (r *AppRepo) UpdateStatus(ctx context.Context, id, status string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE apps SET status = ?, updated_at = ? WHERE id = ?`,
		status, time.Now().UTC(), id,
	)
	if err != nil {
		return fmt.Errorf("updating app status: %w", err)
	}
	return expectOneRow(res, "app", id)
}

// MarkInitialBuildComplete sets initial_build_complete to true.
func (r *AppRepo) MarkInitialBuildComplete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE apps SET initial_build_complete = TRUE, updated_at = ? WHERE id = ?`,
		time.Now().UTC(), id,
	)
	if err != nil {
		return fmt.Errorf("marking build complete: %w", err)
	}
	return expectOneRow(res, "app", id)
}

// Delete removes an app by ID (cascades to conversations and messages).
func (r *AppRepo) Delete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM apps WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting app: %w", err)
	}
	return expectOneRow(res, "app", id)
}

func scanApp(row *sql.Row) (*App, error) {
	var a App
	err := row.Scan(
		&a.ID, &a.Name, &a.Path, &a.Port,
		&a.SocketPath, &a.PublishSupervisorPath,
		&a.PreviewURL, &a.InitialPrompt, &a.TemplateVersion,
		&a.SubscriptionID, &a.CustomerID,
		&a.Status, &a.InitialBuildComplete,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("app: %w", ErrNotFound)
		}
		return nil, fmt.Errorf("scanning app: %w", err)
	}
	return &a, nil
}

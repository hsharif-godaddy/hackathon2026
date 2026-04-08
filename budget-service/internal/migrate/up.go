// Package migrate applies SQL schema revisions via golang-migrate (embedded files).
package migrate

import (
	"errors"
	"fmt"

	migratelib "github.com/golang-migrate/migrate/v4"
	pgdriver "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/migrations"
)

// Up applies all pending migrations using databaseURL (postgres DSN).
func Up(databaseURL string) error {
	src, err := iofs.New(migrations.SQL, ".")
	if err != nil {
		return fmt.Errorf("migrate source: %w", err)
	}
	dbDriver, err := (&pgdriver.Postgres{}).Open(databaseURL)
	if err != nil {
		return fmt.Errorf("migrate postgres driver: %w", err)
	}
	m, err := migratelib.NewWithInstance("iofs", src, "postgres", dbDriver)
	if err != nil {
		_ = dbDriver.Close()
		return fmt.Errorf("migrate new: %w", err)
	}
	defer func() { _, _ = m.Close() }()
	err = m.Up()
	if err != nil {
		if errors.Is(err, migratelib.ErrNoChange) {
			return nil
		}
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}

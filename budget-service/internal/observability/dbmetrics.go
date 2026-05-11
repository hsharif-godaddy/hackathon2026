// Package observability registers OpenTelemetry instruments for budget-service.
package observability

import (
	"context"
	"database/sql"

	"go.opentelemetry.io/otel"
	otelmetric "go.opentelemetry.io/otel/metric"
)

// RegisterDBMetrics registers async instruments that report sql.DB pool statistics.
func RegisterDBMetrics(db *sql.DB) error {
	if db == nil {
		return nil
	}

	meter := otel.Meter("budget-service")

	openConns, err := meter.Int64ObservableGauge("db.pool.open_connections")
	if err != nil {
		return err
	}
	idleConns, err := meter.Int64ObservableGauge("db.pool.idle_connections")
	if err != nil {
		return err
	}
	waitCount, err := meter.Int64ObservableCounter("db.pool.wait_count")
	if err != nil {
		return err
	}
	waitDuration, err := meter.Float64ObservableCounter("db.pool.wait_duration", otelmetric.WithUnit("s"))
	if err != nil {
		return err
	}

	_, err = meter.RegisterCallback(
		func(_ context.Context, o otelmetric.Observer) error {
			stats := db.Stats()
			o.ObserveInt64(openConns, int64(stats.OpenConnections))
			o.ObserveInt64(idleConns, int64(stats.Idle))
			o.ObserveInt64(waitCount, stats.WaitCount)
			o.ObserveFloat64(waitDuration, stats.WaitDuration.Seconds())
			return nil
		},
		openConns, idleConns, waitCount, waitDuration,
	)
	return err
}

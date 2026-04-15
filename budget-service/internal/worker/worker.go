// Package worker provides a background worker for periodic budget item processing.
package worker

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
)

// WebhookDeliverer delivers webhooks for events.
type WebhookDeliverer interface {
	DeliverEventWebhooks(ctx context.Context, eventType, productKey string, data any) error
}

// StoreOperations defines store methods needed by Worker.
// This interface allows testing with mocks without duplicating Worker logic.
type StoreOperations interface {
	ProcessDueResetsWithOutbox(ctx context.Context, batchSize int) (int, error)
	ProcessDueExpirationsWithOutbox(ctx context.Context, batchSize int) (int, error)
	DrainWebhookOutbox(ctx context.Context, batchSize int) ([]store.OutboxEvent, error)
	MarkOutboxEventCompleted(ctx context.Context, eventID string) error
	MarkOutboxEventFailed(ctx context.Context, eventID string, errMsg string, maxAttempts int) error
	CleanupCompletedOutboxEvents(ctx context.Context, retentionDays int) (int64, error)
}

// Worker processes periodic budget item resets and expirations.
type Worker struct {
	store               StoreOperations
	webhooks            WebhookDeliverer
	interval            time.Duration
	batchSize           int
	outboxDrainBatch    int
	outboxMaxAttempts   int
	outboxRetentionDays int
	lastCleanup         time.Time
}

// New creates a new background worker.
// All configuration values must be positive; config.Load() ensures valid defaults.
func New(st StoreOperations, wh WebhookDeliverer, interval time.Duration, batchSize int, outboxDrainBatch, outboxMaxAttempts, outboxRetentionDays int) *Worker {
	return &Worker{
		store:               st,
		webhooks:            wh,
		interval:            interval,
		batchSize:           batchSize,
		outboxDrainBatch:    outboxDrainBatch,
		outboxMaxAttempts:   outboxMaxAttempts,
		outboxRetentionDays: outboxRetentionDays,
	}
}

// Run starts the worker loop. Blocks until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	slog.Info("worker.started", "interval", w.interval.String(), "batchSize", w.batchSize,
		"outboxDrainBatch", w.outboxDrainBatch, "outboxMaxAttempts", w.outboxMaxAttempts)

	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	// Run immediately on startup, then on interval
	w.tick(ctx)

	for {
		select {
		case <-ctx.Done():
			slog.Info("worker.stopped")
			return
		case <-ticker.C:
			w.tick(ctx)
		}
	}
}

func (w *Worker) tick(ctx context.Context) {
	w.processResets(ctx)
	w.processExpirations(ctx)
	w.drainOutbox(ctx)
	w.maybeCleanupOutbox(ctx)
}

func (w *Worker) processResets(ctx context.Context) {
	count, err := w.store.ProcessDueResetsWithOutbox(ctx, w.batchSize)
	if err != nil {
		slog.Error("worker.resets.failed", "error", err)
		return
	}
	if count > 0 {
		slog.Info("worker.resets.processed", "count", count)
	}
}

func (w *Worker) processExpirations(ctx context.Context) {
	count, err := w.store.ProcessDueExpirationsWithOutbox(ctx, w.batchSize)
	if err != nil {
		slog.Error("worker.expirations.failed", "error", err)
		return
	}
	if count > 0 {
		slog.Info("worker.expirations.processed", "count", count)
	}
}

func (w *Worker) drainOutbox(ctx context.Context) {
	events, err := w.store.DrainWebhookOutbox(ctx, w.outboxDrainBatch)
	if err != nil {
		slog.Error("worker.outbox.drain.failed", "error", err)
		return
	}
	if len(events) == 0 {
		return
	}

	slog.Info("worker.outbox.draining", "count", len(events))

	delivered := 0
	failed := 0
	for _, event := range events {
		var payload map[string]any
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			slog.Error("worker.outbox.unmarshal.failed", "eventId", event.ID, "error", err)
			if markErr := w.store.MarkOutboxEventFailed(ctx, event.ID, err.Error(), w.outboxMaxAttempts); markErr != nil {
				slog.Error("worker.outbox.mark.failed", "eventId", event.ID, "error", markErr)
			}
			failed++
			continue
		}

		err := w.webhooks.DeliverEventWebhooks(ctx, event.EventType, event.ProductKey, payload)
		if err != nil {
			slog.Warn("worker.outbox.delivery.failed", "eventId", event.ID, "eventType", event.EventType,
				"attempt", event.AttemptCount, "error", err)
			if markErr := w.store.MarkOutboxEventFailed(ctx, event.ID, err.Error(), w.outboxMaxAttempts); markErr != nil {
				slog.Error("worker.outbox.mark.failed", "eventId", event.ID, "error", markErr)
			}
			failed++
			continue
		}

		if markErr := w.store.MarkOutboxEventCompleted(ctx, event.ID); markErr != nil {
			slog.Error("worker.outbox.mark.completed.failed", "eventId", event.ID, "error", markErr)
		}
		delivered++
	}

	slog.Info("worker.outbox.drained", "delivered", delivered, "failed", failed)
}

func (w *Worker) maybeCleanupOutbox(ctx context.Context) {
	// Run cleanup once per hour
	if time.Since(w.lastCleanup) < time.Hour {
		return
	}
	w.lastCleanup = time.Now()

	deleted, err := w.store.CleanupCompletedOutboxEvents(ctx, w.outboxRetentionDays)
	if err != nil {
		slog.Error("worker.outbox.cleanup.failed", "error", err)
		return
	}
	if deleted > 0 {
		slog.Info("worker.outbox.cleanup.completed", "deleted", deleted)
	}
}

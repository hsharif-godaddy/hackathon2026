package worker

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
	"github.com/shopspring/decimal"
)

type mockWebhookDeliverer struct {
	deliveries []webhookDelivery
	mu         sync.Mutex
	err        error
}

type webhookDelivery struct {
	eventType  string
	productKey string
	data       any
}

func (m *mockWebhookDeliverer) DeliverEventWebhooks(ctx context.Context, eventType, productKey string, data any) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.deliveries = append(m.deliveries, webhookDelivery{
		eventType:  eventType,
		productKey: productKey,
		data:       data,
	})
	return m.err
}

func TestNewCustomValues(t *testing.T) {
	t.Parallel()
	w := New(nil, nil, 5*time.Minute, 100, 50, 10, 14)
	if w.interval != 5*time.Minute {
		t.Fatalf("interval = %v want 5m", w.interval)
	}
	if w.batchSize != 100 {
		t.Fatalf("batchSize = %d want 100", w.batchSize)
	}
	if w.outboxDrainBatch != 50 {
		t.Fatalf("outboxDrainBatch = %d want 50", w.outboxDrainBatch)
	}
	if w.outboxMaxAttempts != 10 {
		t.Fatalf("outboxMaxAttempts = %d want 10", w.outboxMaxAttempts)
	}
	if w.outboxRetentionDays != 14 {
		t.Fatalf("outboxRetentionDays = %d want 14", w.outboxRetentionDays)
	}
}

func TestDrainOutboxDeliversEvents(t *testing.T) {
	t.Parallel()

	payload := map[string]any{
		"budgetItemId": "item-1",
		"budgetId":     "budget-1",
	}
	payloadJSON, _ := json.Marshal(payload)

	events := []store.OutboxEvent{
		{
			ID:             "evt-1",
			EventType:      "budget-item.reset",
			ProductKey:     "product-a",
			Payload:        payloadJSON,
			AttemptCount:   1,
			IdempotencyKey: "budget-item.reset:item-1:2026-04-15T00:00:00Z",
		},
		{
			ID:             "evt-2",
			EventType:      "budget-item.expired",
			ProductKey:     "product-b",
			Payload:        payloadJSON,
			AttemptCount:   1,
			IdempotencyKey: "budget-item.expired:item-2:2026-04-15T00:00:00Z",
		},
	}

	webhooks := &mockWebhookDeliverer{}
	mockStore := &mockOutboxStore{
		drainEvents: events,
	}

	w := New(mockStore, webhooks, time.Minute, 500, 100, 7, 7)
	w.drainOutbox(context.Background())

	webhooks.mu.Lock()
	defer webhooks.mu.Unlock()

	if len(webhooks.deliveries) != 2 {
		t.Fatalf("deliveries = %d want 2", len(webhooks.deliveries))
	}
	if webhooks.deliveries[0].eventType != "budget-item.reset" {
		t.Fatalf("first eventType = %s want budget-item.reset", webhooks.deliveries[0].eventType)
	}
	if webhooks.deliveries[1].eventType != "budget-item.expired" {
		t.Fatalf("second eventType = %s want budget-item.expired", webhooks.deliveries[1].eventType)
	}
}

func TestDrainOutboxMarksFailedOnDeliveryError(t *testing.T) {
	t.Parallel()

	payload := map[string]any{"budgetItemId": "item-1"}
	payloadJSON, _ := json.Marshal(payload)

	events := []store.OutboxEvent{
		{
			ID:             "evt-1",
			EventType:      "budget-item.reset",
			ProductKey:     "product-a",
			Payload:        payloadJSON,
			AttemptCount:   1,
			IdempotencyKey: "budget-item.reset:item-1:2026-04-15T00:00:00Z",
		},
	}

	webhooks := &mockWebhookDeliverer{err: errors.New("connection refused")}
	mockStore := &mockOutboxStore{
		drainEvents: events,
	}

	w := New(mockStore, webhooks, time.Minute, 500, 100, 7, 7)
	w.drainOutbox(context.Background())

	mockStore.mu.Lock()
	defer mockStore.mu.Unlock()

	if len(mockStore.failedEvents) != 1 {
		t.Fatalf("failedEvents = %d want 1", len(mockStore.failedEvents))
	}
	if mockStore.failedEvents[0].ID != "evt-1" {
		t.Fatalf("failed event ID = %s want evt-1", mockStore.failedEvents[0].ID)
	}
}

func TestDrainOutboxMarksCompletedOnSuccess(t *testing.T) {
	t.Parallel()

	payload := map[string]any{"budgetItemId": "item-1"}
	payloadJSON, _ := json.Marshal(payload)

	events := []store.OutboxEvent{
		{
			ID:             "evt-1",
			EventType:      "budget-item.reset",
			ProductKey:     "product-a",
			Payload:        payloadJSON,
			AttemptCount:   1,
			IdempotencyKey: "budget-item.reset:item-1:2026-04-15T00:00:00Z",
		},
	}

	webhooks := &mockWebhookDeliverer{}
	mockStore := &mockOutboxStore{
		drainEvents: events,
	}

	w := New(mockStore, webhooks, time.Minute, 500, 100, 7, 7)
	w.drainOutbox(context.Background())

	mockStore.mu.Lock()
	defer mockStore.mu.Unlock()

	if len(mockStore.completedEvents) != 1 {
		t.Fatalf("completedEvents = %d want 1", len(mockStore.completedEvents))
	}
	if mockStore.completedEvents[0] != "evt-1" {
		t.Fatalf("completed event ID = %s want evt-1", mockStore.completedEvents[0])
	}
}

type seqErrWebhookDeliverer struct {
	mu  sync.Mutex
	n   int
	err error
}

func (s *seqErrWebhookDeliverer) DeliverEventWebhooks(ctx context.Context, eventType, productKey string, data any) error {
	s.mu.Lock()
	s.n++
	n := s.n
	s.mu.Unlock()
	if n == 2 {
		return s.err
	}
	return nil
}

func TestDrainOutboxBatchMarksCompletedAndFailedSeparately(t *testing.T) {
	t.Parallel()

	payload := map[string]any{"budgetItemId": "item-1"}
	payloadJSON, _ := json.Marshal(payload)

	events := []store.OutboxEvent{
		{
			ID:             "evt-ok",
			EventType:      "budget-item.reset",
			ProductKey:     "product-a",
			Payload:        payloadJSON,
			AttemptCount:   1,
			IdempotencyKey: "budget-item.reset:ok:2026-04-15T00:00:00Z",
		},
		{
			ID:             "evt-bad",
			EventType:      "budget-item.reset",
			ProductKey:     "product-a",
			Payload:        payloadJSON,
			AttemptCount:   1,
			IdempotencyKey: "budget-item.reset:bad:2026-04-15T00:00:00Z",
		},
	}

	webhooks := &seqErrWebhookDeliverer{err: errors.New("second delivery")}
	mockStore := &mockOutboxStore{drainEvents: events}
	w := New(mockStore, webhooks, time.Minute, 500, 100, 7, 7)
	w.drainOutbox(context.Background())

	mockStore.mu.Lock()
	defer mockStore.mu.Unlock()

	if len(mockStore.completedEvents) != 1 || mockStore.completedEvents[0] != "evt-ok" {
		t.Fatalf("completedEvents = %v want [evt-ok]", mockStore.completedEvents)
	}
	if len(mockStore.failedEvents) != 1 || mockStore.failedEvents[0].ID != "evt-bad" {
		t.Fatalf("failedEvents = %v want one evt-bad", mockStore.failedEvents)
	}
}

func TestProcessResetsWithOutbox(t *testing.T) {
	t.Parallel()

	mockStore := &mockOutboxStore{
		resetCount: 3,
	}

	w := New(mockStore, &mockWebhookDeliverer{}, time.Minute, 500, 100, 7, 7)
	w.processResets(context.Background())

	mockStore.mu.Lock()
	defer mockStore.mu.Unlock()

	if mockStore.resetCalls != 1 {
		t.Fatalf("resetCalls = %d want 1", mockStore.resetCalls)
	}
}

func TestProcessExpirationsWithOutbox(t *testing.T) {
	t.Parallel()

	mockStore := &mockOutboxStore{
		expirationCount: 2,
	}

	w := New(mockStore, &mockWebhookDeliverer{}, time.Minute, 500, 100, 7, 7)
	w.processExpirations(context.Background())

	mockStore.mu.Lock()
	defer mockStore.mu.Unlock()

	if mockStore.expirationCalls != 1 {
		t.Fatalf("expirationCalls = %d want 1", mockStore.expirationCalls)
	}
}

func TestRunStopsOnContextCancel(t *testing.T) {
	t.Parallel()

	webhooks := &mockWebhookDeliverer{}
	mockStore := &mockOutboxStore{}
	w := New(mockStore, webhooks, 100*time.Millisecond, 500, 100, 7, 7)

	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		w.Run(ctx)
		close(done)
	}()

	// Let it run at least one tick
	time.Sleep(150 * time.Millisecond)
	cancel()

	select {
	case <-done:
		// Success - Run exited
	case <-time.After(time.Second):
		t.Fatal("Run did not stop within timeout")
	}
}

func TestTickCallsAllProcessors(t *testing.T) {
	t.Parallel()

	mockStore := &mockOutboxStore{}

	w := New(mockStore, &mockWebhookDeliverer{}, time.Minute, 500, 100, 7, 7)
	w.tick(context.Background())

	mockStore.mu.Lock()
	defer mockStore.mu.Unlock()

	if mockStore.resetCalls != 1 {
		t.Fatal("processResets not called")
	}
	if mockStore.expirationCalls != 1 {
		t.Fatal("processExpirations not called")
	}
	if mockStore.drainCalls != 1 {
		t.Fatal("drainOutbox not called")
	}
}

// Legacy tests for ResetResult and ExpirationResult payloads

func TestResetResultToPayload(t *testing.T) {
	t.Parallel()

	r := store.ResetResult{
		BudgetItemID:  "item-1",
		BudgetID:      "budget-1",
		ProductKey:    "product-a",
		CreditsReset:  decimal.RequireFromString("10.5"),
		CreditsTotal:  decimal.RequireFromString("100"),
		NextResetsAt:  time.Date(2026, 5, 15, 12, 0, 0, 0, time.UTC),
		ResetInterval: "1mo",
	}

	payload := r.ToPayload()

	if payload["budgetItemId"] != "item-1" {
		t.Fatalf("budgetItemId = %v want item-1", payload["budgetItemId"])
	}
	if payload["creditsReset"] != "10.500000" {
		t.Fatalf("creditsReset = %v want 10.500000", payload["creditsReset"])
	}
}

func TestExpirationResultToPayload(t *testing.T) {
	t.Parallel()

	e := store.ExpirationResult{
		BudgetItemID:     "item-1",
		BudgetID:         "budget-1",
		ProductKey:       "product-a",
		ExpiredAt:        time.Date(2026, 4, 15, 0, 0, 0, 0, time.UTC),
		CreditsRemaining: decimal.RequireFromString("75"),
		CreditsTotal:     decimal.RequireFromString("100"),
	}

	payload := e.ToPayload()

	if payload["budgetItemId"] != "item-1" {
		t.Fatalf("budgetItemId = %v want item-1", payload["budgetItemId"])
	}
	if payload["creditsRemaining"] != "75.000000" {
		t.Fatalf("creditsRemaining = %v want 75.000000", payload["creditsRemaining"])
	}
}

// mockOutboxStore is a mock for testing the outbox pattern
type mockOutboxStore struct {
	mu              sync.Mutex
	drainEvents     []store.OutboxEvent
	drainErr        error
	drainCalls      int
	completedEvents []string
	failedEvents    []failedEvent
	resetCount      int
	resetErr        error
	resetCalls      int
	expirationCount int
	expirationErr   error
	expirationCalls int
	cleanupDeleted  int64
	cleanupErr      error
	cleanupCalls    int
}

type failedEvent struct {
	ID  string
	Err string
}

func (m *mockOutboxStore) ProcessDueResetsWithOutbox(ctx context.Context, batchSize int) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resetCalls++
	return m.resetCount, m.resetErr
}

func (m *mockOutboxStore) ProcessDueExpirationsWithOutbox(ctx context.Context, batchSize int) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.expirationCalls++
	return m.expirationCount, m.expirationErr
}

func (m *mockOutboxStore) DrainWebhookOutbox(ctx context.Context, batchSize int) ([]store.OutboxEvent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.drainCalls++
	return m.drainEvents, m.drainErr
}

func (m *mockOutboxStore) MarkOutboxEventCompleted(ctx context.Context, eventID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.completedEvents = append(m.completedEvents, eventID)
	return nil
}

func (m *mockOutboxStore) MarkOutboxEventsCompleted(ctx context.Context, eventIDs []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.completedEvents = append(m.completedEvents, eventIDs...)
	return nil
}

func (m *mockOutboxStore) MarkOutboxEventFailed(ctx context.Context, eventID string, errMsg string, maxAttempts int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.failedEvents = append(m.failedEvents, failedEvent{ID: eventID, Err: errMsg})
	return nil
}

func (m *mockOutboxStore) MarkOutboxEventsFailed(ctx context.Context, failures []store.OutboxDeliveryFailure, maxAttempts int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range failures {
		m.failedEvents = append(m.failedEvents, failedEvent{ID: failures[i].EventID, Err: failures[i].ErrMsg})
	}
	return nil
}

func (m *mockOutboxStore) CleanupCompletedOutboxEvents(ctx context.Context, retentionDays int) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanupCalls++
	return m.cleanupDeleted, m.cleanupErr
}

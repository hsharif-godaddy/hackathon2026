package store

import (
	"errors"
	"testing"

	"github.com/lib/pq"
)

func TestMapFKNotFound(t *testing.T) {
	t.Parallel()

	t.Run("pq_error_23503_returns_ErrNotFound", func(t *testing.T) {
		t.Parallel()
		err := &pq.Error{Code: "23503"}
		got := mapFKNotFound(err)
		if !errors.Is(got, ErrNotFound) {
			t.Errorf("expected ErrNotFound, got %v", got)
		}
	})

	t.Run("pq_error_other_code_returns_original", func(t *testing.T) {
		t.Parallel()
		err := &pq.Error{Code: "23505"}
		got := mapFKNotFound(err)
		if got != err {
			t.Errorf("expected original error %v, got %v", err, got)
		}
	})

	t.Run("plain_error_returns_original", func(t *testing.T) {
		t.Parallel()
		err := errors.New("some plain error")
		got := mapFKNotFound(err)
		if got != err {
			t.Errorf("expected original error %v, got %v", err, got)
		}
	})
}

func TestMapReportSessionUnique(t *testing.T) {
	t.Parallel()

	t.Run("pq_error_23505_returns_ErrAlreadyReconciled", func(t *testing.T) {
		t.Parallel()
		err := &pq.Error{Code: "23505"}
		got := mapReportSessionUnique(err)
		if !errors.Is(got, ErrAlreadyReconciled) {
			t.Errorf("expected ErrAlreadyReconciled, got %v", got)
		}
	})

	t.Run("pq_error_other_code_returns_original", func(t *testing.T) {
		t.Parallel()
		err := &pq.Error{Code: "23503"}
		got := mapReportSessionUnique(err)
		if got != err {
			t.Errorf("expected original error %v, got %v", err, got)
		}
	})

	t.Run("plain_error_returns_original", func(t *testing.T) {
		t.Parallel()
		err := errors.New("some plain error")
		got := mapReportSessionUnique(err)
		if got != err {
			t.Errorf("expected original error %v, got %v", err, got)
		}
	})
}

package api

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/mux"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
)

type postProductBody struct {
	ProductKey string `json:"productKey"`
}

func productToResponse(r store.ProductRow) map[string]string {
	return map[string]string{
		"productKey": r.ProductKey,
		"createdAt":  r.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updatedAt":  r.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func writeProductStoreError(w http.ResponseWriter, op string, err error) {
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "CONFLICT", "productKey already registered")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "resource not found")
		return
	}
	if errors.Is(err, store.ErrProductHasActiveBudgets) {
		writeError(w, http.StatusConflict, "CONFLICT", "active budgets reference this product")
		return
	}
	slog.Error(op, "error", err)
	writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
}

func (s *Server) getProducts(w http.ResponseWriter, r *http.Request) {
	if !s.requireStore(w) {
		return
	}
	rows, err := s.Store.ListProducts(r.Context())
	if err != nil {
		writeProductStoreError(w, "product.list", err)
		return
	}
	out := make([]map[string]string, 0, len(rows))
	for i := range rows {
		out = append(out, productToResponse(rows[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) postProduct(w http.ResponseWriter, r *http.Request) {
	var payload postProductBody
	if !decodeJSONBody(w, r, &payload, false) {
		return
	}
	key := strings.TrimSpace(payload.ProductKey)
	if key == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey is required")
		return
	}
	if msg := validateIdentifier(key); msg != "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey "+msg)
		return
	}
	if !s.requireStore(w) {
		return
	}
	row, err := s.Store.CreateProduct(r.Context(), key)
	if err != nil {
		writeProductStoreError(w, "product.create", err)
		return
	}
	writeJSON(w, http.StatusCreated, productToResponse(row))
}

func (s *Server) deleteProduct(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimSpace(mux.Vars(r)["productKey"])
	if key == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey is required")
		return
	}
	dec, err := url.PathUnescape(key)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey contains invalid percent-encoding")
		return
	}
	key = dec
	if msg := validateIdentifier(key); msg != "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey "+msg)
		return
	}
	if !s.requireStore(w) {
		return
	}
	if err := s.Store.SoftDeleteProduct(r.Context(), key); err != nil {
		writeProductStoreError(w, "product.delete", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

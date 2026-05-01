// Local E2E only: accepts webhook POSTs and exposes GET /__e2e/last for assertions.
package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
)

const maxBody = 1 << 20

var (
	mu       sync.Mutex
	lastBody []byte
)

func main() {
	addr := ":9090"
	if p := os.Getenv("LISTEN_ADDR"); p != "" {
		addr = p
	}
	http.HandleFunc("/", router)
	log.Printf("webhook-sink listening %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

func router(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/__e2e/last":
		lastHandler(w, r)
		return
	case "/__e2e/reset":
		resetHandler(w, r)
		return
	default:
		webhookHandler(w, r)
	}
}

func lastHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mu.Lock()
	b := append([]byte(nil), lastBody...)
	mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"body": string(b)})
}

func resetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mu.Lock()
	lastBody = nil
	mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func webhookHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	mu.Lock()
	lastBody = b
	mu.Unlock()
	w.WriteHeader(http.StatusOK)
}

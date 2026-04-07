package slack

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

func TestPostStoresTimestamp(t *testing.T) {
	var mu sync.Mutex
	var received postRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("reading body: %v", err)
		}
		mu.Lock()
		defer mu.Unlock()
		if err := json.Unmarshal(body, &received); err != nil {
			t.Errorf("unmarshalling body: %v", err)
		}

		if r.Header.Get("Authorization") == "" {
			t.Error("missing Authorization header")
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(apiResponse{OK: true, TS: "1234567890.123456"})
	}))
	defer server.Close()

	n := New("xoxb-test-token", "C12345")
	n.baseURL = server.URL
	n.Post(context.Background(), "hello world")

	mu.Lock()
	defer mu.Unlock()
	if received.Channel != "C12345" {
		t.Errorf("Channel = %q, want %q", received.Channel, "C12345")
	}
	if received.MarkdownText != "hello world" {
		t.Errorf("MarkdownText = %q, want %q", received.MarkdownText, "hello world")
	}
	if n.ts != "1234567890.123456" {
		t.Errorf("ts = %q, want %q", n.ts, "1234567890.123456")
	}
}

func TestPostUsesMarkdownTextField(t *testing.T) {
	var mu sync.Mutex
	var rawBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("reading body: %v", err)
		}
		mu.Lock()
		defer mu.Unlock()
		if err := json.Unmarshal(body, &rawBody); err != nil {
			t.Errorf("unmarshalling body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(apiResponse{OK: true, TS: "1.1"})
	}))
	defer server.Close()

	n := New("xoxb-test-token", "C12345")
	n.baseURL = server.URL
	n.Post(context.Background(), "**bold** message")

	mu.Lock()
	defer mu.Unlock()
	if _, ok := rawBody["text"]; ok {
		t.Error("request should not contain 'text' field")
	}
	if _, ok := rawBody["mrkdwn"]; ok {
		t.Error("request should not contain 'mrkdwn' field")
	}
	if rawBody["markdown_text"] != "**bold** message" {
		t.Errorf("markdown_text = %q, want %q", rawBody["markdown_text"], "**bold** message")
	}
}

func TestUpdateUsesStoredTimestamp(t *testing.T) {
	var mu sync.Mutex
	var received updateRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("reading body: %v", err)
		}
		mu.Lock()
		defer mu.Unlock()
		if err := json.Unmarshal(body, &received); err != nil {
			t.Errorf("unmarshalling body: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(apiResponse{OK: true, TS: "1234567890.123456"})
	}))
	defer server.Close()

	n := New("xoxb-test-token", "C12345")
	n.baseURL = server.URL
	n.ts = "1234567890.123456"

	n.Update(context.Background(), "updated text")

	mu.Lock()
	defer mu.Unlock()
	if received.TS != "1234567890.123456" {
		t.Errorf("TS = %q, want %q", received.TS, "1234567890.123456")
	}
	if received.MarkdownText != "updated text" {
		t.Errorf("MarkdownText = %q, want %q", received.MarkdownText, "updated text")
	}
	if received.Channel != "C12345" {
		t.Errorf("Channel = %q, want %q", received.Channel, "C12345")
	}
}

func TestUpdateFallsBackToPost(t *testing.T) {
	var mu sync.Mutex
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		endpoint = r.URL.Path
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(apiResponse{OK: true, TS: "9999.9999"})
	}))
	defer server.Close()

	n := New("xoxb-test-token", "C12345")
	n.baseURL = server.URL

	n.Update(context.Background(), "first message")

	mu.Lock()
	defer mu.Unlock()
	if endpoint != "/chat.postMessage" {
		t.Errorf("expected fallback to /chat.postMessage, got %q", endpoint)
	}
	if n.ts != "9999.9999" {
		t.Errorf("ts = %q, want %q", n.ts, "9999.9999")
	}
}

func TestUpdateDedupSkipsAPICall(t *testing.T) {
	var callCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount.Add(1)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(apiResponse{OK: true, TS: "1.1"})
	}))
	defer server.Close()

	n := New("xoxb-test-token", "C12345")
	n.baseURL = server.URL
	n.ts = "original.ts"
	n.lastText = "same text"

	n.Update(context.Background(), "same text")

	if callCount.Load() != 0 {
		t.Errorf("expected dedup to skip API call, got %d calls", callCount.Load())
	}
}

func TestConcurrentUpdatesOnlyOnePost(t *testing.T) {
	var postCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/chat.postMessage" {
			postCount.Add(1)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(apiResponse{OK: true, TS: "1.1"})
	}))
	defer server.Close()

	n := New("xoxb-test-token", "C12345")
	n.baseURL = server.URL

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			n.Update(context.Background(), "concurrent message")
		}()
	}
	wg.Wait()

	if postCount.Load() != 1 {
		t.Errorf("concurrent updates should result in exactly 1 post, got %d", postCount.Load())
	}
}

func TestPostNilNotifier(t *testing.T) {
	var n *Notifier
	n.Post(context.Background(), "should not panic")
}

func TestUpdateNilNotifier(t *testing.T) {
	var n *Notifier
	n.Update(context.Background(), "should not panic")
}

func TestPostAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(apiResponse{OK: false, Error: "channel_not_found"})
	}))
	defer server.Close()

	n := New("xoxb-test-token", "C12345")
	n.baseURL = server.URL
	n.Post(context.Background(), "test")

	if n.ts != "" {
		t.Errorf("ts should be empty after API error, got %q", n.ts)
	}
}

func TestPostCancelledContext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(apiResponse{OK: true, TS: "1111.1111"})
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	n := New("xoxb-test-token", "C12345")
	n.baseURL = server.URL
	n.Post(ctx, "test")
}

func TestPermalinkWithTimestamp(t *testing.T) {
	n := New("xoxb-test-token", "C09AR7XDLDT")
	n.ts = "1775231376.691499"

	got := n.Permalink()
	want := "https://godaddy.slack.com/archives/C09AR7XDLDT/p1775231376691499"
	if got != want {
		t.Errorf("Permalink() = %q, want %q", got, want)
	}
}

func TestPermalinkNoTimestamp(t *testing.T) {
	n := New("xoxb-test-token", "C12345")

	got := n.Permalink()
	if got != "" {
		t.Errorf("Permalink() = %q, want empty string when no message posted", got)
	}
}

func TestPermalinkNilNotifier(t *testing.T) {
	var n *Notifier
	got := n.Permalink()
	if got != "" {
		t.Errorf("Permalink() on nil = %q, want empty string", got)
	}
}

func TestFetchCredentialsInvalidSecret(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	_, err := FetchCredentials(ctx, "nonexistent-secret-name-12345", "")
	if err == nil {
		t.Fatal("expected error for invalid secret name")
	}
}

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

// TestUpdateRepostsWhenEditFails covers the self-heal: when the in-place
// chat.update fails (a stale ts, an uneditable message, a transient Slack
// error), Update must NOT leave the message stranded on its last good edit —
// e.g. a successful prod release stuck on the test phase's "Awaiting prod
// approval" CTA. It re-posts as a fresh message and adopts that ts so the true
// status is visible and subsequent edits land.
func TestUpdateRepostsWhenEditFails(t *testing.T) {
	var mu sync.Mutex
	var updates, posts int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/chat.update":
			updates++
			json.NewEncoder(w).Encode(apiResponse{OK: false, Error: "message_not_found"})
		case "/chat.postMessage":
			posts++
			json.NewEncoder(w).Encode(apiResponse{OK: true, TS: "reposted.ts"})
		default:
			t.Errorf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	n := New("xoxb-test-token", "C12345")
	n.baseURL = server.URL
	n.SeedTS("stale.ts") // a prod phase seeding the test phase's ts

	n.Update(context.Background(), "Deploying to prod")

	mu.Lock()
	defer mu.Unlock()
	if updates != 1 {
		t.Errorf("expected exactly 1 chat.update attempt, got %d", updates)
	}
	if posts != 1 {
		t.Errorf("expected self-heal to repost via chat.postMessage exactly once, got %d", posts)
	}
	if n.ts != "reposted.ts" {
		t.Errorf("ts should adopt the reposted message, got %q", n.ts)
	}
	if n.lastText != "Deploying to prod" {
		t.Errorf("lastText should be set after repost (so later edits dedup), got %q", n.lastText)
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

func TestPostReplyIsAFreshThreadedBroadcast(t *testing.T) {
	var mu sync.Mutex
	var got postRequest
	var path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		path = r.URL.Path
		_ = json.Unmarshal(body, &got)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(apiResponse{OK: true, TS: "999.999"})
	}))
	defer server.Close()

	n := New("xoxb-test", "C1")
	n.baseURL = server.URL
	n.SeedTS("123.456") // an existing status message to thread under

	n.PostReply(context.Background(), "ping <@U1>")

	mu.Lock()
	defer mu.Unlock()
	// It must be a fresh post (chat.postMessage), NOT an edit — edits don't notify.
	if path != "/chat.postMessage" {
		t.Errorf("PostReply hit %q, want /chat.postMessage", path)
	}
	if got.ThreadTS != "123.456" || !got.ReplyBroadcast {
		t.Errorf("reply not a broadcast thread reply: thread_ts=%q reply_broadcast=%v", got.ThreadTS, got.ReplyBroadcast)
	}
	if got.MarkdownText != "ping <@U1>" {
		t.Errorf("reply text = %q", got.MarkdownText)
	}
	// The status message's ts must be untouched (the reply has its own ts).
	if n.TS() != "123.456" {
		t.Errorf("PostReply clobbered the status ts: %q", n.TS())
	}
}

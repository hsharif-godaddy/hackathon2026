package slack

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func resolveServer(t *testing.T, usersJSON, groupsJSON string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			t.Error("missing Authorization header")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/users.list":
			io.WriteString(w, usersJSON)
		case "/usergroups.list":
			io.WriteString(w, groupsJSON)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
}

func TestResolveMentions(t *testing.T) {
	users := `{"ok":true,"members":[
		{"id":"U_JE","name":"jeichorn"},
		{"id":"U_HD","name":"hdewan","profile":{"display_name":"Harsh D"}},
		{"id":"U_DEL","name":"ghost","deleted":true}
	],"response_metadata":{"next_cursor":""}}`
	groups := `{"ok":true,"usergroups":[
		{"id":"S_SRE","handle":"ask-airo-sre"},
		{"id":"S_OLD","handle":"retired","date_delete":1700000000}
	]}`
	srv := resolveServer(t, users, groups)
	defer srv.Close()

	n := New("xoxb-test", "C1")
	n.baseURL = srv.URL

	// username, @-prefixed + mixed case, a group handle, a deleted user, and an
	// unknown handle (skipped).
	got := n.ResolveMentions(context.Background(), []string{"jeichorn", "@HDEWAN", "ask-airo-sre", "ghost", "nobody"})
	want := []string{"<@U_JE>", "<@U_HD>", "<!subteam^S_SRE>"}
	if len(got) != len(want) {
		t.Fatalf("ResolveMentions = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("mention[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestResolveMentionsMissingScope(t *testing.T) {
	// users.list denied (missing scope) — degrade gracefully: still resolve
	// groups, drop the unresolvable user, never panic.
	srv := resolveServer(t,
		`{"ok":false,"error":"missing_scope"}`,
		`{"ok":true,"usergroups":[{"id":"S_SRE","handle":"ask-airo-sre"}]}`)
	defer srv.Close()

	n := New("xoxb-test", "C1")
	n.baseURL = srv.URL

	got := n.ResolveMentions(context.Background(), []string{"jeichorn", "ask-airo-sre"})
	if len(got) != 1 || got[0] != "<!subteam^S_SRE>" {
		t.Errorf("ResolveMentions = %v, want [<!subteam^S_SRE>]", got)
	}
}

func TestResolveMentionMap(t *testing.T) {
	users := `{"ok":true,"members":[
		{"id":"U_JE","name":"jeichorn"},
		{"id":"U_HD","name":"hdewan","profile":{"display_name":"Harsh D"}}
	],"response_metadata":{"next_cursor":""}}`
	groups := `{"ok":true,"usergroups":[]}`
	srv := resolveServer(t, users, groups)
	defer srv.Close()

	n := New("xoxb-test", "C1")
	n.baseURL = srv.URL

	got := n.ResolveMentionMap(context.Background(), []string{"hdewan", "jeichorn", "nobody"})
	if got["hdewan"] != "<@U_HD>" {
		t.Errorf("hdewan = %q, want <@U_HD>", got["hdewan"])
	}
	if got["jeichorn"] != "<@U_JE>" {
		t.Errorf("jeichorn = %q, want <@U_JE>", got["jeichorn"])
	}
	if _, exists := got["nobody"]; exists {
		t.Errorf("nobody should not be in map, got %q", got["nobody"])
	}
}

func TestResolveMentionMapNil(t *testing.T) {
	var n *Notifier
	got := n.ResolveMentionMap(context.Background(), []string{"hdewan"})
	if got != nil {
		t.Errorf("nil notifier should return nil, got %v", got)
	}
}

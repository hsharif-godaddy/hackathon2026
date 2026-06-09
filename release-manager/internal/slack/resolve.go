package slack

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/airo-ai-builder/release-manager/internal/logger"
)

// ResolveMentions maps plain Slack handles (a username like "jeichorn" or a
// user-group handle like "ask-airo-sre") to mention tokens — "<@U123>" for a
// person, "<!subteam^S123>" for a group — for embedding in a message.
//
// Slack's API only NOTIFIES on the encoded token; a raw "@handle" in
// markdown_text is inert text. We can't hardcode IDs (they're opaque), so we
// fetch the workspace's users + user groups once, match each handle (user
// first, then group, case-insensitively), and emit the token.
//
// Best-effort: a handle that matches nothing is logged and skipped, and a fetch
// error (e.g. the bot is missing the users:read / usergroups:read scope) logs a
// warning and drops the affected mentions — the release is never blocked, it
// just posts without those pings. Returns nil for a nil notifier / no handles.
func (n *Notifier) ResolveMentions(ctx context.Context, handles []string) []string {
	if n == nil || len(handles) == 0 {
		return nil
	}

	users, err := n.listUsers(ctx)
	if err != nil {
		logger.Log("slack.warn: users.list failed (%v); approver mentions skipped — add the users:read scope to the bot", err)
	}
	groups, err := n.listUserGroups(ctx)
	if err != nil {
		logger.Log("slack.warn: usergroups.list failed (%v); group mentions skipped — add the usergroups:read scope to the bot", err)
	}

	out := make([]string, 0, len(handles))
	for _, h := range handles {
		key := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(h), "@"))
		if key == "" {
			continue
		}
		if id, ok := users[key]; ok {
			out = append(out, "<@"+id+">")
			continue
		}
		if id, ok := groups[key]; ok {
			out = append(out, "<!subteam^"+id+">")
			continue
		}
		logger.Log("slack.warn: approver handle %q matched no Slack user or group; skipping", h)
	}
	return out
}

// listUsers builds a case-insensitive {username|display_name → user ID} map from
// the paginated users.list. Deleted users are skipped; the username (the thing
// you type after @) wins over display name on collision.
func (n *Notifier) listUsers(ctx context.Context) (map[string]string, error) {
	out := map[string]string{}
	cursor := ""
	for page := 0; page < 50; page++ { // safety cap: 50 × 1000 = 50k users
		q := url.Values{"limit": {"1000"}}
		if cursor != "" {
			q.Set("cursor", cursor)
		}
		var resp struct {
			OK      bool   `json:"ok"`
			Error   string `json:"error"`
			Members []struct {
				ID      string `json:"id"`
				Name    string `json:"name"`
				Deleted bool   `json:"deleted"`
				Profile struct {
					DisplayName string `json:"display_name"`
				} `json:"profile"`
			} `json:"members"`
			ResponseMetadata struct {
				NextCursor string `json:"next_cursor"`
			} `json:"response_metadata"`
		}
		if err := n.getJSON(ctx, "/users.list", q, &resp); err != nil {
			return out, err
		}
		if !resp.OK {
			return out, fmt.Errorf("users.list: %s", resp.Error)
		}
		for _, m := range resp.Members {
			if m.Deleted || m.ID == "" {
				continue
			}
			if m.Name != "" {
				out[strings.ToLower(m.Name)] = m.ID
			}
			if dn := strings.ToLower(strings.TrimSpace(m.Profile.DisplayName)); dn != "" {
				if _, exists := out[dn]; !exists {
					out[dn] = m.ID
				}
			}
		}
		cursor = resp.ResponseMetadata.NextCursor
		if cursor == "" {
			break
		}
	}
	return out, nil
}

// listUserGroups builds a case-insensitive {handle → user-group ID} map.
func (n *Notifier) listUserGroups(ctx context.Context) (map[string]string, error) {
	var resp struct {
		OK         bool   `json:"ok"`
		Error      string `json:"error"`
		Usergroups []struct {
			ID         string `json:"id"`
			Handle     string `json:"handle"`
			DateDelete int    `json:"date_delete"` // 0 ⇒ active
		} `json:"usergroups"`
	}
	if err := n.getJSON(ctx, "/usergroups.list", nil, &resp); err != nil {
		return nil, err
	}
	if !resp.OK {
		return nil, fmt.Errorf("usergroups.list: %s", resp.Error)
	}
	out := map[string]string{}
	for _, g := range resp.Usergroups {
		if g.DateDelete != 0 || g.Handle == "" {
			continue
		}
		out[strings.ToLower(g.Handle)] = g.ID
	}
	return out, nil
}

// getJSON performs a GET against a Slack Web API method and decodes the JSON
// body into out. (Read methods like users.list/usergroups.list are GETs with
// query params, unlike the JSON POSTs in call().)
func (n *Notifier) getJSON(ctx context.Context, path string, q url.Values, out any) error {
	u := n.baseURL + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+n.token)

	resp, err := n.client.Do(req)
	if err != nil {
		return fmt.Errorf("sending request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading response: %w", err)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("parsing response: %w", err)
	}
	return nil
}

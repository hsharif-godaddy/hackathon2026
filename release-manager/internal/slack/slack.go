package slack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/airo-ai-builder/release-manager/internal/logger"
)

type Credentials struct {
	Token     string `json:"token"`
	ChannelID string `json:"channel_id"`
}

type Notifier struct {
	token     string
	channelID string
	client    *http.Client
	baseURL   string

	mu       sync.Mutex
	ts       string
	lastText string
}

func New(token, channelID string) *Notifier {
	return &Notifier{
		token:     token,
		channelID: channelID,
		client:    &http.Client{Timeout: 10 * time.Second},
		baseURL:   "https://slack.com/api",
	}
}

// FetchCredentials retrieves Slack bot credentials from AWS Secrets Manager.
// The secret must be JSON: {"token":"xoxb-...","channel_id":"C..."}
func FetchCredentials(ctx context.Context, secretName, awsProfile string) (*Credentials, error) {
	args := []string{
		"secretsmanager", "get-secret-value",
		"--secret-id", secretName,
		"--query", "SecretString",
		"--output", "text",
	}
	if awsProfile != "" {
		args = append(args, "--profile", awsProfile)
	}

	cmd := exec.CommandContext(ctx, "aws", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("aws secretsmanager: %w\n%s", err, strings.TrimSpace(string(out)))
	}

	var creds Credentials
	if err := json.Unmarshal(bytes.TrimSpace(out), &creds); err != nil {
		return nil, fmt.Errorf("parsing secret JSON: %w", err)
	}

	if creds.Token == "" {
		return nil, fmt.Errorf("secret missing \"token\" field")
	}
	if creds.ChannelID == "" {
		return nil, fmt.Errorf("secret missing \"channel_id\" field")
	}
	return &creds, nil
}

type postRequest struct {
	Channel string `json:"channel"`
	Text    string `json:"text"`
	Mrkdwn  bool   `json:"mrkdwn"`
}

type updateRequest struct {
	Channel string `json:"channel"`
	TS      string `json:"ts"`
	Text    string `json:"text"`
	Mrkdwn  bool   `json:"mrkdwn"`
}

type apiResponse struct {
	OK    bool   `json:"ok"`
	TS    string `json:"ts"`
	Error string `json:"error"`
}

// Post sends an initial message to Slack and stores the timestamp for future
// updates. Errors are logged but never returned to avoid disrupting the pipeline.
func (n *Notifier) Post(ctx context.Context, text string) {
	if n == nil {
		return
	}

	body, err := json.Marshal(postRequest{
		Channel: n.channelID,
		Text:    text,
		Mrkdwn:  true,
	})
	if err != nil {
		logger.Log("slack.error: marshalling post payload: %s", err)
		return
	}

	resp, err := n.call(ctx, n.baseURL+"/chat.postMessage", body)
	if err != nil {
		logger.Log("slack.error: postMessage: %s", err)
		return
	}

	n.mu.Lock()
	n.ts = resp.TS
	n.lastText = text
	n.mu.Unlock()

	logger.Log("slack.posted: ts=%s", resp.TS)
}

// Update edits the previously posted message with new content.
// Falls back to Post if no message has been posted yet.
func (n *Notifier) Update(ctx context.Context, text string) {
	if n == nil {
		return
	}

	n.mu.Lock()
	ts := n.ts
	if ts != "" && n.lastText == text {
		n.mu.Unlock()
		return
	}
	n.mu.Unlock()

	if ts == "" {
		n.Post(ctx, text)
		return
	}

	body, err := json.Marshal(updateRequest{
		Channel: n.channelID,
		TS:      ts,
		Text:    text,
		Mrkdwn:  true,
	})
	if err != nil {
		logger.Log("slack.error: marshalling update payload: %s", err)
		return
	}

	if _, err := n.call(ctx, n.baseURL+"/chat.update", body); err != nil {
		logger.Log("slack.error: chat.update: %s", err)
		return
	}

	n.mu.Lock()
	n.lastText = text
	n.mu.Unlock()

	logger.Log("slack.updated: ts=%s", ts)
}

// Permalink returns a direct link to the Slack message, or empty if no
// message has been posted yet.
func (n *Notifier) Permalink() string {
	if n == nil {
		return ""
	}
	n.mu.Lock()
	ts := n.ts
	n.mu.Unlock()
	if ts == "" {
		return ""
	}
	return fmt.Sprintf("https://godaddy.slack.com/archives/%s/p%s", n.channelID, strings.ReplaceAll(ts, ".", ""))
}

func (n *Notifier) call(ctx context.Context, url string, body []byte) (*apiResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Authorization", "Bearer "+n.token)

	resp, err := n.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sending request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	var apiResp apiResponse
	if err := json.Unmarshal(respBody, &apiResp); err != nil {
		return nil, fmt.Errorf("parsing response: %w", err)
	}

	if !apiResp.OK {
		return nil, fmt.Errorf("Slack API error: %s", apiResp.Error)
	}

	return &apiResp, nil
}

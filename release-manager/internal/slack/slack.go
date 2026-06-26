package slack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
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

	// mu serializes all Slack API operations. Multiple Bubble Tea commands
	// can fire concurrently (ticks, stage completions, etc.), so we hold the
	// lock for the entire duration of each Post/Update to prevent races like
	// duplicate initial posts.
	mu       sync.Mutex
	ts       string
	lastText string

	// logOnly makes Post/PostReply/Update print the would-be message to STDOUT
	// instead of calling the Slack API. Set only via NewLogOnly (notify_slack=off).
	logOnly bool

	// verbose surfaces Slack API failures to STDOUT (as GitHub Actions
	// ::warning:: annotations) in addition to the file log. Enable it ONLY on the
	// headless/CI path (Verbose()): the interactive TUI owns stdout, so a stray
	// write would corrupt its render. The release-manager logs to a file the GHA
	// run log does not surface, so without this a swallowed Slack error is
	// invisible (it cost a full investigation to even find one).
	verbose bool
}

func New(token, channelID string) *Notifier {
	return &Notifier{
		token:     token,
		channelID: channelID,
		client:    &http.Client{Timeout: 10 * time.Second},
		baseURL:   "https://slack.com/api",
	}
}

// NewLogOnly returns a Notifier that prints every would-be message to STDOUT
// instead of posting to Slack. Wired when notify_slack is off (the runner blanks
// the Slack creds, so CredentialsFromEnv returns ok=false). A real release then
// surfaces its Slack content in the GitHub Actions log without notifying the
// channel. Never used when creds are present.
func NewLogOnly() *Notifier {
	return &Notifier{logOnly: true}
}

// printLogOnly writes a would-be Slack message to STDOUT. logger.Log writes to a
// file that GitHub Actions does not surface, so this uses fmt to reach the run
// log. Only the log-only notifier calls it.
func printLogOnly(kind, text string) {
	fmt.Printf("::group::📣 SLACK %s (notify_slack off — would post)\n%s\n::endgroup::\n", kind, text)
}

// Verbose enables surfacing Slack failures to STDOUT (GHA ::warning::). Headless
// only — never call it on the TUI notifier. Returns the receiver for chaining.
func (n *Notifier) Verbose() *Notifier {
	if n != nil {
		n.verbose = true
	}
	return n
}

// warn records a Slack failure to the file log always, and to STDOUT as a GHA
// ::warning:: when verbose — so a swallowed Slack error is visible in the run
// log instead of only on the ephemeral runner's log file.
func (n *Notifier) warn(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	logger.Log("slack.error: %s", msg)
	if n.verbose {
		fmt.Printf("::warning::slack: %s\n", msg)
	}
}

// CredentialsFromEnv reads Slack credentials from the SLACK_BOT_TOKEN and
// SLACK_CHANNEL_ID environment variables. It returns ok=false when either is
// unset, so callers can fall back to FetchCredentials (AWS Secrets Manager).
// This is the path the headless/CI runner uses: GitHub Actions exports the two
// repo secrets as env vars, avoiding any AWS dependency on the runner.
func CredentialsFromEnv() (creds Credentials, ok bool) {
	token := os.Getenv("SLACK_BOT_TOKEN")
	channelID := os.Getenv("SLACK_CHANNEL_ID")
	if token == "" || channelID == "" {
		return Credentials{}, false
	}
	return Credentials{Token: token, ChannelID: channelID}, true
}

// SeedTS sets the message timestamp so the next Update edits an existing
// message instead of posting a new one. Used to thread a single Slack message
// across two separate headless process invocations (the test phase posts and
// emits its ts; the prod phase seeds it back before updating). No-op on a nil
// Notifier (Slack disabled).
func (n *Notifier) SeedTS(ts string) {
	if n == nil {
		return
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	n.ts = ts
}

// TS returns the timestamp of the posted message (empty if nothing has been
// posted yet, or on a nil Notifier). The test phase prints this so the prod
// phase can SeedTS it back.
func (n *Notifier) TS() string {
	if n == nil {
		return ""
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.ts
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

// postRequest uses markdown_text (12k char limit) instead of text (4k limit).
// markdown_text must not be combined with text or blocks.
type postRequest struct {
	Channel        string `json:"channel"`
	MarkdownText   string `json:"markdown_text"`
	ThreadTS       string `json:"thread_ts,omitempty"`       // reply under this message
	ReplyBroadcast bool   `json:"reply_broadcast,omitempty"` // also surface the reply in-channel
}

type updateRequest struct {
	Channel      string `json:"channel"`
	TS           string `json:"ts"`
	MarkdownText string `json:"markdown_text"`
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

	n.mu.Lock()
	defer n.mu.Unlock()
	if n.logOnly {
		n.lastText = text
		printLogOnly("status", text)
		return
	}
	n.post(ctx, text)
}

func (n *Notifier) post(ctx context.Context, text string) {
	body, err := json.Marshal(postRequest{
		Channel:      n.channelID,
		MarkdownText: text,
	})
	if err != nil {
		logger.Log("slack.error: marshalling post payload: %s", err)
		return
	}

	resp, err := n.call(ctx, n.baseURL+"/chat.postMessage", body)
	if err != nil {
		n.warn("chat.postMessage failed: %v", err)
		return
	}

	n.ts = resp.TS
	n.lastText = text

	logger.Log("slack.posted: ts=%s", resp.TS)
}

// PostReply posts a NEW message — a broadcast reply in the status message's
// thread when one exists, else a standalone post. Unlike Update (which EDITS
// the single status message via chat.update), this is a fresh chat.postMessage,
// so Slack actually delivers @-mention notifications: editing a message never
// notifies newly-added mentions, only a new post does. Used for the approval
// ping. Best-effort; does NOT touch the status message's ts.
func (n *Notifier) PostReply(ctx context.Context, text string) {
	if n == nil {
		return
	}
	n.mu.Lock()
	defer n.mu.Unlock()

	if n.logOnly {
		printLogOnly("reply", text)
		return
	}

	req := postRequest{Channel: n.channelID, MarkdownText: text}
	if n.ts != "" {
		req.ThreadTS = n.ts       // keep it attached to the release thread
		req.ReplyBroadcast = true // …but also surface it in-channel
	}
	body, err := json.Marshal(req)
	if err != nil {
		logger.Log("slack.error: marshalling reply payload: %s", err)
		return
	}
	if _, err := n.call(ctx, n.baseURL+"/chat.postMessage", body); err != nil {
		logger.Log("slack.error: approval ping reply: %s", err)
	}
}

// Update edits the previously posted message with new content.
// Falls back to Post if no message has been posted yet.
func (n *Notifier) Update(ctx context.Context, text string) {
	if n == nil {
		return
	}

	n.mu.Lock()
	defer n.mu.Unlock()

	if n.logOnly {
		if n.lastText == text {
			return
		}
		n.lastText = text
		printLogOnly("status update", text)
		return
	}

	if n.ts != "" && n.lastText == text {
		return
	}

	if n.ts == "" {
		n.post(ctx, text)
		return
	}

	body, err := json.Marshal(updateRequest{
		Channel:      n.channelID,
		TS:           n.ts,
		MarkdownText: text,
	})
	if err != nil {
		logger.Log("slack.error: marshalling update payload: %s", err)
		return
	}

	if _, err := n.call(ctx, n.baseURL+"/chat.update", body); err != nil {
		// The in-place edit failed (a transient Slack error, or the message became
		// uneditable). With no fallback this strands the message on its last good
		// edit — e.g. a SUCCESSFUL prod release left on the test phase's "Awaiting
		// prod approval" CTA, because runProd's "Deploying"/"Complete" edits were
		// swallowed here. Self-heal: drop the ts and re-post as a fresh message
		// (which re-seeds ts so subsequent edits land), so the true status is
		// always visible. The orphaned message is harmless.
		n.warn("chat.update failed (ts=%s): %v — reposting as a new message", n.ts, err)
		n.ts = ""
		n.post(ctx, text)
		return
	}

	n.lastText = text

	logger.Log("slack.updated: ts=%s", n.ts)
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
		return nil, fmt.Errorf("slack API error: %s", apiResp.Error)
	}

	return &apiResp, nil
}

package sso

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/cli/browser"
)

const (
	defaultClientID = "e238e416"
	defaultTokenURL = "https://ssojwt.test-gdcorp.tools/token"
)

// Config holds configuration for the OAuth device code flow.
type Config struct {
	TokenURL string
	ClientID string
	// OpenURL opens a URL in the user's browser. If nil, defaults to OpenBrowser.
	OpenURL func(string) error
}

// DefaultLocalDevConfig returns the standard config for local development (test environment).
func DefaultLocalDevConfig() Config {
	return Config{
		TokenURL: defaultTokenURL,
		ClientID: defaultClientID,
	}
}

func (c Config) openURL(u string) error {
	if c.OpenURL != nil {
		return c.OpenURL(u)
	}
	return OpenBrowser(u)
}

// DeviceCodeResponse is the response from the initial device code request.
type DeviceCodeResponse struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	Interval        int    `json:"interval"`
	ExpiresIn       int    `json:"expires_in"`
}

// tokenPollResponse is the response from polling the token endpoint.
type tokenPollResponse struct {
	AccessToken string `json:"access_token"`
	Error       string `json:"error"`
}

// RequestDeviceCode initiates the device code flow.
func RequestDeviceCode(ctx context.Context, cfg Config) (*DeviceCodeResponse, error) {
	form := url.Values{"client_id": {cfg.ClientID}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("requesting device code: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("device code request returned status %d", resp.StatusCode)
	}

	var dcr DeviceCodeResponse
	if err := json.NewDecoder(resp.Body).Decode(&dcr); err != nil {
		return nil, fmt.Errorf("decoding device code response: %w", err)
	}
	return &dcr, nil
}

// PollForToken polls the token endpoint until the user completes authentication.
// It handles authorization_pending (retry) and slow_down (sleep 2x interval once) responses.
func PollForToken(ctx context.Context, cfg Config, deviceCode string, interval, expiresIn int) (string, error) {
	if interval <= 0 {
		interval = 5
	}
	if expiresIn <= 0 {
		expiresIn = 600
	}
	deadline := time.After(time.Duration(expiresIn) * time.Second)

	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-deadline:
			return "", fmt.Errorf("device code expired after %d seconds", expiresIn)
		case <-time.After(time.Duration(interval) * time.Second):
		}

		form := url.Values{
			"client_id":   {cfg.ClientID},
			"device_code": {deviceCode},
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(form.Encode()))
		if err != nil {
			return "", fmt.Errorf("creating poll request: %w", err)
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return "", fmt.Errorf("polling for token: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return "", fmt.Errorf("token poll returned status %d", resp.StatusCode)
		}

		var tr tokenPollResponse
		decodeErr := json.NewDecoder(resp.Body).Decode(&tr)
		resp.Body.Close()
		if decodeErr != nil {
			return "", fmt.Errorf("decoding poll response: %w", decodeErr)
		}

		if tr.AccessToken != "" {
			return tr.AccessToken, nil
		}

		switch tr.Error {
		case "authorization_pending":
			continue
		case "slow_down":
			// Sleep an extra interval (matching ssojwt: sleep interval*2 once,
			// not permanently doubling). The normal sleep already happened above.
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(time.Duration(interval) * time.Second):
			}
			continue
		default:
			return "", fmt.Errorf("token error: %s", tr.Error)
		}
	}
}

// AcquireToken performs the full OAuth device code flow:
// request device code, open browser, poll until token is returned.
func AcquireToken(ctx context.Context, cfg Config) (string, error) {
	dcr, err := RequestDeviceCode(ctx, cfg)
	if err != nil {
		return "", err
	}

	if err := cfg.openURL(dcr.VerificationURI); err != nil {
		// Match ssojwt: if browser fails, print URL for manual opening instead of erroring.
		fmt.Fprintf(os.Stderr, "Please open %s in your web browser.\n", dcr.VerificationURI)
	} else {
		fmt.Fprintf(os.Stderr, "Opening %s\n", dcr.VerificationURI)
	}

	if len(dcr.UserCode) >= 4 {
		fmt.Fprintf(os.Stderr, "When prompted, confirm or enter this code: %s-%s\n",
			strings.ToUpper(dcr.UserCode[:4]), strings.ToUpper(dcr.UserCode[4:]))
	} else if dcr.UserCode != "" {
		fmt.Fprintf(os.Stderr, "When prompted, confirm or enter this code: %s\n",
			strings.ToUpper(dcr.UserCode))
	}

	return PollForToken(ctx, cfg, dcr.DeviceCode, dcr.Interval, dcr.ExpiresIn)
}

// OpenBrowser opens a URL in the user's default browser.
// Falls back to $BROWSER env var if the default method fails.
func OpenBrowser(u string) error {
	if err := browser.OpenURL(u); err != nil {
		if b := os.Getenv("BROWSER"); b != "" {
			return exec.Command(b, u).Start() //nolint:gosec // $BROWSER is a user-configured binary
		}
		return err
	}
	return nil
}

package checks

import (
	"fmt"
	"strings"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/credrefresh"
)

// ssoTokenMinValidity is the minimum remaining lifetime an SSO access token
// must have to be considered valid. The Node.js AWS SDK refuses to use an SSO
// token that is already expired and surfaces the "Token is expired" error
// immediately; we fail a few minutes early to avoid the app starting in a
// state that is about to break mid-request.
const ssoTokenMinValidity = 5 * time.Minute

// checkSSOToken verifies that the SSO access token cache for the given AWS
// profile exists and is not expired (or about to expire).
//
// Returns (true, "") when the profile is not an SSO profile, signalling the
// caller that no SSO-token guarantee can be made and other checks (e.g. STS)
// should be relied on. Returns (true, "") when the token is valid. Returns
// (false, message) when the profile entry is missing from ~/.aws/config, or
// when the SSO token is missing/expired/malformed.
//
// Delegates to credrefresh.CheckToken for the actual cache reading and parsing,
// then applies the preflight-specific ssoTokenMinValidity buffer and formats
// actionable error messages with login commands.
func checkSSOToken(profile string) (ok bool, message string) {
	status := credrefresh.CheckToken(profile, "")

	switch status.Reason {
	case credrefresh.ReasonNotSSO, credrefresh.ReasonNoData:
		return true, ""
	case credrefresh.ReasonValid:
		if status.TTL <= ssoTokenMinValidity {
			return false, fmt.Sprintf("AWS SSO session expired for profile %q (run: aws sso login --profile %s)", profile, profile)
		}
		return true, ""
	default:
		return false, addLoginHint(status.Message, profile)
	}
}

// addLoginHint appends an actionable "run: aws sso login" command to error
// messages that don't already contain one.
func addLoginHint(msg string, profile string) string {
	hint := fmt.Sprintf("aws sso login --profile %s", profile)
	if strings.Contains(msg, hint) {
		return msg
	}
	return fmt.Sprintf("%s (run: %s)", msg, hint)
}

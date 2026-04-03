package pipeline

import (
	"regexp"
	"strings"
)

var slackLinkRe = regexp.MustCompile(`<([^|>]+)\|([^>]+)>`)
var slackBoldRe = regexp.MustCompile(`\*([^*]+)\*`)

var emojiMap = map[string]string{
	":white_check_mark:":  "\u2705",
	":x:":                 "\u274C",
	":rocket:":            "\U0001F680",
	":checkered_flag:":    "\U0001F3C1",
	":large_blue_circle:": "\U0001F535",
	":white_circle:":      "\u26AA",
	":no_entry:":          "\u26D4",
	":fast_forward:":      "\u23E9",
	":spinner_:":          "",
}

// MrkdwnToMarkdown converts Slack mrkdwn to GitHub-flavored markdown.
func MrkdwnToMarkdown(text string) string {
	// Convert <url|label> to [label](url)
	result := slackLinkRe.ReplaceAllString(text, "[$2]($1)")

	// Convert *bold* to **bold** — must happen after link conversion
	// to avoid mangling link labels
	result = slackBoldRe.ReplaceAllString(result, "**$1**")

	// Only the known italic string from slackMessage needs conversion;
	// a general _italic_ regex would corrupt snake_case identifiers in log output.
	result = strings.ReplaceAll(result, "_In progress..._", "*In progress...*")

	for code, unicode := range emojiMap {
		result = strings.ReplaceAll(result, code, unicode)
	}

	return result
}

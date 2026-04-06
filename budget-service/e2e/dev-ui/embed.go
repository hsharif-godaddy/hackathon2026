// Package devui embeds static assets for cmd/dev-budget-ui (local E2E only).
package devui

import "embed"

//go:embed index.html app.js
var FS embed.FS

package migrations

import "embed"

// SQL holds golang-migrate assets. The embed pattern is *.sql in this directory only (subdirectories are not included).
//
//go:embed *.sql
var SQL embed.FS

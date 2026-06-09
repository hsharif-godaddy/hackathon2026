// Package prewarm warms the slow paths of local app creation: Next.js route
// compilation (via HTTP GET) and the Docker layer cache for the app-container
// images (via a local-control-plane endpoint). It is UI-agnostic so the
// dev-runner TUI picker and the `dev-runner prewarm` CLI share one code path.
package prewarm

// Selection is the set of prewarm tasks to run. The zero value runs nothing.
type Selection struct {
	API    bool // warm Next.js route compilation
	Docker bool // warm the Docker image layer cache
}

// Empty reports whether no task is selected.
func (s Selection) Empty() bool {
	return !s.API && !s.Docker
}

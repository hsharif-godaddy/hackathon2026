package pipeline

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/airo-ai-builder/release-manager/internal/gh"
	"github.com/airo-ai-builder/release-manager/internal/logger"
)

var tagDateRe = regexp.MustCompile(`^v(\d{4}\.\d{2}\.\d{2})\.(\d+)$`)

// GenerateReleaseTag queries existing releases and returns the next
// date-based tag in the format v2026.04.03.N.
func (p *Pipeline) GenerateReleaseTag(ctx context.Context) (string, error) {
	today := time.Now().Format("2006.01.02")
	prefix := "v" + today + "."

	releases, err := p.Runner.ListReleases(ctx, p.Config.Release.Repo, 50)
	if err != nil {
		logger.Log("release.tag: could not list releases, defaulting to .1: %s", err)
		return prefix + "1", nil
	}

	highest := 0
	for _, r := range releases {
		matches := tagDateRe.FindStringSubmatch(r.TagName)
		if len(matches) != 3 || matches[1] != today {
			continue
		}
		if n, err := strconv.Atoi(matches[2]); err == nil && n > highest {
			highest = n
		}
	}

	return fmt.Sprintf("%s%d", prefix, highest+1), nil
}

// CreateRelease creates a GitHub release using the configured repo.
// The target commitish is extracted from the agent image tag's ext hash
// and resolved to a full SHA (the GitHub API rejects short hashes).
func (p *Pipeline) CreateRelease(ctx context.Context, tag, title, body string) (string, error) {
	target := gh.ExtractExtHash(p.Snapshot.AgentImageTag)
	if target == "" {
		target = p.Branch
	}

	if fullSHA, err := p.Runner.ResolveCommit(ctx, p.Config.Release.Repo, target); err == nil {
		target = fullSHA
	} else {
		logger.Log("release.warn: could not resolve %s to full SHA, using as-is: %s", target, err)
	}

	url, err := p.Runner.CreateRelease(ctx, p.Config.Release.Repo, tag, target, title, body)
	if err != nil {
		return "", err
	}
	logger.Log("release.created: tag=%s url=%s target=%s", tag, url, target)
	return url, nil
}

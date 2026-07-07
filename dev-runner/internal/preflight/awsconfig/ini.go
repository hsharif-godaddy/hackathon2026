package awsconfig

import (
	"bufio"
	"strings"
)

// SectionExists checks if an AWS config file contains a [section] header.
func SectionExists(content string, section string) bool {
	target := "[" + section + "]"
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		if strings.TrimSpace(scanner.Text()) == target {
			return true
		}
	}
	return false
}

// ProfileKey extracts the value of a key within a [profile <name>] section.
// Returns "" if the section or key is not found.
func ProfileKey(content string, profile string, key string) string {
	return sectionKey(content, profileSection(profile), key)
}

// SetProfileKey replaces the value of a key within a [profile <name>] section.
// Returns the modified content and whether any change was made.
func SetProfileKey(content string, profile string, key string, value string) (string, bool) {
	return setSectionKey(content, profileSection(profile), key, value)
}

// profileSection returns the ini section name for a profile. AWS uses [default]
// for the default profile, not [profile default].
func profileSection(profile string) string {
	if profile == "default" {
		return "default"
	}
	return "profile " + profile
}

// FindSSOSessionByStartURL scans the config for an existing [sso-session NAME]
// block whose sso_start_url matches the given URL (normalized: trailing "#" and
// "/" are ignored), returning its name.
func FindSSOSessionByStartURL(content string, startURL string) (name string, found bool) {
	var (
		curName  string
		inTarget bool
	)
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			header := strings.TrimSpace(line[1 : len(line)-1])
			if rest, ok := strings.CutPrefix(header, "sso-session "); ok {
				curName = strings.TrimSpace(rest)
				inTarget = curName != ""
			} else {
				curName = ""
				inTarget = false
			}
			continue
		}

		if !inTarget {
			continue
		}

		k, v, ok := strings.Cut(line, "=")
		if !ok || strings.TrimSpace(k) != "sso_start_url" {
			continue
		}
		if normalizeStartURL(v) == normalizeStartURL(startURL) {
			return curName, true
		}
	}
	return "", false
}

// sectionKey extracts a key's value from a named section (e.g. "profile foo"
// or "sso-session bar"). Returns "" if not found.
func sectionKey(content string, section string, key string) string {
	sectionHeader := "[" + section + "]"
	var inSection bool

	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			inSection = line == sectionHeader
			continue
		}

		if !inSection {
			continue
		}

		k, v, ok := strings.Cut(line, "=")
		if ok && strings.TrimSpace(k) == key {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// setSectionKey replaces a key's value within a named section. Returns the
// modified content and whether a change was made.
func setSectionKey(content string, section string, key string, value string) (string, bool) {
	sectionHeader := "[" + section + "]"
	var (
		inSection bool
		changed   bool
		lines     []string
	)

	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)

		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			inSection = trimmed == sectionHeader
			lines = append(lines, line)
			continue
		}

		if inSection {
			k, v, ok := strings.Cut(trimmed, "=")
			if ok && strings.TrimSpace(k) == key && strings.TrimSpace(v) != value {
				line = key + " = " + value
				changed = true
			}
		}

		lines = append(lines, line)
	}

	if !changed {
		return content, false
	}

	result := strings.Join(lines, "\n")
	if strings.HasSuffix(content, "\n") && !strings.HasSuffix(result, "\n") {
		result += "\n"
	}
	return result, true
}

// normalizeStartURL trims trailing "#" and "/" so cosmetic URL differences
// (e.g. a missing trailing "#") still compare equal.
func normalizeStartURL(url string) string {
	return strings.TrimRight(strings.TrimSpace(url), "#/")
}

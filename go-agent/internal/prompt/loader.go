package prompt

import (
	"errors"
	"fmt"
	"io/fs"
	"strings"
)

// Loader reads and composes prompt fragments from a filesystem.
// In production this is os.DirFS pointing at the shared agents/src/prompts/ directory.
// In tests it can be testing/fstest.MapFS.
type Loader struct {
	fsys fs.FS
}

// NewLoader creates a prompt Loader backed by the given filesystem.
func NewLoader(fsys fs.FS) *Loader {
	return &Loader{fsys: fsys}
}

// Config describes how to assemble a system prompt from fragments.
type Config struct {
	// BasePrompt is the primary prompt file path (e.g. "develop/core.md").
	BasePrompt string

	// Fragments are unconditionally included after the base prompt.
	Fragments []string

	// Conditionals are included only when their Condition returns true.
	Conditionals []ConditionalFragment
}

// ConditionalFragment is a prompt fragment that is included only when Condition(ctx) is true.
type ConditionalFragment struct {
	Path      string
	Condition func(Context) bool
}

// Context carries runtime information used for conditional prompt assembly.
type Context struct {
	AppID         string
	TemplateType  string
	EnabledSkills []string
	FeatureFlags  map[string]bool
}

// Compose reads and assembles a system prompt from the configured fragments.
// Sections are joined with double newlines, matching the TS PromptBuilder behavior.
func (l *Loader) Compose(cfg Config, ctx Context) (string, error) {
	var sections []string

	// 1. Base prompt (required).
	base, err := l.readFile(cfg.BasePrompt)
	if err != nil {
		return "", fmt.Errorf("base prompt %q: %w", cfg.BasePrompt, err)
	}
	sections = append(sections, base)

	// 2. Static fragments.
	for _, path := range cfg.Fragments {
		content, err := l.readFile(path)
		if err != nil {
			return "", fmt.Errorf("fragment %q: %w", path, err)
		}
		sections = append(sections, content)
	}

	// 3. Conditional fragments.
	for _, cf := range cfg.Conditionals {
		if cf.Condition == nil {
			continue
		}
		if cf.Condition(ctx) {
			content, err := l.readFile(cf.Path)
			if err != nil {
				return "", fmt.Errorf("conditional fragment %q: %w", cf.Path, err)
			}
			sections = append(sections, content)
		}
	}

	// 4. Template description (if TemplateType is set).
	if ctx.TemplateType != "" {
		td, err := l.loadTemplateDescription(ctx.TemplateType)
		if err != nil {
			return "", err
		}
		if td != "" {
			sections = append(sections, td)
		}
	}

	// 5. Skills section (if any skills are enabled).
	if len(ctx.EnabledSkills) > 0 {
		sections = append(sections, buildSkillsSection(ctx.EnabledSkills))
	}

	return joinSections(sections), nil
}

func (l *Loader) loadTemplateDescription(templateType string) (string, error) {
	tdPath := "template-descriptions/" + templateType + ".md"
	if !fs.ValidPath(tdPath) {
		return "", fmt.Errorf("invalid template type %q", templateType)
	}
	content, err := l.readFile(tdPath)
	if err == nil {
		return content, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return "", fmt.Errorf("template description %q: %w", tdPath, err)
	}
	// Fall back to default template description.
	content, err = l.readFile("template-descriptions/default.md")
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return "", fmt.Errorf("default template description: %w", err)
	}
	return content, nil
}

func (l *Loader) readFile(path string) (string, error) {
	data, err := fs.ReadFile(l.fsys, path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

func joinSections(sections []string) string {
	var nonEmpty []string
	for _, s := range sections {
		if s != "" {
			nonEmpty = append(nonEmpty, s)
		}
	}
	return strings.Join(nonEmpty, "\n\n")
}

func buildSkillsSection(skills []string) string {
	var b strings.Builder
	b.WriteString("## Available Skills\n\n")
	for _, skill := range skills {
		b.WriteString("- **")
		b.WriteString(skill)
		b.WriteString("**\n")
	}
	return strings.TrimSpace(b.String())
}

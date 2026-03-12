package prompt

import (
	"strings"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testFS() fstest.MapFS {
	return fstest.MapFS{
		"develop/core.md": &fstest.MapFile{
			Data: []byte("You are a development agent."),
		},
		"shared/communication.md": &fstest.MapFile{
			Data: []byte("Be clear, confident, and warm."),
		},
		"shared/security.md": &fstest.MapFile{
			Data: []byte("Never expose secrets."),
		},
		"develop/commerce.md": &fstest.MapFile{
			Data: []byte("Commerce handoff rules."),
		},
		"develop/handoff.md": &fstest.MapFile{
			Data: []byte("Agent handoff protocol."),
		},
		"template-descriptions/v8.md": &fstest.MapFile{
			Data: []byte("V8 template: modern React app."),
		},
		"template-descriptions/default.md": &fstest.MapFile{
			Data: []byte("Default template description."),
		},
	}
}

func TestCompose_BasePromptOnly(t *testing.T) {
	loader := NewLoader(testFS())

	result, err := loader.Compose(Config{
		BasePrompt: "develop/core.md",
	}, Context{})

	require.NoError(t, err)
	assert.Equal(t, "You are a development agent.", result)
}

func TestCompose_WithFragments(t *testing.T) {
	loader := NewLoader(testFS())

	result, err := loader.Compose(Config{
		BasePrompt: "develop/core.md",
		Fragments: []string{
			"shared/communication.md",
			"shared/security.md",
		},
	}, Context{})

	require.NoError(t, err)
	expected := "You are a development agent.\n\n" +
		"Be clear, confident, and warm.\n\n" +
		"Never expose secrets."
	assert.Equal(t, expected, result)
}

func TestCompose_ConditionalIncluded(t *testing.T) {
	loader := NewLoader(testFS())

	result, err := loader.Compose(Config{
		BasePrompt: "develop/core.md",
		Conditionals: []ConditionalFragment{
			{
				Path: "develop/commerce.md",
				Condition: func(ctx Context) bool {
					return ctx.FeatureFlags["commerce"]
				},
			},
		},
	}, Context{
		FeatureFlags: map[string]bool{"commerce": true},
	})

	require.NoError(t, err)
	assert.Contains(t, result, "Commerce handoff rules.")
}

func TestCompose_ConditionalExcluded(t *testing.T) {
	loader := NewLoader(testFS())

	result, err := loader.Compose(Config{
		BasePrompt: "develop/core.md",
		Conditionals: []ConditionalFragment{
			{
				Path: "develop/commerce.md",
				Condition: func(ctx Context) bool {
					return ctx.FeatureFlags["commerce"]
				},
			},
		},
	}, Context{
		FeatureFlags: map[string]bool{"commerce": false},
	})

	require.NoError(t, err)
	assert.NotContains(t, result, "Commerce handoff rules.")
	assert.Equal(t, "You are a development agent.", result)
}

func TestCompose_TemplateDescription(t *testing.T) {
	loader := NewLoader(testFS())

	result, err := loader.Compose(Config{
		BasePrompt: "develop/core.md",
	}, Context{
		TemplateType: "v8",
	})

	require.NoError(t, err)
	assert.Contains(t, result, "V8 template: modern React app.")
}

func TestCompose_TemplateDescriptionFallsBackToDefault(t *testing.T) {
	loader := NewLoader(testFS())

	result, err := loader.Compose(Config{
		BasePrompt: "develop/core.md",
	}, Context{
		TemplateType: "unknown-template",
	})

	require.NoError(t, err)
	assert.Contains(t, result, "Default template description.")
}

func TestCompose_TemplateDescriptionNoFallback(t *testing.T) {
	// FS with no template-descriptions at all.
	mapFS := fstest.MapFS{
		"develop/core.md": &fstest.MapFile{Data: []byte("Core prompt.")},
	}
	loader := NewLoader(mapFS)

	result, err := loader.Compose(Config{
		BasePrompt: "develop/core.md",
	}, Context{
		TemplateType: "v8",
	})

	require.NoError(t, err)
	assert.Equal(t, "Core prompt.", result)
}

func TestCompose_SkillsSection(t *testing.T) {
	loader := NewLoader(testFS())

	result, err := loader.Compose(Config{
		BasePrompt: "develop/core.md",
	}, Context{
		EnabledSkills: []string{"media", "seo", "blog"},
	})

	require.NoError(t, err)
	assert.Contains(t, result, "## Available Skills")
	assert.Contains(t, result, "- **media**")
	assert.Contains(t, result, "- **seo**")
	assert.Contains(t, result, "- **blog**")
}

func TestCompose_NoSkillsWhenEmpty(t *testing.T) {
	loader := NewLoader(testFS())

	result, err := loader.Compose(Config{
		BasePrompt: "develop/core.md",
	}, Context{})

	require.NoError(t, err)
	assert.NotContains(t, result, "Available Skills")
}

func TestCompose_UnknownBasePromptReturnsError(t *testing.T) {
	loader := NewLoader(testFS())

	_, err := loader.Compose(Config{
		BasePrompt: "nonexistent/prompt.md",
	}, Context{})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "base prompt")
	assert.Contains(t, err.Error(), "nonexistent/prompt.md")
}

func TestCompose_UnknownFragmentReturnsError(t *testing.T) {
	loader := NewLoader(testFS())

	_, err := loader.Compose(Config{
		BasePrompt: "develop/core.md",
		Fragments:  []string{"missing/fragment.md"},
	}, Context{})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "fragment")
	assert.Contains(t, err.Error(), "missing/fragment.md")
}

func TestCompose_FullDevelopPrompt(t *testing.T) {
	loader := NewLoader(testFS())

	result, err := loader.Compose(Config{
		BasePrompt: "develop/core.md",
		Fragments: []string{
			"shared/communication.md",
			"develop/handoff.md",
			"shared/security.md",
		},
		Conditionals: []ConditionalFragment{
			{
				Path: "develop/commerce.md",
				Condition: func(ctx Context) bool {
					return ctx.FeatureFlags["commerce"]
				},
			},
		},
	}, Context{
		TemplateType:  "v8",
		EnabledSkills: []string{"media"},
		FeatureFlags:  map[string]bool{"commerce": true},
	})

	require.NoError(t, err)

	// Verify all sections are present.
	assert.Contains(t, result, "You are a development agent.")
	assert.Contains(t, result, "Be clear, confident, and warm.")
	assert.Contains(t, result, "Agent handoff protocol.")
	assert.Contains(t, result, "Never expose secrets.")
	assert.Contains(t, result, "Commerce handoff rules.")
	assert.Contains(t, result, "V8 template: modern React app.")
	assert.Contains(t, result, "Available Skills")

	// Verify ordering: base → fragments → conditionals → template → skills.
	baseIdx := strings.Index(result, "You are a development agent.")
	commIdx := strings.Index(result, "Be clear, confident, and warm.")
	handoffIdx := strings.Index(result, "Agent handoff protocol.")
	securityIdx := strings.Index(result, "Never expose secrets.")
	commerceIdx := strings.Index(result, "Commerce handoff rules.")
	templateIdx := strings.Index(result, "V8 template: modern React app.")
	skillsIdx := strings.Index(result, "Available Skills")

	assert.Greater(t, commIdx, baseIdx, "communication after base")
	assert.Greater(t, handoffIdx, commIdx, "handoff after communication")
	assert.Greater(t, securityIdx, handoffIdx, "security after handoff")
	assert.Greater(t, commerceIdx, securityIdx, "commerce after security")
	assert.Greater(t, templateIdx, commerceIdx, "template after commerce")
	assert.Greater(t, skillsIdx, templateIdx, "skills after template")
}

func TestCompose_WhitespaceIsTrimmed(t *testing.T) {
	mapFS := fstest.MapFS{
		"base.md": &fstest.MapFile{Data: []byte("\n\n  Hello world  \n\n")},
	}
	loader := NewLoader(mapFS)

	result, err := loader.Compose(Config{BasePrompt: "base.md"}, Context{})
	require.NoError(t, err)
	assert.Equal(t, "Hello world", result)
}

func TestCompose_NilConditionSkipped(t *testing.T) {
	loader := NewLoader(testFS())

	result, err := loader.Compose(Config{
		BasePrompt: "develop/core.md",
		Conditionals: []ConditionalFragment{
			{Path: "develop/commerce.md", Condition: nil},
		},
	}, Context{})

	require.NoError(t, err)
	assert.Equal(t, "You are a development agent.", result)
}

func TestCompose_InvalidTemplateTypeReturnsError(t *testing.T) {
	loader := NewLoader(testFS())

	_, err := loader.Compose(Config{
		BasePrompt: "develop/core.md",
	}, Context{
		TemplateType: "../etc/passwd",
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid template type")
}

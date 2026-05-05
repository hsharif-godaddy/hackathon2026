package preflight

import "context"

// Status represents the result of a preflight check.
type Status int

const (
	StatusPass Status = iota
	StatusFail
	StatusWarn
	StatusSkip
)

func (s Status) String() string {
	switch s {
	case StatusPass:
		return "pass"
	case StatusFail:
		return "fail"
	case StatusWarn:
		return "warn"
	case StatusSkip:
		return "skip"
	default:
		return "unknown"
	}
}

// CheckResult holds the outcome of a single preflight check.
type CheckResult struct {
	Status       Status
	Name         string
	Category     string
	Message      string
	FixAvailable bool
	InstallHint  string // For unfixable items: install command or URL
}

// Check verifies a single prerequisite.
type Check interface {
	Name() string
	Category() string
	Run(ctx context.Context, projectRoot string) CheckResult
}

// Fixer resolves a failed check. It may run commands or prompt the user.
type Fixer interface {
	// Fix attempts to resolve the issue. Returns nil on success.
	Fix(ctx context.Context, projectRoot string) error
}

// TerminalFixer is a Fixer that needs full terminal access (e.g., for sudo prompts).
// When the TUI encounters a TerminalFixer, it suspends itself so that
// stdin/stdout/stderr are connected to the real terminal during Fix().
type TerminalFixer interface {
	Fixer
	NeedsTerminal() bool
}

// FormField describes a single input field for a FormFixer.
type FormField struct {
	Key         string // unique identifier, used as map key in SetFormValues
	Label       string
	Description string // shown below label when field is active
	Placeholder string
	Default     string
	Required    bool
	Password    bool     // EchoPassword mode
	Options     []string // when set, field cycles through options instead of free text
}

// FormFixer is a Fixer that collects user input via inline TUI form fields.
// The TUI calls FormFields() to build the form, then SetFormValues() with
// collected values before running Fix().
type FormFixer interface {
	Fixer
	FormFields() []FormField
	SetFormValues(values map[string]string)
}

// CheckWithFixer pairs a Check with its optional Fixer.
type CheckWithFixer struct {
	Check Check
	Fixer Fixer // nil if not auto-fixable
	OptIn bool  // when true, fix is unchecked by default in the selector
}

// Category groups checks that run concurrently within the group.
// Categories themselves run sequentially (Tools → Environment → Services).
const (
	CategoryTools       = "Tools"
	CategoryEnvironment = "Environment"
	CategoryServices    = "Services"
)

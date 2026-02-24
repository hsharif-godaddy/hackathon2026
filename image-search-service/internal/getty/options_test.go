package getty

import (
	"testing"
)

func TestNewSearchOptions(t *testing.T) {
	opts := NewSearchOptions("business meeting")

	if opts.Phrase != "business meeting" {
		t.Errorf("Phrase = %q, want %q", opts.Phrase, "business meeting")
	}
	if opts.Page != 1 {
		t.Errorf("Page = %d, want %d", opts.Page, 1)
	}
	if opts.PageSize != 50 {
		t.Errorf("PageSize = %d, want %d", opts.PageSize, 50)
	}
}

func TestSearchOptionsWithFilters(t *testing.T) {
	opts := NewSearchOptions("test")
	opts.Orientations = []Orientation{OrientationHorizontal, OrientationVertical}
	opts.Compositions = []Composition{CompositionCopySpace}
	opts.NumberOfPeople = []NumberOfPeople{NumberOfPeopleTwo}

	if len(opts.Orientations) != 2 {
		t.Errorf("Orientations length = %d, want 2", len(opts.Orientations))
	}
	if len(opts.Compositions) != 1 {
		t.Errorf("Compositions length = %d, want 1", len(opts.Compositions))
	}
	if opts.NumberOfPeople[0] != NumberOfPeopleTwo {
		t.Errorf("NumberOfPeople[0] = %q, want %q", opts.NumberOfPeople[0], NumberOfPeopleTwo)
	}
}

func TestSearchOptionsPointerBools(t *testing.T) {
	opts := NewSearchOptions("test")

	// Default: nil (use API defaults)
	if opts.SafeSearch != nil {
		t.Errorf("SafeSearch should be nil by default")
	}

	// Can explicitly set to false
	f := false
	opts.SafeSearch = &f
	if *opts.SafeSearch != false {
		t.Errorf("SafeSearch = %v, want false", *opts.SafeSearch)
	}

	// Can explicitly set to true
	tr := true
	opts.SafeSearch = &tr
	if *opts.SafeSearch != true {
		t.Errorf("SafeSearch = %v, want true", *opts.SafeSearch)
	}
}

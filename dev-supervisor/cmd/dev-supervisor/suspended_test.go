package main

import (
	"testing"
)

func TestIsSuspendedPublishContainer(t *testing.T) {
	tests := []struct {
		name      string
		suspended string
		taskName  string
		want      bool
	}{
		{name: "publish + suspended", suspended: "true", taskName: "publish", want: true},
		{name: "publish + unset", suspended: "", taskName: "publish", want: false},
		{name: "publish + literal false", suspended: "false", taskName: "publish", want: false},
		{name: "publish + non-canonical truthy", suspended: "1", taskName: "publish", want: false},
		{name: "preview ignores SUSPENDED", suspended: "true", taskName: "preview", want: false},
		{name: "default variant treated as publish", suspended: "true", taskName: "", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("SUSPENDED", tt.suspended)
			t.Setenv("NOMAD_TASK_NAME", tt.taskName)

			if got := isSuspendedPublishContainer(); got != tt.want {
				t.Errorf("isSuspendedPublishContainer() = %v, want %v", got, tt.want)
			}
		})
	}
}

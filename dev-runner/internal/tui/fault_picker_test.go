package tui

import (
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/config"
	"github.com/airo-ai-builder/dev-runner/internal/process"
)

func TestAllViewExcludesLLMProxy(t *testing.T) {
	m := Model{manager: process.NewManager([]config.ProcessConfig{
		{Name: "App", Command: "x", Dir: "."},
		{Name: "Agents", Command: "x", Dir: "."},
		{Name: "Control Plane", Command: "x", Dir: "."},
		{Name: llmProxyProcessName, Command: "x", Dir: "."},
	}, "/tmp")}

	if got := m.allViewProcessIndexes(); !reflect.DeepEqual(got, []int{0, 1, 2}) {
		t.Errorf("allViewProcessIndexes() = %v, want [0 1 2]", got)
	}
	if got := m.llmProxyProcessIndex(); got != 3 {
		t.Errorf("llmProxyProcessIndex() = %d, want 3", got)
	}
	if got := m.llmProxyTabIndex(); got != 4 {
		t.Errorf("llmProxyTabIndex() = %d, want 4", got)
	}
}

func TestLLMProxyTabIndexAbsent(t *testing.T) {
	m := Model{manager: process.NewManager([]config.ProcessConfig{
		{Name: "App", Command: "x", Dir: "."},
	}, "/tmp")}
	if got := m.llmProxyTabIndex(); got != -1 {
		t.Errorf("llmProxyTabIndex() with no proxy = %d, want -1", got)
	}
	if got := m.allViewProcessIndexes(); !reflect.DeepEqual(got, []int{0}) {
		t.Errorf("allViewProcessIndexes() = %v, want [0]", got)
	}
}

func TestParseFaultCount(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"1", 1},
		{"3", 3},
		{"5", 5},
		{"  3  ", 3},
		{"", 1},
		{"0", 1},
		{"-2", 1},
		{"bogus", 1},
	}
	for _, tc := range cases {
		if got := parseFaultCount(tc.in); got != tc.want {
			t.Errorf("parseFaultCount(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestFaultPickerRendersRectangular(t *testing.T) {
	m := Model{width: 120, height: 40, ready: true}
	_ = m.openFaultPicker()
	if m.faultPickerForm == nil {
		t.Fatal("openFaultPicker did not build a form")
	}
	assertRectangular(t, "fault picker", m.renderFaultPicker())
}

func TestFaultPickerOffersDisarmWhenArmed(t *testing.T) {
	m := Model{width: 120, height: 40, ready: true, faultState: faultStatus{armed: true, fault: "invalid-chunk", remaining: 2}}
	_ = m.openFaultPicker()
	if m.faultPickerFault == nil || *m.faultPickerFault != faultPickerDisarm {
		t.Fatalf("expected disarm to be preselected when armed, got %v", m.faultPickerFault)
	}
}

func withStubControl(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	orig := faultControlBaseURL
	faultControlBaseURL = srv.URL
	t.Cleanup(func() { faultControlBaseURL = orig })
}

func TestArmFaultCmdPostsScopedRequest(t *testing.T) {
	var gotPath, gotBody string
	withStubControl(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"armed":true}`))
	})

	msg := armFaultCmd("http-error", 3)()
	done, ok := msg.(faultActionDoneMsg)
	if !ok {
		t.Fatalf("got %T, want faultActionDoneMsg", msg)
	}
	if done.err != nil {
		t.Fatalf("armFaultCmd error: %v", done.err)
	}
	if gotPath != "/arm" {
		t.Errorf("path = %q, want /arm", gotPath)
	}
	if gotBody != `{"fault":"http-error","count":3,"scope":"chat"}` {
		t.Errorf("body = %q", gotBody)
	}
}

func TestArmFaultCmdSurfacesNon2xx(t *testing.T) {
	withStubControl(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	})
	done := armFaultCmd("http-error", 1)().(faultActionDoneMsg)
	if done.err == nil {
		t.Fatal("expected error on 403, got nil")
	}
}

func TestPollFaultStateParsesArmedState(t *testing.T) {
	withStubControl(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/state" {
			t.Errorf("path = %q, want /state", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"armed":true,"fault":"premature-close","remaining":2}`))
	})

	msg := pollFaultStateCmd()()
	polled, ok := msg.(faultStatePolledMsg)
	if !ok {
		t.Fatalf("got %T, want faultStatePolledMsg", msg)
	}
	if !polled.status.armed || polled.status.fault != "premature-close" || polled.status.remaining != 2 {
		t.Errorf("status = %+v", polled.status)
	}
}

func TestPollFaultStateTreatsErrorsAsUnarmed(t *testing.T) {
	orig := faultControlBaseURL
	faultControlBaseURL = "http://127.0.0.1:1"
	t.Cleanup(func() { faultControlBaseURL = orig })

	polled := pollFaultStateCmd()().(faultStatePolledMsg)
	if polled.status.armed {
		t.Errorf("expected unarmed on control error, got %+v", polled.status)
	}
}

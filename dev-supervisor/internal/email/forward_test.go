package email_test

import (
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	gosmtp "github.com/emersion/go-smtp"

	"github.com/airo-ai-builder/dev-supervisor/internal/email"
)

// startMockRelay stands up a localhost go-smtp server that records each
// received message to a channel. Returns the bound address plus a cleanup
// closure. Used to exercise email.ForwardSMTP end-to-end without dialing
// the real relay.
func startMockRelay(t *testing.T, sessionFactory func() gosmtp.Session) (string, chan *capturedMessage, func()) {
	t.Helper()
	captured := make(chan *capturedMessage, 4)

	server := gosmtp.NewServer(&recordingBackend{factory: sessionFactory, captured: captured})
	server.Domain = "test.local"
	server.AllowInsecureAuth = true

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := listener.Addr().String()

	go func() {
		// Serve returns when listener closes; surface any other error
		// only via t.Logf so a nominal close doesn't fail the test.
		if serveErr := server.Serve(listener); serveErr != nil &&
			!errors.Is(serveErr, net.ErrClosed) {
			t.Logf("mock relay serve: %v", serveErr)
		}
	}()
	// Brief warmup so Dial doesn't race the listener becoming ready.
	time.Sleep(50 * time.Millisecond)

	cleanup := func() {
		_ = server.Close()
	}
	return addr, captured, cleanup
}

type capturedMessage struct {
	from string
	to   []string
	data []byte
}

type recordingBackend struct {
	factory  func() gosmtp.Session
	captured chan *capturedMessage
}

func (b *recordingBackend) NewSession(_ *gosmtp.Conn) (gosmtp.Session, error) {
	if b.factory != nil {
		return b.factory(), nil
	}
	return &recordingSession{captured: b.captured}, nil
}

type recordingSession struct {
	captured chan *capturedMessage
	from     string
	to       []string
}

func (s *recordingSession) AuthPlain(_, _ string) error { return nil }
func (s *recordingSession) Mail(from string, _ *gosmtp.MailOptions) error {
	s.from = from
	return nil
}
func (s *recordingSession) Rcpt(to string, _ *gosmtp.RcptOptions) error {
	s.to = append(s.to, to)
	return nil
}
func (s *recordingSession) Data(r io.Reader) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("read data: %w", err)
	}
	s.captured <- &capturedMessage{from: s.from, to: append([]string(nil), s.to...), data: data}
	return nil
}
func (s *recordingSession) Reset()        { s.from = ""; s.to = nil }
func (s *recordingSession) Logout() error { return nil }

func TestForwardSMTP_HappyPath(t *testing.T) {
	addr, captured, cleanup := startMockRelay(t, nil)
	defer cleanup()

	body := []byte("From: a@b\r\nTo: c@d\r\nSubject: hi\r\n\r\nbody\r\n")
	rcpts := []string{"c@d", "e@f"}
	if err := email.ForwardSMTP(addr, "a@b", rcpts, body); err != nil {
		t.Fatalf("ForwardSMTP: %v", err)
	}

	select {
	case msg := <-captured:
		if msg.from != "a@b" {
			t.Errorf("envelope from = %q, want a@b", msg.from)
		}
		if len(msg.to) != 2 || msg.to[0] != "c@d" || msg.to[1] != "e@f" {
			t.Errorf("rcpts = %v, want [c@d e@f]", msg.to)
		}
		if string(msg.data) != string(body) {
			t.Errorf("body diverged:\nwant %q\n got %q", string(body), string(msg.data))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for relay to receive message")
	}
}

func TestForwardSMTP_DialErrorWrapped(t *testing.T) {
	// Listen-then-close to claim a port whose listener is already gone.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := listener.Addr().String()
	listener.Close()

	err = email.ForwardSMTP(addr, "a@b", []string{"c@d"}, []byte("\r\n"))
	if err == nil {
		t.Fatal("expected error for closed listener, got nil")
	}
	if !strings.Contains(err.Error(), "failed to connect to destination SMTP server") {
		t.Errorf("error wrap: got %q, want prefix 'failed to connect to destination SMTP server'", err)
	}
}

// rejectingSession refuses MAIL/RCPT/DATA based on the configured stage,
// letting tests verify each stage's error wrap independently.
type rejectingSession struct {
	rejectStage string // "mail", "rcpt", "data"
}

func (s *rejectingSession) AuthPlain(_, _ string) error { return nil }
func (s *rejectingSession) Mail(_ string, _ *gosmtp.MailOptions) error {
	if s.rejectStage == "mail" {
		return &gosmtp.SMTPError{Code: 550, EnhancedCode: gosmtp.EnhancedCode{5, 1, 0}, Message: "rejected"}
	}
	return nil
}
func (s *rejectingSession) Rcpt(_ string, _ *gosmtp.RcptOptions) error {
	if s.rejectStage == "rcpt" {
		return &gosmtp.SMTPError{Code: 550, EnhancedCode: gosmtp.EnhancedCode{5, 1, 1}, Message: "no such user"}
	}
	return nil
}
func (s *rejectingSession) Data(r io.Reader) error {
	_, _ = io.Copy(io.Discard, r)
	if s.rejectStage == "data" {
		return &gosmtp.SMTPError{Code: 554, Message: "transaction failed"}
	}
	return nil
}
func (s *rejectingSession) Reset()        {}
func (s *rejectingSession) Logout() error { return nil }

// TestForwardSMTP_DotStuffsLeadingDots locks in the SMTP smuggling
// defense: a body line starting with "." must be sent to the relay
// with the leading dot doubled (RFC 5321 §4.5.2). Without this, a
// crafted body containing "\r\n.\r\n" would prematurely terminate the
// DATA stream and let arbitrary bytes after it be interpreted as new
// SMTP commands.
//
// We rely on net/textproto.DotWriter (which emersion/go-smtp uses
// internally via Client.Data()) to handle this — this test catches a
// regression if emersion ever swaps its writer for something that
// doesn't dot-stuff.
func TestForwardSMTP_DotStuffsLeadingDots(t *testing.T) {
	addr, captured, cleanup := startMockRelay(t, nil)
	defer cleanup()

	// Body has a line that begins with ".": classic smuggling primitive
	// without dot-stuffing.
	body := []byte("Subject: hi\r\n\r\nfirst line\r\n.\r\nsecond line should still arrive\r\n")
	if err := email.ForwardSMTP(addr, "a@b", []string{"c@d"}, body); err != nil {
		t.Fatalf("ForwardSMTP: %v", err)
	}

	select {
	case msg := <-captured:
		// The relay's session reads the DATA stream through its own
		// dot-decoder, so the captured bytes are the un-stuffed form
		// (back to the original). If dot-stuffing didn't happen on the
		// client side, the relay would have terminated DATA at the
		// "\r\n.\r\n" and never seen "second line".
		got := string(msg.data)
		if !strings.Contains(got, "second line should still arrive") {
			t.Errorf("body truncated at dot-only line — dot-stuffing not applied:\n%s", got)
		}
		// Sanity: relay must have seen the un-stuffed dot too.
		if !strings.Contains(got, "\r\n.\r\n") {
			t.Errorf("expected the original .-only line to round-trip:\n%s", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for relay")
	}
}

// TestForwardSMTP_NormalizesBareLF locks in the LF→CRLF normalization
// the SMTP DATA stream requires (RFC 5321 §2.3.7). Customer-authored
// bodies might contain bare LF; we rely on DotWriter to upgrade them.
func TestForwardSMTP_NormalizesBareLF(t *testing.T) {
	addr, captured, cleanup := startMockRelay(t, nil)
	defer cleanup()

	// Body uses bare LF instead of CRLF.
	body := []byte("Subject: hi\n\nbody with bare LF\nsecond line\n")
	if err := email.ForwardSMTP(addr, "a@b", []string{"c@d"}, body); err != nil {
		t.Fatalf("ForwardSMTP: %v", err)
	}

	select {
	case msg := <-captured:
		got := string(msg.data)
		// Both content lines must be present — corrupted line-handling
		// would lose the second line or scramble the header/body
		// boundary.
		if !strings.Contains(got, "body with bare LF") {
			t.Errorf("first body line missing:\n%s", got)
		}
		if !strings.Contains(got, "second line") {
			t.Errorf("second body line missing:\n%s", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for relay")
	}
}

func TestForwardSMTP_StageErrorsAreWrapped(t *testing.T) {
	cases := []struct {
		stage   string
		wantSub string
	}{
		{"mail", "failed to send MAIL FROM"},
		{"rcpt", "failed to send RCPT TO"},
		// Data-stage rejection surfaces at DATA-close because go-smtp
		// buffers the body and the relay only signals rejection on the
		// terminating ".\r\n" — match the wrapper that handles that.
		{"data", "failed to close DATA writer"},
	}
	for _, tc := range cases {
		t.Run(tc.stage, func(t *testing.T) {
			stage := tc.stage
			addr, _, cleanup := startMockRelay(t, func() gosmtp.Session {
				return &rejectingSession{rejectStage: stage}
			})
			defer cleanup()

			err := email.ForwardSMTP(addr, "a@b", []string{"c@d"}, []byte("Subject: x\r\n\r\nbody\r\n"))
			if err == nil {
				t.Fatalf("expected error for stage %s", tc.stage)
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Errorf("error wrap for stage %s: got %q, want substring %q",
					tc.stage, err.Error(), tc.wantSub)
			}
		})
	}
}

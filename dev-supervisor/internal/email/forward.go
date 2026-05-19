package email

import (
	"fmt"

	"github.com/emersion/go-smtp"
)

// ForwardSMTP delivers a fully-constructed RFC-5322 message to destAddr
// over SMTP. Both the SMTP proxy (after it rewrites headers in place on
// a customer-authored message) and the HTTP gateway (after it builds a
// message from a structured request) call this so the relay handoff is
// implemented exactly once.
//
// destAddr is the SMTP_DESTINATION env value — relay-hosting.secureserver.net
// in production, host.docker.internal:1025 (Mailpit) in local dev,
// customer-overridden anywhere else.
//
// envelopeFrom is the RFC 5321.MailFrom — bare addr-spec, no display name.
// rcpts are RFC 5321.RcptTo addresses, also bare addr-spec; the caller
// is responsible for combining To/Cc/Bcc into this list (and for *not*
// putting Bcc into the message body's headers).
//
// body is the full RFC-5322 message: header block, blank-line separator,
// CRLF-terminated content. ForwardSMTP does not modify it — caller owns
// authoring.
//
// Errors are wrapped with the failing protocol step ("failed to connect
// to destination SMTP server", "failed to send MAIL FROM",
// "failed to send RCPT TO", "failed to start DATA", "failed to write
// email data", "failed to close DATA writer") so log analysis can
// distinguish transient dial failures from per-recipient relay
// rejections. The shape matches the inline forwarder this replaces, so
// Loki queries built against the SMTP proxy keep working.
func ForwardSMTP(destAddr, envelopeFrom string, rcpts []string, body []byte) error {
	client, err := smtp.Dial(destAddr)
	if err != nil {
		return fmt.Errorf("failed to connect to destination SMTP server: %w", err)
	}
	defer client.Close()

	if mailErr := client.Mail(envelopeFrom, nil); mailErr != nil {
		return fmt.Errorf("failed to send MAIL FROM: %w", mailErr)
	}

	for _, rcpt := range rcpts {
		if rcptErr := client.Rcpt(rcpt, nil); rcptErr != nil {
			return fmt.Errorf("failed to send RCPT TO: %w", rcptErr)
		}
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("failed to start DATA: %w", err)
	}

	if _, err := w.Write(body); err != nil {
		_ = w.Close() // best-effort close; we already have a hard error
		return fmt.Errorf("failed to write email data: %w", err)
	}

	if err := w.Close(); err != nil {
		return fmt.Errorf("failed to close DATA writer: %w", err)
	}

	return nil
}

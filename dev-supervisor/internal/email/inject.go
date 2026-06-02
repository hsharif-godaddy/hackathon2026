package email

import (
	"bufio"
	"bytes"
	"fmt"
	"sort"
	"strings"
)

// InjectHeaders appends headers to data at the bottom of the existing
// header block, immediately before the header/body separator. Every
// other byte — original header order, header-name casing, folded
// continuation lines, body bytes — passes through verbatim.
//
// Round-tripping through mail.ReadMessage / msg.Header (the obvious-
// looking implementation) would: randomize order via map iteration,
// canonicalize header-name casing (Message-ID → Message-Id,
// MIME-Version → Mime-Version), and unfold folded continuation lines.
// Those transformations invalidate inbound DKIM signatures on relayed
// mail, scramble the Received: chain, and undo any byte-preservation
// the caller depends on.
//
// Iteration over the headers map is via a sorted key list so the
// injected lines appear in deterministic order regardless of map
// randomization in the caller.
//
// Long values are folded per RFC 5322 §2.2.3 with CRLF + SP
// continuation at foldWidth-character chunks. The X-GD-DKIM-PUB-KEY
// header carries an inner base64 leaf cert (~1500 chars), which
// violates the RFC 5322 §2.1.1 998-octet hard line limit unless
// folded; the cPanel reference (gd_domain_validation.pl
// fold_header_value, width 76) does the same. Cloudmark's verifier
// unfolds via splitlines + concatenate-after-colon, so the folded
// form round-trips to the original value before SHA/JWS extraction.
//
// Tolerates header-only inputs with no body separator: appends the
// headers at the end and synthesizes a blank line.
func InjectHeaders(data []byte, headers map[string]string) []byte {
	if len(headers) == 0 {
		return data
	}

	keys := make([]string, 0, len(headers))
	for k := range headers {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var out bytes.Buffer
	r := bufio.NewReader(bytes.NewReader(data))
	injected := false
	inHeaders := true
	for {
		line, readErr := r.ReadBytes('\n')

		if inHeaders && isBlankLine(line) {
			for _, k := range keys {
				out.WriteString(foldHeader(k, headers[k]))
			}
			injected = true
			inHeaders = false
		}

		out.Write(line)

		if readErr != nil {
			break
		}
	}

	if !injected {
		for _, k := range keys {
			out.WriteString(foldHeader(k, headers[k]))
		}
		out.WriteString("\r\n")
	}

	return out.Bytes()
}

// foldWidth is the per-segment character cap for folded header values.
// Matches cPanel's gd_domain_validation.pl fold_header_value default
// (76). Stays under the RFC 5322 §2.1.1 998-octet hard line limit and
// the §2.1.1 SHOULD-78-octet target.
const foldWidth = 76

// foldHeader serializes a single header line, folding long values per
// RFC 5322 §2.2.3 with CRLF + single space ("\r\n ") continuation.
// Short values (the line fits in foldWidth + the "<name>: " prefix
// without exceeding 78) emit as a single line — no continuation, no
// behavior change for existing tracking headers.
//
// Output always ends with CRLF. Continuation marker is "\r\n " (CRLF +
// SP). Cloudmark's Python verifier unfolds with `lines[0].split(":",
// 1)[1] + "".join(lines[1:])` followed by `"".join(v.split())`, which
// strips both LF-only and CRLF folds plus the leading SP — either
// continuation form works in practice. CRLF chosen for RFC 5322
// conformance and consistency with the rest of the message.
func foldHeader(name, value string) string {
	prefix := name + ": "
	if len(prefix)+len(value) <= foldWidth+2 {
		// Short header — emit single line. Most tracking headers
		// (X-SITE-UID, X-PRODUCT, etc.) and short JWS payloads fall
		// here, preserving wire bytes that existing tests pin.
		return fmt.Sprintf("%s%s\r\n", prefix, value)
	}
	var b strings.Builder
	b.Grow(len(prefix) + len(value) + (len(value)/foldWidth)*3 + 2)
	b.WriteString(prefix)
	rem := value
	for len(rem) > foldWidth {
		b.WriteString(rem[:foldWidth])
		b.WriteString("\r\n ")
		rem = rem[foldWidth:]
	}
	b.WriteString(rem)
	b.WriteString("\r\n")
	return b.String()
}

// isBlankLine reports whether line is the header/body separator (just
// CRLF or LF, possibly the final line of the input with no trailing
// newline at all).
func isBlankLine(line []byte) bool {
	return bytes.Equal(line, []byte("\r\n")) || bytes.Equal(line, []byte("\n"))
}

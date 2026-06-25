//! Incremental Server-Sent Events decoder.
//!
//! `reqwest`'s `bytes_stream()` yields byte chunks of arbitrary size: a single
//! `data:` line may be split across two chunks, or one chunk may carry several
//! complete lines. [`SseDecoder`] buffers across chunk boundaries and emits one
//! [`SseEvent`] per complete `data:` line.

/// A decoded SSE event from a chat-completion stream.
#[derive(Debug, Clone, PartialEq)]
pub enum SseEvent {
    /// A `data: { ... }` chunk parsed as JSON.
    Data(serde_json::Value),
    /// A non-empty `data:` payload that is neither `[DONE]` nor valid JSON.
    /// Surfaced rather than dropped so callers can treat it as a stream error
    /// instead of silently undercounting it.
    Malformed(String),
    /// The terminating `data: [DONE]` sentinel.
    Done,
}

/// Buffers partial lines across byte chunks and parses `data:` lines.
#[derive(Default)]
pub struct SseDecoder {
    /// Bytes of the current, not-yet-terminated line.
    line: Vec<u8>,
}

impl SseDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feeds one received byte chunk, invoking `on_event` for every complete
    /// `data:` line found. Partial trailing data is retained for the next call.
    pub fn feed(&mut self, chunk: &[u8], on_event: &mut impl FnMut(SseEvent)) {
        for &byte in chunk {
            if byte == b'\n' {
                let line = std::mem::take(&mut self.line);
                Self::emit_line(&line, on_event);
            } else {
                self.line.push(byte);
            }
        }
    }

    /// Flushes any buffered line not terminated by a trailing newline. Call once
    /// after the stream ends so a final `data:` chunk (e.g. the `usage` frame)
    /// emitted without a closing `\n` is not lost.
    pub fn finish(&mut self, on_event: &mut impl FnMut(SseEvent)) {
        if !self.line.is_empty() {
            let line = std::mem::take(&mut self.line);
            Self::emit_line(&line, on_event);
        }
    }

    /// Parses one complete line (newline already stripped) and emits an event
    /// when it is a `data:` field. Blank lines, comments, and other SSE fields
    /// (`event:`, `id:`, …) are ignored — chat-completion streams only use `data`.
    fn emit_line(line: &[u8], on_event: &mut impl FnMut(SseEvent)) {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        let Some(rest) = line.strip_prefix(b"data:") else {
            return;
        };
        let payload = trim_ascii(rest);
        if payload.is_empty() {
            return;
        }
        if payload == b"[DONE]" {
            on_event(SseEvent::Done);
            return;
        }
        match serde_json::from_slice::<serde_json::Value>(payload) {
            Ok(value) => on_event(SseEvent::Data(value)),
            Err(_) => on_event(SseEvent::Malformed(
                String::from_utf8_lossy(payload).into_owned(),
            )),
        }
    }
}

/// Trims leading and trailing ASCII whitespace from a byte slice.
fn trim_ascii(mut bytes: &[u8]) -> &[u8] {
    while let [first, rest @ ..] = bytes
        && first.is_ascii_whitespace()
    {
        bytes = rest;
    }
    while let [rest @ .., last] = bytes
        && last.is_ascii_whitespace()
    {
        bytes = rest;
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feeds a byte stream split at every `split` boundary and collects events.
    fn decode_in_chunks(data: &[u8], split: usize) -> Vec<SseEvent> {
        let mut decoder = SseDecoder::new();
        let mut events: Vec<SseEvent> = Vec::new();
        for chunk in data.chunks(split.max(1)) {
            decoder.feed(chunk, &mut |event| events.push(event));
        }
        events
    }

    #[test]
    fn parses_data_lines_and_done() {
        let body = b"data: {\"a\":1}\n\ndata: {\"b\":2}\n\ndata: [DONE]\n\n";
        let events = decode_in_chunks(body, body.len());
        assert_eq!(events.len(), 3);
        assert_eq!(events[2], SseEvent::Done);
    }

    #[test]
    fn survives_adversarial_chunk_splits() {
        let body = b"data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n";
        // Re-decode at every possible split size; the event sequence must be stable.
        for split in 1..=body.len() {
            let events = decode_in_chunks(body, split);
            assert_eq!(events.len(), 2, "split={split} produced {events:?}");
            assert!(matches!(events[0], SseEvent::Data(_)));
            assert_eq!(events[1], SseEvent::Done);
        }
    }

    #[test]
    fn surfaces_undecodable_data_payload() {
        let body = b"data: not json at all\n\n";
        let events = decode_in_chunks(body, 4);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0],
            SseEvent::Malformed("not json at all".to_string())
        );
    }

    #[test]
    fn finish_flushes_unterminated_final_line() {
        let mut decoder = SseDecoder::new();
        let mut events: Vec<SseEvent> = Vec::new();
        // No trailing newline after the usage frame.
        decoder.feed(b"data: {\"usage\":{}}", &mut |event| events.push(event));
        assert!(events.is_empty(), "incomplete line must not emit yet");
        decoder.finish(&mut |event| events.push(event));
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], SseEvent::Data(_)));
    }

    #[test]
    fn ignores_blank_lines_and_comments() {
        let body = b": keep-alive comment\n\nevent: ping\n\ndata: {\"x\":true}\n\n";
        let events = decode_in_chunks(body, 3);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], SseEvent::Data(_)));
    }
}

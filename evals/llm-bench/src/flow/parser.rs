//! Turns mitmproxy flow files into replayable [`Session`]s.

use std::path::Path;

use crate::flow::tnetstring::{self, TnetValue};
use crate::model::{CapturedRequest, RecordedBaseline, Session, Usage};
use crate::sse::{SseDecoder, SseEvent};
use crate::wire::Wire;

/// Request headers we never forward: hop-by-hop, length/encoding (reqwest sets
/// these), and the captured host (re-pointed at the target). `authorization` is
/// deliberately *kept* here — whether it is forwarded is decided at send time
/// from `--forward-auth` / `--api-key` (see `CapturedRequest::build_request`).
const STRIPPED_HEADERS: &[&str] = &[
    "host",
    "content-length",
    "connection",
    "accept-encoding",
    "transfer-encoding",
    "proxy-authorization",
];

/// Error raised while reading or interpreting a flow file.
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("reading {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("decoding {path}: {source}")]
    Tnet {
        path: String,
        #[source]
        source: tnetstring::TnetError,
    },
}

/// Reads a flow file and returns it as a single session containing every
/// captured chat-completion (`.../chat/completions`) or Anthropic Messages
/// (`/v1/messages`) request, in capture order.
pub fn parse_flow_file(path: &Path) -> Result<Session, ParseError> {
    let bytes = std::fs::read(path).map_err(|source| ParseError::Io {
        path: path.display().to_string(),
        source,
    })?;
    let flows = tnetstring::parse_stream(&bytes).map_err(|source| ParseError::Tnet {
        path: path.display().to_string(),
        source,
    })?;

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());

    let requests: Vec<CapturedRequest> = flows
        .iter()
        .filter_map(captured_request_from_flow)
        .collect();

    Ok(Session { name, requests })
}

/// Extracts a [`CapturedRequest`] from one flow dict, or `None` if the flow is
/// not a chat-completion request (or is a file-header entry without a request).
fn captured_request_from_flow(flow: &TnetValue) -> Option<CapturedRequest> {
    let request = flow.get("request")?;
    let method = request.get("method").and_then(TnetValue::as_str)?;
    let path = request.get("path").and_then(TnetValue::as_str)?;
    if !method.eq_ignore_ascii_case("POST") || !Wire::is_chat_path(path) {
        return None;
    }
    let wire = Wire::detect(path);

    let content = request.get("content").and_then(TnetValue::as_bytes)?;
    let body: serde_json::Value = serde_json::from_slice(content).ok()?;
    let model = body
        .get("model")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);

    Some(CapturedRequest {
        wire,
        path: path.to_owned(),
        headers: extract_headers(request),
        body,
        model,
        ts_start: request
            .get("timestamp_start")
            .and_then(TnetValue::as_float)
            .unwrap_or(0.0),
        ts_end: request
            .get("timestamp_end")
            .and_then(TnetValue::as_float)
            .unwrap_or(0.0),
        baseline: flow
            .get("response")
            .and_then(|response| baseline_from_response(response, wire)),
    })
}

/// Collects forwardable request headers, dropping the [`STRIPPED_HEADERS`].
fn extract_headers(request: &TnetValue) -> Vec<(String, String)> {
    let Some(list) = request.get("headers").and_then(TnetValue::as_list) else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|pair| {
            let pair = pair.as_list()?;
            let name = pair.first()?.as_str()?;
            let value = pair.get(1)?.as_str()?;
            if STRIPPED_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
                None
            } else {
                Some((name.to_owned(), value.to_owned()))
            }
        })
        .collect()
}

/// Derives the recorded baseline metrics from a flow's response dict.
fn baseline_from_response(response: &TnetValue, wire: Wire) -> Option<RecordedBaseline> {
    let status_code: u16 = response
        .get("status_code")
        .and_then(TnetValue::as_int)
        .and_then(|code| u16::try_from(code).ok())?;
    let ts_start = response
        .get("timestamp_start")
        .and_then(TnetValue::as_float)
        .unwrap_or(0.0);
    let ts_end = response
        .get("timestamp_end")
        .and_then(TnetValue::as_float)
        .unwrap_or(0.0);
    let latency_secs = (ts_end - ts_start).max(0.0);

    let recorded: RecordedUsage = response
        .get("content")
        .and_then(TnetValue::as_bytes)
        .map(|body| usage_from_recorded_sse(body, wire))
        .unwrap_or_default();
    let usage: Option<Usage> = recorded.usage;
    let output_tps: Option<f64> = usage.and_then(|u| {
        (latency_secs > 0.0 && u.completion_tokens > 0)
            .then(|| u.completion_tokens as f64 / latency_secs)
    });

    Some(RecordedBaseline {
        status_code,
        latency_secs,
        usage,
        output_tps,
        malformed_chunks: recorded.malformed_chunks,
    })
}

/// Token accounting recovered from a recorded SSE body, plus a count of any
/// `data:` payloads that failed to parse. The count keeps an undecodable frame
/// from being silently dropped (see [`usage_from_recorded_sse`]).
#[derive(Default)]
struct RecordedUsage {
    usage: Option<Usage>,
    malformed_chunks: usize,
}

/// Scans a complete recorded SSE body and folds every `data:` chunk's token
/// accounting into a single [`Usage`], using the wire's accumulation rules
/// (OpenAI's single trailing chunk wins; Anthropic's per-frame counts merge).
///
/// Reuses [`SseDecoder`] so the recorded path shares one malformed-payload
/// policy with the live-replay path (see `replay::worker`): an undecodable
/// `data:` payload is counted rather than silently discarded, so its dropped
/// token accounting can't quietly deflate the recorded baseline.
fn usage_from_recorded_sse(body: &[u8], wire: Wire) -> RecordedUsage {
    let mut usage: Option<Usage> = None;
    let mut malformed_chunks: usize = 0;
    let mut decoder: SseDecoder = SseDecoder::new();
    let mut handle_event = |event: SseEvent| match event {
        SseEvent::Data(value) => wire.update_usage(&mut usage, &value),
        SseEvent::Malformed(_) => malformed_chunks += 1,
        SseEvent::Done => {}
    };
    decoder.feed(body, &mut handle_event);
    decoder.finish(&mut handle_event);
    RecordedUsage {
        usage,
        malformed_chunks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_usage_from_recorded_stream() {
        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n",
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":3,",
            "\"total_tokens\":13,\"prompt_tokens_details\":{\"cached_tokens\":8}}}\n\n",
            "data: [DONE]\n\n",
        );
        let recorded = usage_from_recorded_sse(body.as_bytes(), Wire::OpenAi);
        assert_eq!(recorded.malformed_chunks, 0);
        let usage = recorded.usage.unwrap();
        assert_eq!(usage.prompt_tokens, 10);
        assert_eq!(usage.completion_tokens, 3);
        assert_eq!(usage.cached_tokens, Some(8));
    }

    #[test]
    fn extracts_usage_from_recorded_anthropic_stream() {
        // Anthropic spreads usage across message_start (prompt counts + initial
        // output) and message_delta (final output), with no [DONE] sentinel.
        let body = concat!(
            "event: message_start\n",
            "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":445,",
            "\"cache_creation_input_tokens\":31853,\"cache_read_input_tokens\":0,\"output_tokens\":27}}}\n\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n\n",
            "event: message_delta\n",
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":234}}\n\n",
            // Bedrock's message_stop summary omits the cache breakdown; it must
            // not clobber the prompt total accumulated from the earlier frames.
            "event: message_stop\n",
            "data: {\"type\":\"message_stop\",\"usage\":{\"input_tokens\":445,\"output_tokens\":234}}\n\n",
        );
        let recorded = usage_from_recorded_sse(body.as_bytes(), Wire::Anthropic);
        assert_eq!(recorded.malformed_chunks, 0);
        let usage = recorded.usage.unwrap();
        assert_eq!(usage.prompt_tokens, 32298);
        assert_eq!(usage.completion_tokens, 234);
        assert_eq!(usage.cached_tokens, Some(0));
    }

    #[test]
    fn counts_malformed_recorded_chunks() {
        // A `data:` frame that isn't JSON must be counted, not silently dropped,
        // so a partially-unparseable recorded body can't look like a clean one.
        let body = concat!(
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":3,",
            "\"total_tokens\":13}}\n\n",
            "data: not json at all\n\n",
            "data: [DONE]\n\n",
        );
        let recorded = usage_from_recorded_sse(body.as_bytes(), Wire::OpenAi);
        assert_eq!(recorded.malformed_chunks, 1);
        assert_eq!(recorded.usage.unwrap().completion_tokens, 3);
    }

    #[test]
    fn filters_non_chat_completion_flows() {
        // A GET flow with the wrong path must be skipped.
        let flow = TnetValue::Dict(vec![(
            "request".to_string(),
            TnetValue::Dict(vec![
                ("method".to_string(), TnetValue::Str("GET".into())),
                ("path".to_string(), TnetValue::Str("/health".into())),
            ]),
        )]);
        assert!(captured_request_from_flow(&flow).is_none());
    }
}

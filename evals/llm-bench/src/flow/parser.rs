//! Turns mitmproxy flow files into replayable [`Session`]s.

use std::path::Path;

use crate::flow::tnetstring::{self, TnetValue};
use crate::model::{CapturedRequest, RecordedBaseline, Session, Usage, usage_from_chunk};

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
/// captured `POST .../chat/completions` request, in capture order.
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
    if !method.eq_ignore_ascii_case("POST") || !path.contains("/chat/completions") {
        return None;
    }

    let content = request.get("content").and_then(TnetValue::as_bytes)?;
    let body: serde_json::Value = serde_json::from_slice(content).ok()?;
    let model = body
        .get("model")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);

    Some(CapturedRequest {
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
        baseline: flow.get("response").and_then(baseline_from_response),
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
fn baseline_from_response(response: &TnetValue) -> Option<RecordedBaseline> {
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

    let usage = response
        .get("content")
        .and_then(TnetValue::as_bytes)
        .and_then(usage_from_recorded_sse);
    let output_tps = usage.and_then(|u| {
        (latency_secs > 0.0 && u.completion_tokens > 0)
            .then(|| u.completion_tokens as f64 / latency_secs)
    });

    Some(RecordedBaseline {
        status_code,
        latency_secs,
        usage,
        output_tps,
    })
}

/// Scans a complete recorded SSE body for the last non-null `usage` chunk.
fn usage_from_recorded_sse(body: &[u8]) -> Option<Usage> {
    let text = std::str::from_utf8(body).ok()?;
    let mut last: Option<Usage> = None;
    for line in text.lines() {
        let Some(payload) = line.strip_prefix("data:") else {
            continue;
        };
        let payload = payload.trim();
        if payload.is_empty() || payload == "[DONE]" {
            continue;
        }
        if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(payload)
            && let Some(usage) = usage_from_chunk(&chunk)
        {
            last = Some(usage);
        }
    }
    last
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
        let usage = usage_from_recorded_sse(body.as_bytes()).unwrap();
        assert_eq!(usage.prompt_tokens, 10);
        assert_eq!(usage.completion_tokens, 3);
        assert_eq!(usage.cached_tokens, Some(8));
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

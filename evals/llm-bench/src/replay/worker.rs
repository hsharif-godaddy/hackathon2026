//! Execution of a single replayed request: sends it, consumes the SSE stream,
//! and times time-to-first-token and total latency.

use std::time::{Duration, Instant};

use tokio_stream::StreamExt;

use crate::metrics::record::{RequestOutcome, RequestStatus};
use crate::model::{
    CapturedRequest, TargetConfig, Usage, any_delta_text, content_delta, error_message_from_chunk,
    usage_from_chunk,
};
use crate::sse::{SseDecoder, SseEvent};

/// Rough fallback when the server omits a usage chunk: average bytes per token.
const BYTES_PER_TOKEN_ESTIMATE: f64 = 4.0;

/// Sends `request` to the target and consumes its streamed response, returning
/// the measured [`RequestOutcome`]. Never panics; transport, HTTP, and timeout
/// failures are captured in the outcome's status.
#[allow(clippy::too_many_arguments)]
pub async fn execute_request(
    client: &reqwest::Client,
    target: &TargetConfig,
    request: &CapturedRequest,
    session: &str,
    request_index: usize,
    test_start: Instant,
    request_timeout: Duration,
    cache_buster: Option<&str>,
) -> RequestOutcome {
    let sent_at = Instant::now();
    let started_at_secs = sent_at.saturating_duration_since(test_start).as_secs_f64();

    let result = tokio::time::timeout(
        request_timeout,
        stream_request(client, target, request, sent_at, cache_buster),
    )
    .await;

    let model = effective_model(request, target);
    let (baseline_output_tps, baseline_total_ms) = match &request.baseline {
        Some(baseline) => (baseline.output_tps, Some(baseline.latency_secs * 1000.0)),
        None => (None, None),
    };
    match result {
        Ok(Ok(stream)) => finish_ok(FinishContext {
            session,
            request_index,
            model,
            started_at_secs,
            sent_at,
            baseline_output_tps,
            baseline_total_ms,
            stream,
        }),
        Ok(Err(error)) => RequestOutcome {
            session: session.to_owned(),
            request_index,
            model,
            started_at_secs,
            status: error.status,
            ttft_ms: None,
            ttlt_ms: None,
            total_ms: sent_at.elapsed().as_secs_f64() * 1000.0,
            usage: None,
            completion_tokens: 0,
            output_tps: None,
            end_to_end_tps: None,
            baseline_output_tps,
            baseline_total_ms,
            error: Some(error.message),
        },
        Err(_) => RequestOutcome {
            session: session.to_owned(),
            request_index,
            model,
            started_at_secs,
            status: RequestStatus::Timeout,
            ttft_ms: None,
            ttlt_ms: None,
            total_ms: request_timeout.as_secs_f64() * 1000.0,
            usage: None,
            completion_tokens: 0,
            output_tps: None,
            end_to_end_tps: None,
            baseline_output_tps,
            baseline_total_ms,
            error: Some(format!(
                "exceeded {:.0}s timeout",
                request_timeout.as_secs_f64()
            )),
        },
    }
}

/// What [`stream_request`] accumulates on success.
struct StreamResult {
    /// Send → first visible `content` delta (the user-facing TTFT).
    ttft: Option<Duration>,
    /// Send → first generated token of any kind (content or reasoning); marks
    /// the end of prefill and the start of decode.
    first_token: Option<Duration>,
    /// Send → last visible `content` delta (time-to-last-token); the
    /// user-perceived completion time, before the trailing usage/[DONE] frames.
    last_token: Option<Duration>,
    usage: Option<Usage>,
    content_bytes: usize,
}

/// A non-success path with the status to record.
struct StreamFailure {
    status: RequestStatus,
    message: String,
}

/// Sends the request and drains the SSE stream, timing the first content token.
async fn stream_request(
    client: &reqwest::Client,
    target: &TargetConfig,
    request: &CapturedRequest,
    sent_at: Instant,
    cache_buster: Option<&str>,
) -> Result<StreamResult, StreamFailure> {
    let response = request
        .build_request(client, target, cache_buster)
        .send()
        .await
        .map_err(|e| StreamFailure {
            status: RequestStatus::Transport,
            message: e.to_string(),
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(StreamFailure {
            status: RequestStatus::HttpError {
                code: status.as_u16(),
            },
            message: format!("HTTP {status}: {}", body_snippet(&body)),
        });
    }

    let mut decoder = SseDecoder::new();
    let mut ttft: Option<Duration> = None;
    let mut first_token: Option<Duration> = None;
    let mut last_token: Option<Duration> = None;
    let mut usage: Option<Usage> = None;
    let mut content_bytes: usize = 0;
    let mut error_message: Option<String> = None;

    let mut handle_event = |event: SseEvent| match event {
        SseEvent::Data(value) => {
            if let Some(message) = error_message_from_chunk(&value) {
                error_message.get_or_insert(message);
                return;
            }
            if any_delta_text(&value).is_some() {
                first_token.get_or_insert_with(|| sent_at.elapsed());
            }
            if let Some(content) = content_delta(&value) {
                ttft.get_or_insert_with(|| sent_at.elapsed());
                last_token = Some(sent_at.elapsed());
                content_bytes += content.len();
            }
            if let Some(found) = usage_from_chunk(&value) {
                usage = Some(found);
            }
        }
        SseEvent::Malformed(text) => {
            error_message.get_or_insert(text);
        }
        SseEvent::Done => {}
    };

    let mut stream = std::pin::pin!(response.bytes_stream());
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| StreamFailure {
            status: RequestStatus::Transport,
            message: e.to_string(),
        })?;
        decoder.feed(&chunk, &mut handle_event);
    }
    decoder.finish(&mut handle_event);

    // A 200 response whose stream carried an error frame (or an undecodable
    // payload) is a failure, not a success — counting it as Ok would deflate the
    // error rate this tool exists to measure.
    if let Some(message) = error_message {
        return Err(StreamFailure {
            status: RequestStatus::Stream,
            message: format!("stream error: {}", body_snippet(&message)),
        });
    }

    Ok(StreamResult {
        ttft,
        first_token,
        last_token,
        usage,
        content_bytes,
    })
}

/// Inputs needed to assemble a successful outcome.
struct FinishContext<'a> {
    session: &'a str,
    request_index: usize,
    model: Option<String>,
    started_at_secs: f64,
    sent_at: Instant,
    baseline_output_tps: Option<f64>,
    baseline_total_ms: Option<f64>,
    stream: StreamResult,
}

/// Assembles a successful outcome, resolving token counts and throughput.
fn finish_ok(ctx: FinishContext<'_>) -> RequestOutcome {
    let total = ctx.sent_at.elapsed();
    let completion_tokens = ctx
        .stream
        .usage
        .map(|u| u.completion_tokens)
        .unwrap_or_else(|| {
            (ctx.stream.content_bytes as f64 / BYTES_PER_TOKEN_ESTIMATE).round() as u64
        });

    let ttft_ms = ctx.stream.ttft.map(|d| d.as_secs_f64() * 1000.0);
    let ttlt_ms = ctx.stream.last_token.map(|d| d.as_secs_f64() * 1000.0);
    // Decode throughput excludes prefill only: measure from the first generated
    // token (reasoning included), not the first visible content token, so the
    // reasoning phase isn't wrongly excluded from a denominator whose numerator
    // counts reasoning tokens.
    let generation_secs = ctx
        .stream
        .first_token
        .map(|first| (total.saturating_sub(first)).as_secs_f64());
    let output_tps = match (completion_tokens, generation_secs) {
        (tokens, Some(secs)) if tokens > 0 && secs > 0.0 => Some(tokens as f64 / secs),
        _ => None,
    };
    let total_secs = total.as_secs_f64();
    let end_to_end_tps =
        (completion_tokens > 0 && total_secs > 0.0).then(|| completion_tokens as f64 / total_secs);

    RequestOutcome {
        session: ctx.session.to_owned(),
        request_index: ctx.request_index,
        model: ctx.model,
        started_at_secs: ctx.started_at_secs,
        status: RequestStatus::Ok,
        ttft_ms,
        ttlt_ms,
        total_ms: total_secs * 1000.0,
        usage: ctx.stream.usage,
        completion_tokens,
        output_tps,
        end_to_end_tps,
        baseline_output_tps: ctx.baseline_output_tps,
        baseline_total_ms: ctx.baseline_total_ms,
        error: None,
    }
}

/// The model that will actually be sent (override wins over the captured value).
fn effective_model(request: &CapturedRequest, target: &TargetConfig) -> Option<String> {
    target
        .model_override
        .clone()
        .or_else(|| request.model.clone())
}

/// A single-line, length-bounded snippet of a response body for error messages.
fn body_snippet(body: &str) -> String {
    const MAX: usize = 200;
    let flat: String = body.split_whitespace().collect::<Vec<_>>().join(" ");
    match flat.char_indices().nth(MAX) {
        Some((idx, _)) => format!("{}…", &flat[..idx]),
        None => flat,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replay::build_client;

    const CANNED_STREAM: &str = concat!(
        "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\",\"content\":\"\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"reasoning\":\"thinking\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n",
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"total_tokens\":7}}\n\n",
        "data: [DONE]\n\n",
    );

    /// Starts an in-process axum server that replays the canned stream and
    /// returns its base URL.
    async fn spawn_mock_server() -> String {
        let app = axum::Router::new().route(
            "/v1/chat/completions",
            axum::routing::post(|| async {
                (
                    [(axum::http::header::CONTENT_TYPE, "text/event-stream")],
                    CANNED_STREAM,
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{addr}")
    }

    fn sample_request() -> CapturedRequest {
        CapturedRequest {
            path: "/v1/chat/completions".into(),
            headers: Vec::new(),
            body: serde_json::json!({ "model": "test-model", "messages": [] }),
            model: Some("test-model".into()),
            ts_start: 0.0,
            ts_end: 0.0,
            baseline: None,
        }
    }

    #[tokio::test]
    async fn replays_stream_and_measures_metrics() {
        let base_url = spawn_mock_server().await;
        let target = TargetConfig {
            base_url,
            model_override: None,
            api_key: None,
            forward_auth: false,
            bust_system_prompt: false,
        };
        let client = build_client(1).unwrap();

        let outcome = execute_request(
            &client,
            &target,
            &sample_request(),
            "mock",
            0,
            Instant::now(),
            Duration::from_secs(10),
            None,
        )
        .await;

        assert_eq!(outcome.status, RequestStatus::Ok);
        assert_eq!(outcome.completion_tokens, 2);
        assert_eq!(outcome.usage.map(|u| u.prompt_tokens), Some(5));
        assert!(outcome.ttft_ms.is_some(), "expected a time-to-first-token");
        assert!(
            outcome.ttlt_ms >= outcome.ttft_ms,
            "last-token time must be at or after first-token time"
        );
        assert!(outcome.total_ms > 0.0);
    }

    #[tokio::test]
    async fn records_http_errors() {
        let app = axum::Router::new().route(
            "/v1/chat/completions",
            axum::routing::post(|| async { axum::http::StatusCode::TOO_MANY_REQUESTS }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let target = TargetConfig {
            base_url: format!("http://{addr}"),
            model_override: None,
            api_key: None,
            forward_auth: false,
            bust_system_prompt: false,
        };
        let client = build_client(1).unwrap();
        let outcome = execute_request(
            &client,
            &target,
            &sample_request(),
            "mock",
            0,
            Instant::now(),
            Duration::from_secs(10),
            None,
        )
        .await;

        assert_eq!(outcome.status, RequestStatus::HttpError { code: 429 });
    }

    /// A stream that opens 200, emits content, then an error frame and closes
    /// cleanly must be classified as a failure, not a silent success.
    #[tokio::test]
    async fn records_mid_stream_error_as_failure() {
        const ERROR_STREAM: &str = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n",
            "data: {\"error\":{\"message\":\"KV cache exhausted\",\"type\":\"server_error\"}}\n\n",
        );
        let app = axum::Router::new().route(
            "/v1/chat/completions",
            axum::routing::post(|| async {
                (
                    [(axum::http::header::CONTENT_TYPE, "text/event-stream")],
                    ERROR_STREAM,
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let target = TargetConfig {
            base_url: format!("http://{addr}"),
            model_override: None,
            api_key: None,
            forward_auth: false,
            bust_system_prompt: false,
        };
        let client = build_client(1).unwrap();
        let outcome = execute_request(
            &client,
            &target,
            &sample_request(),
            "mock",
            0,
            Instant::now(),
            Duration::from_secs(10),
            None,
        )
        .await;

        assert_eq!(outcome.status, RequestStatus::Stream);
        assert_eq!(outcome.completion_tokens, 0);
        assert!(
            outcome
                .error
                .as_deref()
                .is_some_and(|e| e.contains("KV cache exhausted")),
            "error message should carry the server's reason, got {:?}",
            outcome.error
        );
    }
}

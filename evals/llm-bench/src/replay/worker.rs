//! Execution of a single replayed request: sends it, consumes the SSE stream,
//! and times time-to-first-token and total latency.

use std::time::{Duration, Instant};

use tokio_stream::StreamExt;

use crate::metrics::record::{RequestOutcome, RequestStatus};
use crate::model::{CapturedRequest, TargetConfig, Usage, error_message_from_chunk};
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
    /// Send → first generated token of any kind — visible content, reasoning, or
    /// a tool-call fragment. This is the moment the stream starts returning data:
    /// the reported TTFT, which also marks the end of prefill / start of decode.
    /// Tool-call and reasoning-only responses (common in agent traffic) count,
    /// so TTFT is never silently dropped for them.
    first_token: Option<Duration>,
    /// Send → last generated token of any kind (time-to-last-token), before the
    /// trailing usage/[DONE] frames.
    last_token: Option<Duration>,
    usage: Option<Usage>,
    generated_bytes: usize,
}

/// A non-success path with the status to record.
struct StreamFailure {
    status: RequestStatus,
    message: String,
}

/// Sends the request and drains the SSE stream, timing the first generated token.
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
    let mut first_token: Option<Duration> = None;
    let mut last_token: Option<Duration> = None;
    let mut usage: Option<Usage> = None;
    let mut generated_bytes: usize = 0;
    let mut error_message: Option<String> = None;

    let wire = request.wire;
    let mut handle_event = |event: SseEvent| match event {
        SseEvent::Data(value) => {
            if let Some(message) = error_message_from_chunk(&value) {
                error_message.get_or_insert(message);
                return;
            }
            if let Some(text) = wire.any_delta_text(&value) {
                first_token.get_or_insert_with(|| sent_at.elapsed());
                last_token = Some(sent_at.elapsed());
                generated_bytes += text.len();
            }
            wire.update_usage(&mut usage, &value);
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
        first_token,
        last_token,
        usage,
        generated_bytes,
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
            (ctx.stream.generated_bytes as f64 / BYTES_PER_TOKEN_ESTIMATE).round() as u64
        });

    // TTFT is the first generated token of any kind, which is also where decode
    // begins — so the throughput denominator (prefill excluded) starts at the
    // same instant, keeping the numerator's token count and this denominator
    // consistent for reasoning- and tool-heavy responses.
    let ttft_ms = ctx.stream.first_token.map(|d| d.as_secs_f64() * 1000.0);
    let ttlt_ms = ctx.stream.last_token.map(|d| d.as_secs_f64() * 1000.0);
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
            wire: crate::wire::Wire::OpenAi,
            path: "/v1/chat/completions".into(),
            headers: Vec::new(),
            body: serde_json::json!({ "model": "test-model", "messages": [] }),
            model: Some("test-model".into()),
            ts_start: 0.0,
            ts_end: 0.0,
            baseline: None,
        }
    }

    /// Spawns a one-route mock server that replays `body` as an SSE stream on
    /// `path`, and replays the given wire's request against it.
    async fn replay_canned(
        wire: crate::wire::Wire,
        path: &'static str,
        body: &'static str,
    ) -> RequestOutcome {
        let app = axum::Router::new().route(
            path,
            axum::routing::post(move || async move {
                (
                    [(axum::http::header::CONTENT_TYPE, "text/event-stream")],
                    body,
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
        let request = CapturedRequest {
            wire,
            path: path.into(),
            headers: Vec::new(),
            body: serde_json::json!({ "model": "test-model", "messages": [] }),
            model: Some("test-model".into()),
            ts_start: 0.0,
            ts_end: 0.0,
            baseline: None,
        };
        let client = build_client(1).unwrap();
        execute_request(
            &client,
            &target,
            &request,
            "mock",
            0,
            Instant::now(),
            Duration::from_secs(10),
            None,
        )
        .await
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

    const CANNED_ANTHROPIC_STREAM: &str = concat!(
        "event: message_start\n",
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":40,",
        "\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":10,\"output_tokens\":2}}}\n\n",
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n\n",
        "event: message_delta\n",
        "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":7}}\n\n",
        "event: message_stop\n",
        "data: {\"type\":\"message_stop\"}\n\n",
    );

    #[tokio::test]
    async fn replays_anthropic_stream_and_measures_metrics() {
        let app = axum::Router::new().route(
            "/v1/messages",
            axum::routing::post(|| async {
                (
                    [(axum::http::header::CONTENT_TYPE, "text/event-stream")],
                    CANNED_ANTHROPIC_STREAM,
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
        let request = CapturedRequest {
            wire: crate::wire::Wire::Anthropic,
            path: "/v1/messages".into(),
            headers: Vec::new(),
            body: serde_json::json!({ "model": "claude-sonnet-4-6", "messages": [] }),
            model: Some("claude-sonnet-4-6".into()),
            ts_start: 0.0,
            ts_end: 0.0,
            baseline: None,
        };
        let client = build_client(1).unwrap();

        let outcome = execute_request(
            &client,
            &target,
            &request,
            "mock",
            0,
            Instant::now(),
            Duration::from_secs(10),
            None,
        )
        .await;

        assert_eq!(outcome.status, RequestStatus::Ok);
        assert_eq!(
            outcome.completion_tokens, 7,
            "final cumulative output_tokens from message_delta"
        );
        let usage = outcome.usage.expect("usage from the Anthropic stream");
        assert_eq!(usage.prompt_tokens, 50, "input_tokens + cache_read_tokens");
        assert_eq!(usage.cached_tokens, Some(10));
        assert!(outcome.ttft_ms.is_some(), "expected a time-to-first-token");
    }

    // A response that is entirely tool calls — no visible `content` — is the
    // norm for agent traffic. TTFT/TTLT must still be recorded (the tool call
    // *is* the first token back), or these turns would silently drop out of the
    // latency aggregates. Both wires must behave identically.
    const OPENAI_TOOL_ONLY_STREAM: &str = concat!(
        "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,",
        "\"id\":\"call_1\",\"function\":{\"name\":\"get_weather\",\"arguments\":\"\"}}]}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,",
        "\"function\":{\"arguments\":\"{\\\"city\\\":\"}}]}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,",
        "\"function\":{\"arguments\":\"\\\"SF\\\"}\"}}]}}]}\n\n",
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":8,\"completion_tokens\":5,\"total_tokens\":13}}\n\n",
        "data: [DONE]\n\n",
    );

    #[tokio::test]
    async fn openai_tool_only_stream_records_ttft() {
        let outcome = replay_canned(
            crate::wire::Wire::OpenAi,
            "/v1/chat/completions",
            OPENAI_TOOL_ONLY_STREAM,
        )
        .await;

        assert_eq!(outcome.status, RequestStatus::Ok);
        assert!(
            outcome.ttft_ms.is_some(),
            "a tool-only stream must still record TTFT"
        );
        assert!(
            outcome.ttlt_ms.is_some(),
            "a tool-only stream must still record TTLT"
        );
        assert!(outcome.ttlt_ms >= outcome.ttft_ms);
    }

    const ANTHROPIC_TOOL_ONLY_STREAM: &str = concat!(
        "event: message_start\n",
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":40,",
        "\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0,\"output_tokens\":2}}}\n\n",
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",",
        "\"id\":\"toolu_1\",\"name\":\"get_weather\",\"input\":{}}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",",
        "\"partial_json\":\"{\\\"city\\\":\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",",
        "\"partial_json\":\"\\\"SF\\\"}\"}}\n\n",
        "event: message_delta\n",
        "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":9}}\n\n",
        "event: message_stop\n",
        "data: {\"type\":\"message_stop\"}\n\n",
    );

    #[tokio::test]
    async fn anthropic_tool_only_stream_records_ttft() {
        let outcome = replay_canned(
            crate::wire::Wire::Anthropic,
            "/v1/messages",
            ANTHROPIC_TOOL_ONLY_STREAM,
        )
        .await;

        assert_eq!(outcome.status, RequestStatus::Ok);
        assert!(
            outcome.ttft_ms.is_some(),
            "a tool-only stream must still record TTFT"
        );
        assert!(
            outcome.ttlt_ms.is_some(),
            "a tool-only stream must still record TTLT"
        );
        assert!(outcome.ttlt_ms >= outcome.ttft_ms);
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

//! `--probe`: replay a whole captured session against the target, exactly as a
//! single virtual user would in a real run — every request in capture order,
//! back-to-back — printing each streamed response (visible content, reasoning
//! traces dimmed, and tool calls) plus per-request and session metrics. A
//! verification aid for confirming the endpoint behaves end-to-end before a load
//! run. Concurrency is always one.

use std::io::{IsTerminal, Write};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use tokio_stream::StreamExt;

use crate::model::{
    CapturedRequest, Session, TargetConfig, Usage, any_delta_text, content_delta,
    error_message_from_chunk, reasoning_delta, tool_call_fragments, usage_from_chunk,
};
use crate::replay::build_client;
use crate::sse::{SseDecoder, SseEvent};

/// Rough fallback when the server omits a usage chunk: average bytes per token.
const BYTES_PER_TOKEN_ESTIMATE: f64 = 4.0;

/// The constant marker probe injects under `--unique-sessions`. A real virtual
/// user keeps one marker for the whole conversation, so probe does too.
const PROBE_MARKER: &str = "[llm-bench probe] ";

/// Replays the first non-empty session's requests in order, printing each
/// exchange and a closing session summary.
pub async fn run_probe(
    target: TargetConfig,
    sessions: &[Session],
    unique_sessions: bool,
    request_timeout: Duration,
) -> Result<()> {
    let session: &Session = sessions
        .iter()
        .find(|session| !session.requests.is_empty())
        .context("no replayable request found to probe")?;

    let cache_buster: Option<&str> = unique_sessions.then_some(PROBE_MARKER);
    let client: reqwest::Client = build_client(1).context("building HTTP client")?;
    let dim: bool = std::io::stdout().is_terminal();

    print_session_header(session, &target, cache_buster);

    let mut ok: usize = 0;
    let mut errors: usize = 0;
    let mut total_completion: u64 = 0;
    let run_start: Instant = Instant::now();

    for (index, request) in session.requests.iter().enumerate() {
        print_request_header(index, session.len(), request, &target, cache_buster);
        let sent_at: Instant = Instant::now();
        let outcome: ProbeOutcome = match tokio::time::timeout(
            request_timeout,
            exchange(&client, &target, request, cache_buster, sent_at, dim),
        )
        .await
        {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(error)) => {
                println!("  ⚠ transport error: {error:#}");
                errors += 1;
                continue;
            }
            Err(_) => {
                println!(
                    "  ⚠ aborted: exceeded the {:.0}s budget (--request-timeout)",
                    request_timeout.as_secs_f64()
                );
                errors += 1;
                continue;
            }
        };

        if outcome.status_ok {
            ok += 1;
        } else {
            errors += 1;
        }
        total_completion += outcome.completion_tokens;
        print_outcome_line(&outcome);
    }

    println!("\n── session summary ──");
    println!(
        "{} request(s) | {} ok | {} error(s) | completion tokens {} | wall {:.1}s",
        session.len(),
        ok,
        errors,
        total_completion,
        run_start.elapsed().as_secs_f64()
    );
    Ok(())
}

/// What one replayed request produced.
struct ProbeOutcome {
    status_ok: bool,
    /// Send → first generated token of any kind (content, reasoning, or tool call).
    first_token: Option<Duration>,
    /// Send → last generated token of any kind.
    last_token: Option<Duration>,
    total: Duration,
    usage: Option<Usage>,
    completion_tokens: u64,
    reasoning_bytes: usize,
    tool_names: Vec<String>,
    error: Option<String>,
}

/// Sends one request and streams its response to stdout, returning the measured
/// outcome. Visible content is printed plain, reasoning dimmed, and tool calls as
/// `→ name {args…}`.
async fn exchange(
    client: &reqwest::Client,
    target: &TargetConfig,
    request: &CapturedRequest,
    cache_buster: Option<&str>,
    sent_at: Instant,
    dim: bool,
) -> Result<ProbeOutcome> {
    let response: reqwest::Response = request
        .build_request(client, target, cache_buster)
        .send()
        .await
        .context("sending probe request")?;

    let status: reqwest::StatusCode = response.status();
    if !status.is_success() {
        let body: String = response.text().await.unwrap_or_default();
        return Ok(ProbeOutcome {
            status_ok: false,
            first_token: None,
            last_token: None,
            total: sent_at.elapsed(),
            usage: None,
            completion_tokens: 0,
            reasoning_bytes: 0,
            tool_names: Vec::new(),
            error: Some(format!("HTTP {}: {}", status.as_u16(), body_snippet(&body))),
        });
    }

    let mut decoder: SseDecoder = SseDecoder::new();
    let mut first_token: Option<Duration> = None;
    let mut last_token: Option<Duration> = None;
    let mut usage: Option<Usage> = None;
    let mut generated_bytes: usize = 0;
    let mut reasoning_bytes: usize = 0;
    let mut tool_names: Vec<String> = Vec::new();
    let mut error_message: Option<String> = None;
    let mut printed: bool = false;

    {
        let mut handle = |event: SseEvent| match event {
            SseEvent::Data(value) => {
                if let Some(message) = error_message_from_chunk(&value) {
                    error_message.get_or_insert(message);
                    return;
                }
                if any_delta_text(&value).is_some() {
                    first_token.get_or_insert_with(|| sent_at.elapsed());
                    last_token = Some(sent_at.elapsed());
                }
                if let Some(reasoning) = reasoning_delta(&value) {
                    reasoning_bytes += reasoning.len();
                    generated_bytes += reasoning.len();
                    print_fragment(reasoning, dim);
                    printed = true;
                }
                if let Some(content) = content_delta(&value) {
                    generated_bytes += content.len();
                    print!("{content}");
                    let _ = std::io::stdout().flush();
                    printed = true;
                }
                for fragment in tool_call_fragments(&value) {
                    if let Some(name) = fragment.name {
                        tool_names.push(name.to_owned());
                        print!("\n  → {name} ");
                        printed = true;
                    }
                    if let Some(arguments) = fragment.arguments {
                        generated_bytes += arguments.len();
                        print!("{arguments}");
                        printed = true;
                    }
                    let _ = std::io::stdout().flush();
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
            let chunk = item.context("reading probe response stream")?;
            decoder.feed(&chunk, &mut handle);
        }
        decoder.finish(&mut handle);
    }

    if printed {
        println!();
    }

    let completion_tokens: u64 = usage
        .map(|u| u.completion_tokens)
        .unwrap_or_else(|| (generated_bytes as f64 / BYTES_PER_TOKEN_ESTIMATE).round() as u64);

    Ok(ProbeOutcome {
        status_ok: error_message.is_none(),
        first_token,
        last_token,
        total: sent_at.elapsed(),
        usage,
        completion_tokens,
        reasoning_bytes,
        tool_names,
        error: error_message.map(|message| format!("stream error: {}", body_snippet(&message))),
    })
}

/// Prints the one-line metrics summary for a finished request.
fn print_outcome_line(outcome: &ProbeOutcome) {
    if let Some(error) = &outcome.error {
        println!("  ⚠ {error}");
    }
    let mut parts: Vec<String> = Vec::new();
    parts.push(if outcome.status_ok { "ok" } else { "FAIL" }.to_string());
    match outcome.usage {
        Some(usage) => parts.push(format!(
            "tokens {}→{}",
            usage.prompt_tokens, usage.completion_tokens
        )),
        None => parts.push(format!("~{} tok (est)", outcome.completion_tokens)),
    }
    parts.push(format!("first {}", opt_ms(outcome.first_token)));
    parts.push(format!("last {}", opt_ms(outcome.last_token)));
    if let Some(decode) = decode_tps(
        outcome.completion_tokens,
        outcome.total,
        outcome.first_token,
    ) {
        parts.push(format!("decode {decode:.0} tok/s"));
    }
    parts.push(format!(
        "total {:.0}ms",
        outcome.total.as_secs_f64() * 1000.0
    ));
    if outcome.reasoning_bytes > 0 {
        parts.push(format!("reasoning {}B", outcome.reasoning_bytes));
    }
    if !outcome.tool_names.is_empty() {
        parts.push(format!("tools: {}", outcome.tool_names.join(", ")));
    }
    println!("  {}", parts.join(" | "));
}

/// Decode throughput: completion tokens over the post-prefill window (from the
/// first generated token of any kind). `None` when it cannot be computed.
fn decode_tps(
    completion_tokens: u64,
    total: Duration,
    first_token: Option<Duration>,
) -> Option<f64> {
    let secs: f64 = total.saturating_sub(first_token?).as_secs_f64();
    (completion_tokens > 0 && secs > 0.0).then(|| completion_tokens as f64 / secs)
}

/// Formats an optional duration as milliseconds, or `—` when absent.
fn opt_ms(duration: Option<Duration>) -> String {
    duration.map_or_else(
        || "—".to_string(),
        |d| format!("{:.0}ms", d.as_secs_f64() * 1000.0),
    )
}

/// Writes a streamed fragment, dimmed when stdout is a terminal so reasoning
/// traces are visibly distinct from the model's actual answer.
fn print_fragment(text: &str, dim: bool) {
    if dim {
        print!("\x1b[2m{text}\x1b[0m");
    } else {
        print!("{text}");
    }
    let _ = std::io::stdout().flush();
}

/// Prints the run-wide header: endpoint, model, auth mode, and unique-session
/// marker placement.
fn print_session_header(session: &Session, target: &TargetConfig, cache_buster: Option<&str>) {
    let path: &str = session
        .requests
        .first()
        .map_or("/v1/chat/completions", |request| request.path.as_str());
    let model: &str = target
        .model_override
        .as_deref()
        .or_else(|| session.requests.first().and_then(|r| r.model.as_deref()))
        .unwrap_or("<unset>");

    println!(
        "── probe: replaying session {} ({} request(s)) ──",
        session.name,
        session.len()
    );
    println!(
        "target: POST {}{}",
        target.base_url.trim_end_matches('/'),
        path
    );
    println!("model:  {model}");
    println!("auth:   {}", auth_label(target));
    match cache_buster {
        Some(marker) => println!(
            "unique: marker {marker:?} ({})",
            if target.bust_system_prompt {
                "before the system prompt"
            } else {
                "after the system prompt"
            }
        ),
        None => println!("unique: off"),
    }
}

/// Prints the per-request header (index, outgoing body size, message count).
fn print_request_header(
    index: usize,
    total: usize,
    request: &CapturedRequest,
    target: &TargetConfig,
    cache_buster: Option<&str>,
) {
    let body: serde_json::Value = request.rewritten_body(target, cache_buster);
    let body_bytes: usize = serde_json::to_vec(&body).map(|b| b.len()).unwrap_or(0);
    let messages: usize = body
        .get("messages")
        .and_then(serde_json::Value::as_array)
        .map_or(0, Vec::len);
    println!("\n[{index:>2}/{total}] body={body_bytes}B messages={messages}");
}

/// Describes how the probe request will authenticate against the target.
fn auth_label(target: &TargetConfig) -> &'static str {
    if target.api_key.is_some() {
        "bearer token (--api-key)"
    } else if target.forward_auth {
        "forwarding captured Authorization header"
    } else {
        "none"
    }
}

/// A single-line, length-bounded snippet of a body/message for diagnostics.
fn body_snippet(text: &str) -> String {
    const MAX: usize = 200;
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    match flat.char_indices().nth(MAX) {
        Some((idx, _)) => format!("{}…", &flat[..idx]),
        None => flat,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target_with(api_key: Option<&str>, forward_auth: bool) -> TargetConfig {
        TargetConfig {
            base_url: "http://localhost:8000".into(),
            model_override: None,
            api_key: api_key.map(str::to_owned),
            forward_auth,
            bust_system_prompt: false,
        }
    }

    #[test]
    fn auth_label_reflects_precedence() {
        assert_eq!(
            auth_label(&target_with(Some("k"), true)),
            "bearer token (--api-key)",
            "an explicit key wins over --forward-auth"
        );
        assert_eq!(
            auth_label(&target_with(None, true)),
            "forwarding captured Authorization header"
        );
        assert_eq!(auth_label(&target_with(None, false)), "none");
    }

    #[test]
    fn decode_tps_excludes_prefill_and_guards_zero() {
        let tps: Option<f64> =
            decode_tps(100, Duration::from_secs(2), Some(Duration::from_secs(1)));
        assert_eq!(
            tps,
            Some(100.0),
            "100 tokens over the 1s post-prefill window"
        );
        assert_eq!(
            decode_tps(100, Duration::from_secs(2), None),
            None,
            "no first token → no decode rate"
        );
        assert_eq!(
            decode_tps(0, Duration::from_secs(2), Some(Duration::from_secs(1))),
            None,
            "zero tokens → no decode rate"
        );
    }
}

//! Domain types shared across parsing, replay, and reporting.

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::Serialize;

use crate::wire::Wire;

/// Where and how replayed requests are sent.
#[derive(Debug, Clone)]
pub struct TargetConfig {
    /// Base URL, e.g. `http://localhost:8000`; the captured path is appended.
    pub base_url: String,
    /// Replaces the `model` field in every request body when set.
    pub model_override: Option<String>,
    /// Sent as `Authorization: Bearer <key>` when set; overrides any forwarded
    /// captured credential.
    pub api_key: Option<String>,
    /// Forward the captured credential header as-is — `Authorization` (OpenAI) or
    /// Anthropic's `x-api-key` / `api-key` — for replaying against the endpoint the
    /// workload was captured from. Ignored when `api_key` is set.
    pub forward_auth: bool,
    /// When a unique-session cache-buster is injected, also place it ahead of the
    /// system prompt (defeating the shared system-prompt cache). Off by default,
    /// so the system prompt stays cacheable as it would be in production.
    pub bust_system_prompt: bool,
}

impl TargetConfig {
    /// Whether captured credential headers should be forwarded for a request:
    /// only when explicitly opted in and no override key is supplied.
    fn forwards_captured_auth(&self) -> bool {
        self.forward_auth && self.api_key.is_none()
    }
}

/// Captured request headers that carry a credential. They are forwarded only
/// under `--forward-auth` (and never alongside an `--api-key` override), so a
/// stale captured token is not leaked to a re-pointed target by default. Covers
/// OpenAI-style `authorization` and Anthropic's `x-api-key` / `api-key`.
const CAPTURED_CREDENTIAL_HEADERS: [&str; 3] = ["authorization", "x-api-key", "api-key"];

/// Whether a header name is one of the [`CAPTURED_CREDENTIAL_HEADERS`].
fn is_credential_header(name: &str) -> bool {
    CAPTURED_CREDENTIAL_HEADERS
        .iter()
        .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

/// Token accounting reported by an OpenAI-compatible server in its final
/// streaming `usage` chunk.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
pub struct Usage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub cached_tokens: Option<u64>,
}

/// Extracts a [`Usage`] from a single `chat.completion.chunk` JSON value, if it
/// carries a non-null `usage` object. The final chunk of a stream (sent because
/// we force `stream_options.include_usage`) is the one that populates this.
pub fn usage_from_chunk(chunk: &serde_json::Value) -> Option<Usage> {
    let usage = chunk.get("usage")?;
    if usage.is_null() {
        return None;
    }
    // Require the token counts we depend on to be present, so a partial usage
    // object is treated as "no usage" (and falls back to estimation) rather than
    // silently reporting zero tokens and deflating throughput.
    let prompt_tokens: u64 = usage.get("prompt_tokens")?.as_u64()?;
    let completion_tokens: u64 = usage.get("completion_tokens")?.as_u64()?;
    let total_tokens: u64 = usage
        .get("total_tokens")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(prompt_tokens + completion_tokens);
    Some(Usage {
        prompt_tokens,
        completion_tokens,
        total_tokens,
        cached_tokens: usage
            .get("prompt_tokens_details")
            .and_then(|d| d.get("cached_tokens"))
            .and_then(serde_json::Value::as_u64),
    })
}

/// Extracts a server-sent error message from a streamed chunk that carries a
/// top-level `error` field — `{"error": {"message": ...}}` or `{"error": "..."}`.
/// OpenAI-compatible servers emit these mid-stream on under-load failures after
/// the 200 response line is already committed.
pub fn error_message_from_chunk(chunk: &serde_json::Value) -> Option<String> {
    let error = chunk.get("error")?;
    if error.is_null() {
        return None;
    }
    let message = error
        .get("message")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| error.to_string());
    Some(message)
}

/// Returns the `delta.content` string of a streaming chunk, if present and
/// non-empty. `delta.reasoning` is deliberately ignored — time-to-first-token
/// is defined against visible content, not reasoning.
pub fn content_delta(chunk: &serde_json::Value) -> Option<&str> {
    let content = chunk
        .get("choices")?
        .as_array()?
        .first()?
        .get("delta")?
        .get("content")?
        .as_str()?;
    if content.is_empty() {
        None
    } else {
        Some(content)
    }
}

/// Keys under `delta` carrying a reasoning model's thinking trace (everything in
/// [`GENERATED_TOKEN_KEYS`] except the visible `content`).
const REASONING_KEYS: [&str; 2] = ["reasoning", "reasoning_content"];

/// Keys under `delta` that carry newly generated tokens for a reasoning model.
const GENERATED_TOKEN_KEYS: [&str; 3] = ["content", "reasoning", "reasoning_content"];

/// Returns the first non-empty generated-token text in a streaming chunk —
/// visible `content`, `reasoning` / `reasoning_content` from a reasoning model,
/// or a tool-call `function.name` / `arguments` fragment. Unlike
/// [`content_delta`], this marks the *true* start of generation (decode), so the
/// decode-throughput denominator excludes prefill **only**. Server
/// `completion_tokens` counts include reasoning and tool-call tokens, so the
/// numerator and this denominator stay consistent — important for agent traffic,
/// where a response can be entirely tool calls with no visible content.
pub fn any_delta_text(chunk: &serde_json::Value) -> Option<&str> {
    let delta: &serde_json::Value = chunk.get("choices")?.as_array()?.first()?.get("delta")?;
    for key in GENERATED_TOKEN_KEYS {
        if let Some(text) = delta.get(key).and_then(serde_json::Value::as_str)
            && !text.is_empty()
        {
            return Some(text);
        }
    }
    if let Some(tool_calls) = delta
        .get("tool_calls")
        .and_then(serde_json::Value::as_array)
    {
        for call in tool_calls {
            let function: Option<&serde_json::Value> = call.get("function");
            for key in TOOL_CALL_TEXT_KEYS {
                if let Some(text) = function
                    .and_then(|f| f.get(key))
                    .and_then(serde_json::Value::as_str)
                    && !text.is_empty()
                {
                    return Some(text);
                }
            }
        }
    }
    None
}

/// `function` sub-keys under a streamed `delta.tool_calls` element that carry
/// generated text: the name (only on the opening fragment) and the argument
/// fragments that follow.
const TOOL_CALL_TEXT_KEYS: [&str; 2] = ["name", "arguments"];

/// A streamed tool-call fragment from a single chunk: the function `name`
/// (present only on the opening fragment of a call) and/or an `arguments` text
/// fragment (streamed across subsequent chunks). Both are `None` when the array
/// element carries neither. Probe mode renders these so tool-calling (agent)
/// responses are visible rather than appearing empty.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolCallFragment<'a> {
    pub name: Option<&'a str>,
    pub arguments: Option<&'a str>,
}

/// Extracts the tool-call fragments from a streaming chunk's `delta.tool_calls`,
/// one entry per array element. Empty when the chunk carries no tool calls.
pub fn tool_call_fragments(chunk: &serde_json::Value) -> Vec<ToolCallFragment<'_>> {
    let Some(tool_calls) = chunk
        .get("choices")
        .and_then(serde_json::Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("delta"))
        .and_then(|delta| delta.get("tool_calls"))
        .and_then(serde_json::Value::as_array)
    else {
        return Vec::new();
    };
    tool_calls
        .iter()
        .map(|call| {
            let function: Option<&serde_json::Value> = call.get("function");
            let field = |key: &str| -> Option<&str> {
                function
                    .and_then(|f| f.get(key))
                    .and_then(serde_json::Value::as_str)
                    .filter(|text| !text.is_empty())
            };
            ToolCallFragment {
                name: field("name"),
                arguments: field("arguments"),
            }
        })
        .collect()
}

/// Returns the reasoning-trace text of a streaming chunk (`delta.reasoning` or
/// `delta.reasoning_content`), if present and non-empty. Probe mode uses this to
/// display a reasoning model's thinking distinctly from its visible answer;
/// `content_delta` deliberately excludes it.
pub fn reasoning_delta(chunk: &serde_json::Value) -> Option<&str> {
    let delta: &serde_json::Value = chunk.get("choices")?.as_array()?.first()?.get("delta")?;
    for key in REASONING_KEYS {
        if let Some(text) = delta.get(key).and_then(serde_json::Value::as_str)
            && !text.is_empty()
        {
            return Some(text);
        }
    }
    None
}

/// Metrics recovered from the response that mitmproxy recorded for a captured
/// request — the baseline the live replay is compared against.
///
/// Note: flow files store the response body whole with a single start/end
/// timestamp, so a recorded *time-to-first-token* is not available; only total
/// latency and throughput can be compared.
#[derive(Debug, Clone, Serialize)]
pub struct RecordedBaseline {
    pub status_code: u16,
    pub latency_secs: f64,
    pub usage: Option<Usage>,
    /// Completion tokens / total response latency (end-to-end, prefill
    /// included), when usage is present.
    pub output_tps: Option<f64>,
    /// Count of recorded `data:` payloads that failed to parse as JSON. Non-zero
    /// means the recorded token accounting is incomplete — surfaced (rather than
    /// silently dropped, as the live-replay path also refuses to do) so a
    /// partially-unparseable recorded body can't masquerade as a clean baseline.
    pub malformed_chunks: usize,
}

/// A single captured chat-completion request, ready to be re-pointed at a
/// target endpoint.
#[derive(Debug, Clone)]
pub struct CapturedRequest {
    /// Which LLM API this request speaks (derived from its path), so the body
    /// rewrite and stream interpretation match the protocol.
    pub wire: Wire,
    /// Request path as captured, e.g. `/v1/chat/completions` or `/v1/messages`.
    pub path: String,
    /// Captured request headers (hop-by-hop stripped; credential headers —
    /// `Authorization` / `x-api-key` / `api-key` — kept and forwarded only when
    /// `--forward-auth` is set).
    pub headers: Vec<(String, String)>,
    /// Parsed request body; rewritten at replay time.
    pub body: serde_json::Value,
    /// Model named in the captured body, for reporting.
    pub model: Option<String>,
    /// Request wire timestamps (Unix seconds) used to derive recorded think-time.
    pub ts_start: f64,
    pub ts_end: f64,
    /// Metrics of the recorded response, when one was captured.
    pub baseline: Option<RecordedBaseline>,
}

impl CapturedRequest {
    /// Builds a live request from this capture: re-points it at the target,
    /// applies the optional model override and bearer token, and forces
    /// `stream: true` + `stream_options.include_usage: true` so the server emits
    /// a final usage chunk for token accounting.
    pub fn build_request(
        &self,
        client: &reqwest::Client,
        target: &TargetConfig,
        cache_buster: Option<&str>,
    ) -> reqwest::RequestBuilder {
        let url = format!("{}{}", target.base_url.trim_end_matches('/'), self.path);
        let body = self.rewritten_body(target, cache_buster);

        let mut builder = client
            .post(url)
            .headers(self.forwardable_headers(target))
            .json(&body);
        if let Some(key) = &target.api_key {
            builder = builder.bearer_auth(key);
        }
        builder
    }

    /// The request body exactly as it will be sent: streaming forced on, `model`
    /// overridden when configured, and any cache-buster marker injected. Split
    /// out from [`build_request`] so probe mode can display the real outgoing
    /// prompt without duplicating the rewrite logic.
    ///
    /// `stream_options.include_usage` is forced only for OpenAI — it makes the
    /// server emit a trailing usage chunk. Anthropic streams usage natively
    /// (`message_start` / `message_delta`) and rejects the unknown field, so it
    /// is omitted there.
    pub fn rewritten_body(
        &self,
        target: &TargetConfig,
        cache_buster: Option<&str>,
    ) -> serde_json::Value {
        let mut body = self.body.clone();
        if let Some(object) = body.as_object_mut() {
            object.insert("stream".into(), serde_json::Value::Bool(true));
            if self.wire == Wire::OpenAi {
                object.insert(
                    "stream_options".into(),
                    serde_json::json!({ "include_usage": true }),
                );
            }
            if let Some(model) = &target.model_override {
                object.insert("model".into(), serde_json::Value::String(model.clone()));
            }
        }
        if let Some(marker) = cache_buster {
            match self.wire {
                Wire::OpenAi => inject_cache_buster(&mut body, marker, target.bust_system_prompt),
                Wire::Anthropic => {
                    inject_anthropic_cache_buster(&mut body, marker, target.bust_system_prompt)
                }
            }
        }
        body
    }

    /// Builds a [`HeaderMap`] of captured headers, dropping HTTP/2 pseudo-headers
    /// (`:authority`, …), `content-type` (set by the JSON body), and any header
    /// whose name or value is not valid for an outbound request. Captured
    /// credential headers ([`CAPTURED_CREDENTIAL_HEADERS`] — including Anthropic's
    /// `x-api-key`) are included only when the target opts to forward them, so a
    /// stale token is never sent to a re-pointed host by default.
    fn forwardable_headers(&self, target: &TargetConfig) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in &self.headers {
            if name.starts_with(':') || name.eq_ignore_ascii_case("content-type") {
                continue;
            }
            if is_credential_header(name) && !target.forwards_captured_auth() {
                continue;
            }
            let (Ok(header_name), Ok(header_value)) = (
                HeaderName::from_bytes(name.as_bytes()),
                HeaderValue::from_str(value),
            ) else {
                continue;
            };
            map.insert(header_name, header_value);
        }
        map
    }

    /// Whether this request carried any captured credential header
    /// ([`CAPTURED_CREDENTIAL_HEADERS`]) — used to decide whether the
    /// 401/403 auth hint applies.
    pub fn has_captured_auth(&self) -> bool {
        self.headers
            .iter()
            .any(|(name, _)| is_credential_header(name))
    }
}

/// Roles whose leading messages form the shared system prefix a production
/// fleet caches across users. The cache-buster is injected *after* them by
/// default so that prefix stays byte-identical (and thus cacheable).
const SYSTEM_ROLES: [&str; 2] = ["system", "developer"];

/// Injects `marker` into the prompt so the server cannot reuse a cached KV
/// prefix across requests carrying different markers. The marker must land at
/// the first point where concurrent virtual users should diverge, because
/// prefix caches match the longest common *leading* token run — anything before
/// the marker stays shared.
///
/// When `bust_system_prompt` is `false` (the default) the marker is placed at
/// the start of the first non-system message, so the shared system prompt stays
/// cacheable exactly as it would be in production. When `true`, it is placed at
/// the very start of the prompt, defeating the system-prompt cache too (a
/// conservative worst-case). Handles both string and multimodal-array content.
fn inject_cache_buster(body: &mut serde_json::Value, marker: &str, bust_system_prompt: bool) {
    let Some(messages) = body
        .get_mut("messages")
        .and_then(serde_json::Value::as_array_mut)
    else {
        return;
    };
    let Some(index) = cache_buster_index(messages, bust_system_prompt) else {
        return;
    };
    prepend_marker_to_content(&mut messages[index], marker);
}

/// Injects `marker` into an Anthropic Messages body. The system prompt is a
/// top-level `system` field (not a message), so the placement differs from
/// OpenAI: by default the marker goes into the first message, leaving the shared
/// `system` prompt byte-identical and cacheable. With `bust_system_prompt` it is
/// prepended to the `system` field itself (string or array of text blocks),
/// defeating that shared cache for the conservative worst case.
fn inject_anthropic_cache_buster(
    body: &mut serde_json::Value,
    marker: &str,
    bust_system_prompt: bool,
) {
    if bust_system_prompt {
        match body.get_mut("system") {
            Some(serde_json::Value::String(text)) => {
                *text = format!("{marker}{text}");
                return;
            }
            Some(serde_json::Value::Array(parts)) => {
                parts.insert(0, serde_json::json!({ "type": "text", "text": marker }));
                return;
            }
            // No top-level system prompt to bust — fall through to the first
            // message so a marker is still injected.
            _ => {}
        }
    }
    if let Some(first) = body
        .get_mut("messages")
        .and_then(serde_json::Value::as_array_mut)
        .and_then(|messages| messages.first_mut())
    {
        prepend_marker_to_content(first, marker);
    }
}

/// Prepends `marker` to a message's `content`, handling both a plain string and
/// the multimodal-array form (a leading `text` part is inserted).
fn prepend_marker_to_content(message: &mut serde_json::Value, marker: &str) {
    match message.get_mut("content") {
        Some(serde_json::Value::String(text)) => *text = format!("{marker}{text}"),
        Some(serde_json::Value::Array(parts)) => {
            parts.insert(0, serde_json::json!({ "type": "text", "text": marker }));
        }
        _ => {}
    }
}

/// Chooses which message the cache-buster marker is injected into. With
/// `bust_system_prompt` the very first message; otherwise the first message past
/// any leading system/developer messages (falling back to the last message when
/// every message is a system one).
fn cache_buster_index(messages: &[serde_json::Value], bust_system_prompt: bool) -> Option<usize> {
    if messages.is_empty() {
        return None;
    }
    if bust_system_prompt {
        return Some(0);
    }
    let first_non_system: Option<usize> = messages.iter().position(|message| {
        let role: &str = message
            .get("role")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        !SYSTEM_ROLES.contains(&role)
    });
    Some(first_non_system.unwrap_or(messages.len() - 1))
}

/// An ordered sequence of captured requests replayed in capture order by a
/// single virtual user. One dump file maps to one session.
#[derive(Debug, Clone)]
pub struct Session {
    /// Human-readable label, derived from the source file name.
    pub name: String,
    pub requests: Vec<CapturedRequest>,
}

impl Session {
    /// Total captured requests in the session.
    pub fn len(&self) -> usize {
        self.requests.len()
    }

    /// Whether the session has no replayable requests.
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.requests.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_buster_preserves_system_prompt_by_default() {
        let mut body = serde_json::json!({
            "messages": [
                { "role": "system", "content": "You are helpful." },
                { "role": "user", "content": "Build me an app." },
            ]
        });
        inject_cache_buster(&mut body, "[s7] ", false);
        assert_eq!(
            body["messages"][0]["content"], "You are helpful.",
            "shared system prompt must stay byte-identical so it is cacheable"
        );
        assert_eq!(body["messages"][1]["content"], "[s7] Build me an app.");
    }

    #[test]
    fn cache_buster_busts_system_prompt_when_requested() {
        let mut body = serde_json::json!({
            "messages": [
                { "role": "system", "content": "You are helpful." },
                { "role": "user", "content": "Build me an app." },
            ]
        });
        inject_cache_buster(&mut body, "[s7] ", true);
        assert_eq!(body["messages"][0]["content"], "[s7] You are helpful.");
        assert_eq!(body["messages"][1]["content"], "Build me an app.");
    }

    #[test]
    fn cache_buster_falls_back_to_only_message() {
        let mut body = serde_json::json!({
            "messages": [{ "role": "user", "content": "hello" }]
        });
        inject_cache_buster(&mut body, "[s7] ", false);
        assert_eq!(body["messages"][0]["content"], "[s7] hello");
    }

    fn anthropic_request(body: serde_json::Value) -> CapturedRequest {
        CapturedRequest {
            wire: Wire::Anthropic,
            path: "/v1/messages".into(),
            headers: Vec::new(),
            body,
            model: Some("claude-sonnet-4-6".into()),
            ts_start: 0.0,
            ts_end: 0.0,
            baseline: None,
        }
    }

    fn target(bust_system_prompt: bool) -> TargetConfig {
        TargetConfig {
            base_url: "http://localhost:8000".into(),
            model_override: None,
            api_key: None,
            forward_auth: false,
            bust_system_prompt,
        }
    }

    #[test]
    fn captured_credentials_are_gated_by_forward_auth() {
        let request = CapturedRequest {
            wire: Wire::Anthropic,
            path: "/v1/messages".into(),
            headers: vec![
                ("authorization".into(), "Bearer captured".into()),
                ("x-api-key".into(), "sk-captured".into()),
                ("anthropic-version".into(), "2023-06-01".into()),
            ],
            body: serde_json::json!({}),
            model: None,
            ts_start: 0.0,
            ts_end: 0.0,
            baseline: None,
        };

        let base = |api_key: Option<&str>, forward_auth: bool| TargetConfig {
            base_url: "http://localhost:8000".into(),
            model_override: None,
            api_key: api_key.map(str::to_owned),
            forward_auth,
            bust_system_prompt: false,
        };

        let dropped = request.forwardable_headers(&base(None, false));
        assert!(
            !dropped.contains_key("authorization") && !dropped.contains_key("x-api-key"),
            "captured credentials must not be forwarded by default"
        );
        assert!(
            dropped.contains_key("anthropic-version"),
            "non-credential headers are always forwarded"
        );

        let forwarded = request.forwardable_headers(&base(None, true));
        assert!(
            forwarded.contains_key("authorization") && forwarded.contains_key("x-api-key"),
            "--forward-auth forwards every captured credential, incl. x-api-key"
        );

        let overridden = request.forwardable_headers(&base(Some("fresh"), true));
        assert!(
            !overridden.contains_key("authorization") && !overridden.contains_key("x-api-key"),
            "an --api-key override drops the stale captured credentials"
        );
    }

    #[test]
    fn anthropic_body_streams_without_stream_options() {
        let request = anthropic_request(serde_json::json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 8000,
            "system": [{ "type": "text", "text": "You are helpful." }],
            "messages": [{ "role": "user", "content": "Build me an app." }],
        }));
        let body = request.rewritten_body(&target(false), None);
        assert_eq!(body["stream"], true);
        assert!(
            body.get("stream_options").is_none(),
            "Anthropic rejects stream_options; it must not be added"
        );
    }

    #[test]
    fn anthropic_cache_buster_targets_first_message_by_default() {
        let request = anthropic_request(serde_json::json!({
            "system": [{ "type": "text", "text": "You are helpful." }],
            "messages": [{ "role": "user", "content": "Build me an app." }],
        }));
        let body = request.rewritten_body(&target(false), Some("[s7] "));
        assert_eq!(
            body["system"][0]["text"], "You are helpful.",
            "the top-level system prompt stays byte-identical and cacheable"
        );
        assert_eq!(body["messages"][0]["content"], "[s7] Build me an app.");
    }

    #[test]
    fn anthropic_cache_buster_busts_system_array_when_requested() {
        let request = anthropic_request(serde_json::json!({
            "system": [{ "type": "text", "text": "You are helpful." }],
            "messages": [{ "role": "user", "content": "Build me an app." }],
        }));
        let body = request.rewritten_body(&target(true), Some("[s7] "));
        assert_eq!(body["system"][0]["text"], "[s7] ");
        assert_eq!(body["system"][1]["text"], "You are helpful.");
        assert_eq!(
            body["messages"][0]["content"], "Build me an app.",
            "busting the system prompt leaves the first message untouched"
        );
    }

    #[test]
    fn anthropic_cache_buster_busts_system_string_when_requested() {
        // A string `system` prompt is the common shape; the marker must prepend
        // to the string itself and leave the first message untouched.
        let request = anthropic_request(serde_json::json!({
            "system": "You are helpful.",
            "messages": [{ "role": "user", "content": "Build me an app." }],
        }));
        let body = request.rewritten_body(&target(true), Some("[s7] "));
        assert_eq!(body["system"], "[s7] You are helpful.");
        assert_eq!(body["messages"][0]["content"], "Build me an app.");
    }

    #[test]
    fn anthropic_cache_buster_falls_back_to_message_without_system() {
        // With no top-level `system` to bust, the marker must still land — on
        // the first message — rather than being silently dropped.
        let request = anthropic_request(serde_json::json!({
            "messages": [{ "role": "user", "content": "Build me an app." }],
        }));
        let body = request.rewritten_body(&target(true), Some("[s7] "));
        assert_eq!(body["messages"][0]["content"], "[s7] Build me an app.");
    }

    #[test]
    fn any_delta_text_detects_reasoning_before_content() {
        let role_only: serde_json::Value =
            serde_json::json!({ "choices": [{ "delta": { "role": "assistant", "content": "" } }] });
        assert_eq!(any_delta_text(&role_only), None);

        let reasoning: serde_json::Value =
            serde_json::json!({ "choices": [{ "delta": { "reasoning": "thinking" } }] });
        assert_eq!(any_delta_text(&reasoning), Some("thinking"));
        assert_eq!(reasoning_delta(&reasoning), Some("thinking"));
        assert_eq!(
            content_delta(&reasoning),
            None,
            "reasoning is not visible content"
        );

        let content: serde_json::Value =
            serde_json::json!({ "choices": [{ "delta": { "content": "Hi" } }] });
        assert_eq!(any_delta_text(&content), Some("Hi"));
        assert_eq!(
            reasoning_delta(&content),
            None,
            "visible content is not a reasoning trace"
        );
    }

    #[test]
    fn any_delta_text_and_fragments_detect_tool_calls() {
        let opening: serde_json::Value = serde_json::json!({
            "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "id": "call_1", "function": { "name": "askQuestion", "arguments": "" } }
            ] } }]
        });
        assert_eq!(
            any_delta_text(&opening),
            Some("askQuestion"),
            "the opening tool-call fragment is the first generated token"
        );
        let opening_frags: Vec<ToolCallFragment<'_>> = tool_call_fragments(&opening);
        assert_eq!(opening_frags.len(), 1);
        assert_eq!(opening_frags[0].name, Some("askQuestion"));
        assert_eq!(
            opening_frags[0].arguments, None,
            "empty arguments are dropped"
        );

        let args: serde_json::Value = serde_json::json!({
            "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "function": { "arguments": "{\"q\":1}" } }
            ] } }]
        });
        assert_eq!(any_delta_text(&args), Some("{\"q\":1}"));
        let arg_frags: Vec<ToolCallFragment<'_>> = tool_call_fragments(&args);
        assert_eq!(arg_frags[0].name, None);
        assert_eq!(arg_frags[0].arguments, Some("{\"q\":1}"));

        let none: serde_json::Value =
            serde_json::json!({ "choices": [{ "delta": { "content": "hi" } }] });
        assert!(tool_call_fragments(&none).is_empty());
    }

    #[test]
    fn cache_buster_prepends_text_part_to_array_content() {
        let mut body = serde_json::json!({
            "messages": [{ "role": "user", "content": [{ "type": "text", "text": "hi" }] }]
        });
        inject_cache_buster(&mut body, "[s7] ", false);
        assert_eq!(body["messages"][0]["content"][0]["text"], "[s7] ");
        assert_eq!(body["messages"][0]["content"][1]["text"], "hi");
    }
}

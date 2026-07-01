//! LLM wire-format differences between the OpenAI Chat Completions API and the
//! Anthropic Messages API.
//!
//! The replay engine is otherwise protocol-agnostic: it sends captured bodies
//! and times the streamed response. This module is the single place that knows
//! how each API shapes its streaming chunks, so [`crate::replay::worker`] and
//! [`crate::probe`] can interpret either without branching themselves.
//!
//! ## OpenAI (`POST .../chat/completions`)
//! Plain `data: {chat.completion.chunk}` SSE. Generated text lives under
//! `choices[0].delta` (`content`, `reasoning`, `tool_calls[].function`). Token
//! usage arrives in a single trailing `usage` chunk (we force
//! `stream_options.include_usage`).
//!
//! ## Anthropic (`POST /v1/messages`)
//! Typed SSE: `event: <type>` then `data: {...}`. There is no `[DONE]` sentinel.
//! Generated text is spread across `content_block_start` (tool name) and
//! `content_block_delta` (`text_delta`, `thinking_delta`, `input_json_delta`).
//! Usage is split across frames: `message_start` carries the prompt-side counts
//! and an initial `output_tokens`; `message_delta` carries the final cumulative
//! `output_tokens` — so usage must be *accumulated*, not replaced.

use serde_json::Value;

use crate::model::{
    ToolCallFragment, Usage, any_delta_text, content_delta, reasoning_delta, tool_call_fragments,
    usage_from_chunk,
};

/// Which LLM HTTP API a captured request speaks. Detected from the request path
/// so a single dump (or a mix of dumps) can be replayed without configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wire {
    /// OpenAI-compatible Chat Completions (`.../chat/completions`).
    OpenAi,
    /// Anthropic Messages API (`/v1/messages`).
    Anthropic,
}

impl Wire {
    /// Classifies a captured request path, falling back to OpenAI for anything
    /// that is not a recognized chat/messages endpoint (callers gate on
    /// [`Wire::is_chat_path`] first, so the fallback is only reached for
    /// already-filtered paths).
    pub fn detect(path: &str) -> Wire {
        Self::endpoint_wire(path).unwrap_or(Wire::OpenAi)
    }

    /// Whether a captured request path is a replayable chat/messages request.
    /// Used by the parser to skip non-LLM flows (health checks, etc.).
    pub fn is_chat_path(path: &str) -> bool {
        Self::endpoint_wire(path).is_some()
    }

    /// The wire a path speaks, matched on the *endpoint suffix* rather than a
    /// bare substring. Anchoring on the suffix keeps the prefix tolerance real
    /// deployments need (Azure `/openai/deployments/<name>/chat/completions`,
    /// proxied `/anthropic/v1/messages`) while rejecting Anthropic's sibling
    /// endpoints — `/v1/messages/count_tokens`, `/v1/messages/batches` — which a
    /// bare `contains("/messages")` would misclassify as replayable streaming
    /// chat and pollute the run with phantom zero-token requests.
    fn endpoint_wire(path: &str) -> Option<Wire> {
        let path: &str = path
            .split(['?', '#'])
            .next()
            .unwrap_or(path)
            .trim_end_matches('/');
        if path.ends_with("/chat/completions") {
            Some(Wire::OpenAi)
        } else if path.ends_with("/messages") {
            Some(Wire::Anthropic)
        } else {
            None
        }
    }

    /// The visible-content text of a streaming chunk, if present and non-empty —
    /// the basis for time-to-first/last-token. Reasoning/thinking is excluded.
    pub fn content_delta<'a>(&self, chunk: &'a Value) -> Option<&'a str> {
        match self {
            Wire::OpenAi => content_delta(chunk),
            Wire::Anthropic => anthropic_content_delta(chunk),
        }
    }

    /// The first non-empty generated-token text of any kind in a chunk — visible
    /// content, reasoning, or a tool-call name/argument fragment. Marks the start
    /// of decode (end of prefill), so the decode-throughput denominator excludes
    /// prefill only.
    pub fn any_delta_text<'a>(&self, chunk: &'a Value) -> Option<&'a str> {
        match self {
            Wire::OpenAi => any_delta_text(chunk),
            Wire::Anthropic => anthropic_any_delta_text(chunk),
        }
    }

    /// The reasoning/thinking-trace text of a chunk, if present — for probe
    /// display, kept distinct from visible content.
    pub fn reasoning_delta<'a>(&self, chunk: &'a Value) -> Option<&'a str> {
        match self {
            Wire::OpenAi => reasoning_delta(chunk),
            Wire::Anthropic => anthropic_reasoning_delta(chunk),
        }
    }

    /// The tool-call fragments carried by a chunk (function name on the opening
    /// fragment, argument text on the fragments that follow).
    pub fn tool_call_fragments<'a>(&self, chunk: &'a Value) -> Vec<ToolCallFragment<'a>> {
        match self {
            Wire::OpenAi => tool_call_fragments(chunk),
            Wire::Anthropic => anthropic_tool_call_fragments(chunk),
        }
    }

    /// Folds one streaming chunk's token accounting into `acc`. OpenAI sends the
    /// whole usage in one trailing chunk (last-wins); Anthropic spreads it across
    /// `message_start` and `message_delta`, so the fields are merged in place.
    pub fn update_usage(&self, acc: &mut Option<Usage>, chunk: &Value) {
        match self {
            Wire::OpenAi => {
                if let Some(found) = usage_from_chunk(chunk) {
                    *acc = Some(found);
                }
            }
            Wire::Anthropic => anthropic_update_usage(acc, chunk),
        }
    }
}

/// Anthropic `content_block_delta` text: visible `text_delta` only.
fn anthropic_content_delta(chunk: &Value) -> Option<&str> {
    let delta: &Value = chunk.get("delta")?;
    if delta.get("type").and_then(Value::as_str) != Some("text_delta") {
        return None;
    }
    let text: &str = delta.get("text")?.as_str()?;
    (!text.is_empty()).then_some(text)
}

/// Anthropic reasoning trace: `thinking_delta` text from an extended-thinking
/// response.
fn anthropic_reasoning_delta(chunk: &Value) -> Option<&str> {
    let delta: &Value = chunk.get("delta")?;
    if delta.get("type").and_then(Value::as_str) != Some("thinking_delta") {
        return None;
    }
    let text: &str = delta.get("thinking")?.as_str()?;
    (!text.is_empty()).then_some(text)
}

/// Keys under an Anthropic `content_block_delta.delta` that carry generated
/// tokens: visible text, thinking trace, and streamed tool-call arguments.
const ANTHROPIC_DELTA_TEXT_KEYS: [&str; 3] = ["text", "thinking", "partial_json"];

/// First generated token of any kind in an Anthropic chunk: the tool name on a
/// `tool_use` `content_block_start`, or any non-empty delta text that follows.
fn anthropic_any_delta_text(chunk: &Value) -> Option<&str> {
    match chunk.get("type").and_then(Value::as_str) {
        Some("content_block_start") => {
            let block: &Value = chunk.get("content_block")?;
            if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                return None;
            }
            let name: &str = block.get("name")?.as_str()?;
            (!name.is_empty()).then_some(name)
        }
        Some("content_block_delta") => {
            let delta: &Value = chunk.get("delta")?;
            for key in ANTHROPIC_DELTA_TEXT_KEYS {
                if let Some(text) = delta.get(key).and_then(Value::as_str)
                    && !text.is_empty()
                {
                    return Some(text);
                }
            }
            None
        }
        _ => None,
    }
}

/// Tool-call fragments from an Anthropic chunk: the name opens a `tool_use`
/// content block (`content_block_start`); arguments stream as `input_json_delta`
/// `partial_json` on the deltas that follow.
fn anthropic_tool_call_fragments(chunk: &Value) -> Vec<ToolCallFragment<'_>> {
    match chunk.get("type").and_then(Value::as_str) {
        Some("content_block_start") => {
            let Some(block) = chunk.get("content_block") else {
                return Vec::new();
            };
            if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                return Vec::new();
            }
            let name: Option<&str> = block
                .get("name")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty());
            name.map(|name| ToolCallFragment {
                name: Some(name),
                arguments: None,
            })
            .into_iter()
            .collect()
        }
        Some("content_block_delta") => {
            let Some(delta) = chunk.get("delta") else {
                return Vec::new();
            };
            if delta.get("type").and_then(Value::as_str) != Some("input_json_delta") {
                return Vec::new();
            }
            let arguments: Option<&str> = delta
                .get("partial_json")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty());
            arguments
                .map(|arguments| ToolCallFragment {
                    name: None,
                    arguments: Some(arguments),
                })
                .into_iter()
                .collect()
        }
        _ => Vec::new(),
    }
}

/// Merges Anthropic per-frame usage into the running accumulator. `message_start`
/// supplies the prompt-side counts (`input_tokens` + cache reads/creations) and
/// an initial `output_tokens`; `message_delta` supplies the final cumulative
/// `output_tokens` (and, on Bedrock, repeats the prompt counts). To match the
/// OpenAI convention, `prompt_tokens` is the *total* prompt size including cached
/// and cache-creation tokens, and `cached_tokens` is the cache-read subset.
///
/// `message_stop` is deliberately ignored: Bedrock emits a summary usage there
/// that carries `input_tokens` *without* the cache breakdown, which would clobber
/// the richer prompt total already accumulated from the earlier frames. The
/// standard Anthropic API omits usage from `message_stop` entirely.
fn anthropic_update_usage(acc: &mut Option<Usage>, chunk: &Value) {
    let frame_type: Option<&str> = chunk.get("type").and_then(Value::as_str);
    let usage: &Value = match frame_type {
        Some("message_start") => match chunk.get("message").and_then(|m| m.get("usage")) {
            Some(usage) => usage,
            None => return,
        },
        Some("message_delta") => match chunk.get("usage") {
            Some(usage) => usage,
            None => return,
        },
        _ => return,
    };

    let input: Option<u64> = usage.get("input_tokens").and_then(Value::as_u64);
    let cache_read: Option<u64> = usage.get("cache_read_input_tokens").and_then(Value::as_u64);
    let cache_creation: Option<u64> = usage
        .get("cache_creation_input_tokens")
        .and_then(Value::as_u64);
    let output: Option<u64> = usage.get("output_tokens").and_then(Value::as_u64);

    let entry: &mut Usage = acc.get_or_insert_with(Usage::default);

    // `message_start` is the authoritative prompt source and always carries the
    // full breakdown. On `message_delta` the prompt side is normally a redundant
    // repeat; only let it refine the total when it actually carries the cache
    // breakdown (a genuine server-side re-prefill). A *bare* `input_tokens` echo
    // — which Bedrock can send on `message_delta` — must never overwrite a
    // cache-heavy total, or a prompt whose tokens are mostly cache_creation /
    // cache_read collapses to `input_tokens` (e.g. 32298 → 445).
    let prompt_is_authoritative: bool =
        frame_type == Some("message_start") || cache_read.is_some() || cache_creation.is_some();
    if prompt_is_authoritative
        && (input.is_some() || cache_read.is_some() || cache_creation.is_some())
    {
        entry.prompt_tokens =
            input.unwrap_or(0) + cache_read.unwrap_or(0) + cache_creation.unwrap_or(0);
        if let Some(cache_read) = cache_read {
            entry.cached_tokens = Some(cache_read);
        }
    }
    if let Some(output) = output {
        entry.completion_tokens = output;
    }
    entry.total_tokens = entry.prompt_tokens + entry.completion_tokens;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_wire_from_path() {
        assert_eq!(Wire::detect("/v1/messages"), Wire::Anthropic);
        assert_eq!(Wire::detect("/v1/chat/completions"), Wire::OpenAi);
        assert!(Wire::is_chat_path("/v1/messages"));
        assert!(Wire::is_chat_path("/openai/v1/chat/completions"));
        assert!(!Wire::is_chat_path("/health"));
    }

    #[test]
    fn classification_anchors_on_endpoint_suffix() {
        // Prefix tolerance for real deployments (Azure, proxied paths) and
        // trailing slash / query strings must still classify.
        assert_eq!(
            Wire::detect("/openai/deployments/gpt-4o/chat/completions?api-version=2024-02-01"),
            Wire::OpenAi
        );
        assert_eq!(Wire::detect("/anthropic/v1/messages/"), Wire::Anthropic);
        assert!(Wire::is_chat_path("/v1/messages?beta=true"));

        // Anthropic's sibling endpoints share the `/messages` prefix but are not
        // replayable streaming chat — they must be filtered out, not captured.
        assert!(!Wire::is_chat_path("/v1/messages/count_tokens"));
        assert!(!Wire::is_chat_path("/v1/messages/batches"));
        assert!(!Wire::is_chat_path("/v1/messages/batches/msgbatch_123"));
    }

    #[test]
    fn anthropic_text_and_thinking_deltas() {
        let text: Value = serde_json::json!({
            "type": "content_block_delta", "index": 0,
            "delta": { "type": "text_delta", "text": "Hello" }
        });
        assert_eq!(Wire::Anthropic.content_delta(&text), Some("Hello"));
        assert_eq!(Wire::Anthropic.any_delta_text(&text), Some("Hello"));
        assert_eq!(Wire::Anthropic.reasoning_delta(&text), None);

        let thinking: Value = serde_json::json!({
            "type": "content_block_delta", "index": 0,
            "delta": { "type": "thinking_delta", "thinking": "hmm" }
        });
        assert_eq!(Wire::Anthropic.reasoning_delta(&thinking), Some("hmm"));
        assert_eq!(
            Wire::Anthropic.content_delta(&thinking),
            None,
            "thinking is not visible content"
        );
        assert_eq!(
            Wire::Anthropic.any_delta_text(&thinking),
            Some("hmm"),
            "thinking is a generated token"
        );
    }

    #[test]
    fn anthropic_tool_use_fragments() {
        let start: Value = serde_json::json!({
            "type": "content_block_start", "index": 0,
            "content_block": { "type": "tool_use", "id": "toolu_1", "name": "askQuestion", "input": {} }
        });
        assert_eq!(
            Wire::Anthropic.any_delta_text(&start),
            Some("askQuestion"),
            "the tool name opens generation"
        );
        let start_frags: Vec<ToolCallFragment<'_>> = Wire::Anthropic.tool_call_fragments(&start);
        assert_eq!(start_frags.len(), 1);
        assert_eq!(start_frags[0].name, Some("askQuestion"));
        assert_eq!(start_frags[0].arguments, None);

        let empty_args: Value = serde_json::json!({
            "type": "content_block_delta", "index": 0,
            "delta": { "type": "input_json_delta", "partial_json": "" }
        });
        assert_eq!(
            Wire::Anthropic.any_delta_text(&empty_args),
            None,
            "an empty argument fragment is not yet a generated token"
        );
        assert!(Wire::Anthropic.tool_call_fragments(&empty_args).is_empty());

        let args: Value = serde_json::json!({
            "type": "content_block_delta", "index": 0,
            "delta": { "type": "input_json_delta", "partial_json": "{\"q\":1}" }
        });
        assert_eq!(Wire::Anthropic.any_delta_text(&args), Some("{\"q\":1}"));
        let arg_frags: Vec<ToolCallFragment<'_>> = Wire::Anthropic.tool_call_fragments(&args);
        assert_eq!(arg_frags[0].name, None);
        assert_eq!(arg_frags[0].arguments, Some("{\"q\":1}"));
    }

    #[test]
    fn anthropic_usage_accumulates_across_frames() {
        let mut usage: Option<Usage> = None;
        let start: Value = serde_json::json!({
            "type": "message_start",
            "message": { "usage": {
                "input_tokens": 445, "cache_creation_input_tokens": 31853,
                "cache_read_input_tokens": 0, "output_tokens": 27
            } }
        });
        Wire::Anthropic.update_usage(&mut usage, &start);
        let after_start: Usage = usage.expect("message_start populates usage");
        assert_eq!(
            after_start.prompt_tokens, 32298,
            "prompt is input + cache_creation + cache_read"
        );
        assert_eq!(after_start.cached_tokens, Some(0));
        assert_eq!(after_start.completion_tokens, 27);

        // A standard Anthropic message_delta carries output_tokens only; the
        // prompt-side counts from message_start must survive.
        let delta: Value = serde_json::json!({
            "type": "message_delta",
            "delta": { "stop_reason": "tool_use" },
            "usage": { "output_tokens": 234 }
        });
        Wire::Anthropic.update_usage(&mut usage, &delta);
        let after_delta: Usage = usage.expect("usage persists");
        assert_eq!(after_delta.prompt_tokens, 32298);
        assert_eq!(after_delta.cached_tokens, Some(0));
        assert_eq!(after_delta.completion_tokens, 234);
        assert_eq!(after_delta.total_tokens, 32298 + 234);
    }

    #[test]
    fn anthropic_bare_input_delta_does_not_clobber_cache_total() {
        // Bedrock can repeat a bare `input_tokens` on message_delta without the
        // cache breakdown. It must not collapse the cache-heavy prompt total
        // established by message_start.
        let mut usage: Option<Usage> = None;
        let start: Value = serde_json::json!({
            "type": "message_start",
            "message": { "usage": {
                "input_tokens": 445, "cache_creation_input_tokens": 31853,
                "cache_read_input_tokens": 0, "output_tokens": 27
            } }
        });
        Wire::Anthropic.update_usage(&mut usage, &start);

        let bare_delta: Value = serde_json::json!({
            "type": "message_delta",
            "delta": { "stop_reason": "tool_use" },
            "usage": { "input_tokens": 445, "output_tokens": 234 }
        });
        Wire::Anthropic.update_usage(&mut usage, &bare_delta);

        let final_usage: Usage = usage.expect("usage populated");
        assert_eq!(
            final_usage.prompt_tokens, 32298,
            "a bare input_tokens echo must not drop the cache_creation tokens"
        );
        assert_eq!(final_usage.cached_tokens, Some(0));
        assert_eq!(final_usage.completion_tokens, 234);
    }

    #[test]
    fn anthropic_server_tool_delta_refines_prompt_when_breakdown_present() {
        // A message_delta that carries the full cache breakdown (e.g. a
        // server-side re-prefill) is authoritative and refines the total.
        let mut usage: Option<Usage> = None;
        let start: Value = serde_json::json!({
            "type": "message_start",
            "message": { "usage": {
                "input_tokens": 100, "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0, "output_tokens": 5
            } }
        });
        Wire::Anthropic.update_usage(&mut usage, &start);

        let refine: Value = serde_json::json!({
            "type": "message_delta",
            "delta": { "stop_reason": "end_turn" },
            "usage": {
                "input_tokens": 10682, "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0, "output_tokens": 510
            }
        });
        Wire::Anthropic.update_usage(&mut usage, &refine);

        let final_usage: Usage = usage.expect("usage populated");
        assert_eq!(final_usage.prompt_tokens, 10682);
        assert_eq!(final_usage.completion_tokens, 510);
    }

    #[test]
    fn openai_usage_replaces_from_trailing_chunk() {
        let mut usage: Option<Usage> = None;
        let chunk: Value = serde_json::json!({
            "choices": [], "usage": { "prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13 }
        });
        Wire::OpenAi.update_usage(&mut usage, &chunk);
        assert_eq!(usage.map(|u| u.completion_tokens), Some(3));
    }
}

//! Minimal OpenAI-compatible streaming mock for exercising `llm-bench` without
//! real hardware. Streams a fixed number of content tokens with a small
//! per-token delay, then a usage chunk and `[DONE]`.
//!
//! Run: `cargo run --example mock_server -- 127.0.0.1:8000`

use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::header;
use axum::response::Response;
use axum::routing::post;
use tokio_stream::StreamExt;

#[tokio::main]
async fn main() {
    let addr = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1:8000".to_string());
    let app = Router::new().route("/v1/chat/completions", post(stream_completion));
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    eprintln!("mock OpenAI server listening on http://{addr}");
    axum::serve(listener, app).await.unwrap();
}

/// Streams ~40 content tokens, each after a 15ms delay, then a usage chunk.
async fn stream_completion() -> Response {
    const TOKENS: u64 = 40;
    let chunks = tokio_stream::iter(0..TOKENS)
        .then(|i| async move {
            tokio::time::sleep(Duration::from_millis(15)).await;
            let chunk = format!(
                "data: {{\"choices\":[{{\"delta\":{{\"content\":\"tok{i} \"}}}}]}}\n\n"
            );
            Ok::<_, std::convert::Infallible>(chunk)
        })
        .chain(tokio_stream::once(Ok(format!(
            "data: {{\"choices\":[],\"usage\":{{\"prompt_tokens\":1000,\"completion_tokens\":{TOKENS},\"total_tokens\":{}}}}}\n\ndata: [DONE]\n\n",
            1000 + TOKENS
        ))));

    Response::builder()
        .header(header::CONTENT_TYPE, "text/event-stream")
        .body(Body::from_stream(chunks))
        .unwrap()
}
